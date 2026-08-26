// Milestone 7 -- model discovery vs. resolved execution route
// (ADR Decisions 2, 4, 4A, 5, 8). A configured model ID alone never
// authorizes spend; every route is resolved to an exact, uniquely
// pinnable, priced provider endpoint before it can be considered eligible.

import Decimal from "decimal.js";
import type { PreflightReasonCode } from "./errors";
import { buildPricingSnapshot, type PricingSnapshot } from "./pricing";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

export type ResolvedModelRoute = {
  configuredModelId: string;
  canonicalModelId: string;
  providerEndpointTag: string;
  // True only when providerEndpointTag is proven to identify exactly one
  // endpoint in the current candidate set under OpenRouter's documented
  // provider-slug matching semantics (ADR Decision 4A). Always true on a
  // constructed ResolvedModelRoute -- a not-uniquely-pinnable endpoint
  // never reaches this type.
  isUniquelyPinnable: true;
  providerDisplayName: string;
  endpointDisplayName: string;
  contextLength: number;
  maxPromptTokens: number | null;
  maxCompletionTokens: number | null;
  supportedParameters: string[];
  quantization: string | null;
  pricing: PricingSnapshot;
  observedAt: string;
};

export type RouteRole = "ADVOCATE" | "JUDGE";

// ---------------------------------------------------------------------
// Alias / dynamic-router policy (ADR Decision 8).
// ---------------------------------------------------------------------

export const AUTO_ROUTER_MODEL_ID = "openrouter/auto";

export type AliasCheckResult =
  | { blocked: false }
  | { blocked: true; reasonCode: "DYNAMIC_MODEL_UNSUPPORTED" | "MODEL_ALIAS_NOT_PINNED" };

export function checkAliasOrDynamicModel(modelId: string): AliasCheckResult {
  if (modelId === AUTO_ROUTER_MODEL_ID) {
    return { blocked: true, reasonCode: "DYNAMIC_MODEL_UNSUPPORTED" };
  }

  // Tilde-alias convention (`~provider/model-family-latest`), explicitly
  // designed to move over time -- any occurrence of "~" in the configured
  // ID is treated as this convention, per the locked conservative policy
  // (ADR: "uses the tilde-alias (~...) convention").
  if (modelId.includes("~")) {
    return { blocked: true, reasonCode: "MODEL_ALIAS_NOT_PINNED" };
  }

  return { blocked: false };
}

// ---------------------------------------------------------------------
// Unique pinnability (ADR Decision 4A).
// ---------------------------------------------------------------------

// A full variant/region slug (contains "/") is potentially pinnable if it
// is the unique exact match in the candidate set. A bare/base slug (no
// "/") is pinnable only when no sibling variant currently exists in the
// candidate set -- OpenRouter's own documented semantics mean a base slug
// used in order/only matches every sibling too.
export function isUniquelyPinnable(tag: string, allTagsForModel: string[]): boolean {
  const isFullVariantSlug = tag.includes("/");

  if (isFullVariantSlug) {
    const exactMatches = allTagsForModel.filter((candidate) => candidate === tag).length;

    return exactMatches === 1;
  }

  const hasSiblingVariant = allTagsForModel.some(
    (candidate) => candidate !== tag && candidate.startsWith(`${tag}/`)
  );
  const duplicateBaseTag =
    allTagsForModel.filter((candidate) => candidate === tag).length > 1;

  return !hasSiblingVariant && !duplicateBaseTag;
}

// ---------------------------------------------------------------------
// Endpoint-level eligibility (ADR Decision 4). Never inferred from
// model-level summaries -- checked directly against endpoint fields.
// ---------------------------------------------------------------------

export const REQUIRED_STRUCTURED_OUTPUT_PARAMETER = "response_format";
// The current (non-deprecated) bounded-output parameter -- `max_tokens` is
// documented deprecated and is never used (ADR Decision 4).
export const REQUIRED_BOUNDED_OUTPUT_PARAMETER = "max_completion_tokens";

export const MIN_COMPLETION_TOKENS: Record<RouteRole, number> = {
  ADVOCATE: 1000,
  JUDGE: 1200
};

// Numeric endpoint `status` semantics are not pinned by any locked ADR/SPEC
// decision -- 0 (or absent) is treated as usable, any other numeric value
// as unavailable, matching OpenRouter's common "0 = active" convention.
// This assumption must be confirmed against real metadata at the live
// integration gate (ADR Decision 19); until then it is a documented,
// conservative implementation choice, easily revised.
function isEndpointStatusUsable(status: string | number | undefined): boolean {
  if (status === undefined) {
    return true;
  }

  if (typeof status === "number") {
    return status === 0;
  }

  return status.toLowerCase() === "active" || status.toLowerCase() === "online";
}

export type EndpointEvaluation =
  | {
      eligible: true;
      pricing: PricingSnapshot;
    }
  | { eligible: false; reasonCode: PreflightReasonCode };

export function evaluateEndpoint(params: {
  modelId: string;
  endpoint: RawOpenRouterEndpoint;
  role: RouteRole;
  estimatedInputTokens: number;
  outputCapTokens: number;
  allTagsForModel: string[];
  observedAt: string;
}): EndpointEvaluation {
  const {
    modelId,
    endpoint,
    role,
    estimatedInputTokens,
    outputCapTokens,
    allTagsForModel,
    observedAt
  } = params;

  if (!isEndpointStatusUsable(endpoint.status)) {
    return { eligible: false, reasonCode: "ENDPOINT_UNAVAILABLE" };
  }

  const supportedParameters = endpoint.supported_parameters ?? [];

  if (!supportedParameters.includes(REQUIRED_STRUCTURED_OUTPUT_PARAMETER)) {
    return { eligible: false, reasonCode: "STRUCTURED_OUTPUT_UNSUPPORTED" };
  }

  if (!supportedParameters.includes(REQUIRED_BOUNDED_OUTPUT_PARAMETER)) {
    return { eligible: false, reasonCode: "BOUNDED_OUTPUT_UNSUPPORTED" };
  }

  const maxCompletionTokens = endpoint.max_completion_tokens ?? null;

  if (maxCompletionTokens === null || maxCompletionTokens < MIN_COMPLETION_TOKENS[role]) {
    return { eligible: false, reasonCode: "BOUNDED_OUTPUT_UNSUPPORTED" };
  }

  const contextLength = endpoint.context_length ?? null;

  if (contextLength === null || contextLength < estimatedInputTokens + outputCapTokens) {
    return { eligible: false, reasonCode: "CONTEXT_TOO_SMALL" };
  }

  const maxPromptTokens = endpoint.max_prompt_tokens ?? null;

  if (maxPromptTokens !== null && maxPromptTokens < estimatedInputTokens) {
    return { eligible: false, reasonCode: "CONTEXT_TOO_SMALL" };
  }

  const pricingResult = buildPricingSnapshot(
    modelId,
    endpoint.tag,
    endpoint.pricing,
    observedAt
  );

  if (!pricingResult.eligible) {
    return { eligible: false, reasonCode: pricingResult.reasonCode };
  }

  if (!isUniquelyPinnable(endpoint.tag, allTagsForModel)) {
    return { eligible: false, reasonCode: "ENDPOINT_NOT_PINNABLE" };
  }

  return { eligible: true, pricing: pricingResult.snapshot };
}

// ---------------------------------------------------------------------
// Conservative per-attempt candidate cost, used both for deterministic
// selection (lowest-cost eligible route) and as the base figure preflight
// scales up with the retry reserve and safety factor.
// ---------------------------------------------------------------------

export function computeCandidateAttemptCostUsd(
  pricing: PricingSnapshot,
  estimatedInputTokens: number,
  outputCapTokens: number
): Decimal {
  const inputCost = pricing.effectiveInputPricePerToken.times(estimatedInputTokens);
  const outputCost = pricing.completionPricePerToken.times(outputCapTokens);

  return inputCost.plus(outputCost).plus(pricing.requestPriceUsd);
}

// ---------------------------------------------------------------------
// Deterministic route resolution (ADR Decisions 2, 5).
// ---------------------------------------------------------------------

export type RouteResolutionResult =
  | { eligible: true; route: ResolvedModelRoute }
  | { eligible: false; reasonCodes: PreflightReasonCode[] };

export function resolveModelRoute(params: {
  configuredModelId: string;
  models: RawOpenRouterModel[];
  endpoints: RawOpenRouterEndpoint[];
  role: RouteRole;
  estimatedInputTokens: number;
  outputCapTokens: number;
  observedAt: string;
}): RouteResolutionResult {
  const {
    configuredModelId,
    models,
    endpoints,
    role,
    estimatedInputTokens,
    outputCapTokens,
    observedAt
  } = params;

  const aliasCheck = checkAliasOrDynamicModel(configuredModelId);

  if (aliasCheck.blocked) {
    return { eligible: false, reasonCodes: [aliasCheck.reasonCode] };
  }

  const model = models.find((candidate) => candidate.id === configuredModelId);

  if (!model) {
    return { eligible: false, reasonCodes: ["MODEL_NOT_FOUND"] };
  }

  const canonicalModelId = model.canonical_slug ?? model.id;

  if (endpoints.length === 0) {
    return { eligible: false, reasonCodes: ["ENDPOINT_UNAVAILABLE"] };
  }

  const allTagsForModel = endpoints.map((endpoint) => endpoint.tag);
  const reasonCodes = new Set<PreflightReasonCode>();

  type Candidate = { endpoint: RawOpenRouterEndpoint; pricing: PricingSnapshot; costUsd: Decimal };
  const eligibleCandidates: Candidate[] = [];

  for (const endpoint of endpoints) {
    const evaluation = evaluateEndpoint({
      modelId: configuredModelId,
      endpoint,
      role,
      estimatedInputTokens,
      outputCapTokens,
      allTagsForModel,
      observedAt
    });

    if (!evaluation.eligible) {
      reasonCodes.add(evaluation.reasonCode);
      continue;
    }

    eligibleCandidates.push({
      endpoint,
      pricing: evaluation.pricing,
      costUsd: computeCandidateAttemptCostUsd(
        evaluation.pricing,
        estimatedInputTokens,
        outputCapTokens
      )
    });
  }

  if (eligibleCandidates.length === 0) {
    return { eligible: false, reasonCodes: Array.from(reasonCodes) };
  }

  // Deterministic selection: lowest-cost eligible route; stable tie-break
  // by providerEndpointTag lexical order (ADR Decision 5). Eligibility
  // filtering always precedes cost comparison -- a cheaper ineligible
  // endpoint is never considered "the price."
  eligibleCandidates.sort((a, b) => {
    const costComparison = a.costUsd.comparedTo(b.costUsd);

    if (costComparison !== 0) {
      return costComparison;
    }

    return a.endpoint.tag.localeCompare(b.endpoint.tag);
  });

  const selected = eligibleCandidates[0];

  const route: ResolvedModelRoute = {
    configuredModelId,
    canonicalModelId,
    providerEndpointTag: selected.endpoint.tag,
    isUniquelyPinnable: true,
    providerDisplayName: selected.endpoint.provider_name ?? selected.endpoint.tag,
    endpointDisplayName: selected.endpoint.name ?? selected.endpoint.tag,
    contextLength: selected.endpoint.context_length ?? 0,
    maxPromptTokens: selected.endpoint.max_prompt_tokens ?? null,
    maxCompletionTokens: selected.endpoint.max_completion_tokens ?? null,
    supportedParameters: selected.endpoint.supported_parameters ?? [],
    quantization: selected.endpoint.quantization ?? null,
    pricing: selected.pricing,
    observedAt
  };

  return { eligible: true, route };
}
