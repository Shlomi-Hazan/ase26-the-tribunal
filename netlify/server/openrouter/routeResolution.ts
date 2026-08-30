// Milestone 7 -- model discovery vs. resolved execution route
// (ADR Decisions 2, 4, 4A, 5, 8). A configured model ID alone never
// authorizes spend; every route is resolved to an exact, uniquely
// pinnable, priced provider endpoint before it can be considered eligible.

import Decimal from "decimal.js";
import type { PreflightReasonCode } from "./errors";
import { buildPricingSnapshot, type PricingSnapshot } from "./pricing";
import type { RawOpenRouterEndpoint, RawOpenRouterModel, RawOpenRouterModelReasoning } from "./schemas";

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
  // M8 reasoning-compatibility correction (Issue #17): the exact,
  // conservative M8 V1 reasoning effort this route is SAFE to send, or
  // `null` when no reasoning field should be sent at all -- never a bare
  // "this endpoint accepts a reasoning parameter" boolean (the second
  // real live run proved that conflation causes OpenRouter itself to
  // reject the request: an endpoint can generically accept the
  // `reasoning` parameter NAME while still rejecting the specific effort
  // VALUE this application would otherwise blindly send). Always derived
  // from resolveReasoningPolicy() using BOTH this exact endpoint's own
  // supported_parameters AND the exact model's own reasoning metadata --
  // never inferred from a model/provider name. Optional (never present
  // as an explicit `null` where it could instead be omitted) so the
  // separate, unrelated M7A extraction route type
  // (extraction/routeResolution.ts's ResolvedExtractionRoute, which
  // shares buildFutureCompletionRequest but predates and is out of scope
  // for this correction) remains structurally assignable without
  // adopting reasoning behavior it was never audited for -- an absent
  // value is always treated as "send no reasoning field."
  reasoningEffort?: ReasoningEffort | null;
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
// OpenRouter's unified reasoning-control parameter name (never required
// for eligibility -- a route without it is still eligible, it simply
// never receives a `reasoning` field on the completion request).
export const REASONING_CONTROL_PARAMETER = "reasoning";

export const MIN_COMPLETION_TOKENS: Record<RouteRole, number> = {
  ADVOCATE: 1000,
  JUDGE: 1200
};

// ---------------------------------------------------------------------
// Reasoning-effort compatibility (M8 reasoning-compatibility correction,
// Issue #17). Deliberately narrow for M8 V1: only "minimal" and "low"
// are ever selected -- never "medium"/"high"/"xhigh"/"max", and never a
// reasoning.max_tokens-style budget (a genuinely different request
// shape, out of scope here). A model this policy cannot safely control
// is excluded from the eligible Tribunal catalog entirely -- fail
// closed, not a broader adapter.
// ---------------------------------------------------------------------

export type ReasoningEffort = "minimal" | "low";

// Internal, camelCase mirror of the raw (snake_case, untrusted)
// OpenRouter model-level reasoning metadata -- converted once at the
// schemas.ts boundary, never read from the raw shape past this module.
export type ModelReasoningMetadata = {
  mandatory?: boolean;
  defaultEnabled?: boolean;
  supportedEfforts?: string[] | null;
  defaultEffort?: string;
  supportsMaxTokens?: boolean;
};

export function toModelReasoningMetadata(
  raw: RawOpenRouterModelReasoning | undefined
): ModelReasoningMetadata | null {
  if (!raw) {
    return null;
  }

  return {
    mandatory: raw.mandatory,
    defaultEnabled: raw.default_enabled,
    supportedEfforts: raw.supported_efforts,
    defaultEffort: raw.default_effort,
    supportsMaxTokens: raw.supports_max_tokens
  };
}

export type ReasoningPolicyResult =
  | { eligible: true; reasoningEffort: ReasoningEffort | null }
  | { eligible: false; reasonCode: "REASONING_CONTROL_UNSUPPORTED" };

// The DEFECT this corrects: "this endpoint accepts the unified
// `reasoning` parameter" (an ENDPOINT capability) is not the same fact
// as "this model accepts our specific effort-based reasoning policy" (a
// MODEL semantics question) -- conflating them let a model/route become
// Tribunal-eligible even though M8 could not safely construct the exact
// reasoning request it intended to send (the second real live run's
// `INVALID_PROVIDER_REQUEST` rejection). This function is the sole
// place that decision is made, using ONLY:
//   - whether the exact resolved endpoint advertises the `reasoning`
//     parameter name (never inferred, read from live supported_parameters);
//   - the exact model's own reasoning metadata (never inferred, read
//     from the live GET /models response) -- never a model/provider name.
export function resolveReasoningPolicy(params: {
  modelReasoning: ModelReasoningMetadata | null;
  endpointSupportsReasoningParameter: boolean;
}): ReasoningPolicyResult {
  const { modelReasoning, endpointSupportsReasoningParameter } = params;

  // The exact endpoint doesn't accept the unified reasoning parameter at
  // all -- nothing this application could send would be honored, so
  // nothing is sent, regardless of what the model's own metadata claims.
  // This is the existing, unchanged non-reasoning-endpoint behavior.
  if (!endpointSupportsReasoningParameter) {
    return { eligible: true, reasoningEffort: null };
  }

  // No model-level reasoning metadata at all -- treated as an ordinary
  // non-reasoning model. Deliberate, conservative default (never widen
  // this into "assume reasoning applies" without real signal); ordinary
  // non-reasoning models must never become ineligible merely because
  // OpenRouter's model metadata omits a reasoning block.
  if (!modelReasoning) {
    return { eligible: true, reasoningEffort: null };
  }

  const supportedEfforts = modelReasoning.supportedEfforts;

  // `null` is OpenRouter's own documented "every gateway effort is
  // accepted" signal -- "minimal" is always safe to choose under it.
  if (supportedEfforts === null) {
    return { eligible: true, reasoningEffort: "minimal" };
  }

  // An omitted (`undefined`) supportedEfforts is explicitly NOT the same
  // as `null` -- OpenRouter documents omission as "this model does not
  // expose effort selection," never as "accepts everything." Falling
  // through to the fail-closed branch below is intentional, not an
  // oversight (see test: "supported_efforts omitted -> fail closed").
  if (supportedEfforts?.includes("minimal")) {
    return { eligible: true, reasoningEffort: "minimal" };
  }

  if (supportedEfforts?.includes("low")) {
    return { eligible: true, reasoningEffort: "low" };
  }

  return { eligible: false, reasonCode: "REASONING_CONTROL_UNSUPPORTED" };
}

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
      reasoningEffort: ReasoningEffort | null;
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
  // M8 reasoning-compatibility correction (Issue #17): the exact
  // model's own reasoning metadata (never inferred from a name).
  // Optional/defaulted to `null` so every existing call site that
  // predates this correction and doesn't pass it keeps evaluating a
  // route exactly as an ordinary non-reasoning model -- unchanged
  // behavior for every route that doesn't actually need reasoning
  // control.
  modelReasoning?: ModelReasoningMetadata | null;
}): EndpointEvaluation {
  const {
    modelId,
    endpoint,
    role,
    estimatedInputTokens,
    outputCapTokens,
    allTagsForModel,
    observedAt,
    modelReasoning = null
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

  const reasoningPolicy = resolveReasoningPolicy({
    modelReasoning,
    endpointSupportsReasoningParameter: supportedParameters.includes(REASONING_CONTROL_PARAMETER)
  });

  if (!reasoningPolicy.eligible) {
    return { eligible: false, reasonCode: reasoningPolicy.reasonCode };
  }

  return {
    eligible: true,
    pricing: pricingResult.snapshot,
    reasoningEffort: reasoningPolicy.reasoningEffort
  };
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
  const modelReasoning = toModelReasoningMetadata(model.reasoning);

  type Candidate = {
    endpoint: RawOpenRouterEndpoint;
    pricing: PricingSnapshot;
    costUsd: Decimal;
    reasoningEffort: ReasoningEffort | null;
  };
  const eligibleCandidates: Candidate[] = [];

  for (const endpoint of endpoints) {
    const evaluation = evaluateEndpoint({
      modelId: configuredModelId,
      endpoint,
      role,
      estimatedInputTokens,
      outputCapTokens,
      allTagsForModel,
      observedAt,
      modelReasoning
    });

    if (!evaluation.eligible) {
      reasonCodes.add(evaluation.reasonCode);
      continue;
    }

    eligibleCandidates.push({
      endpoint,
      pricing: evaluation.pricing,
      reasoningEffort: evaluation.reasoningEffort,
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
    reasoningEffort: selected.reasoningEffort,
    quantization: selected.endpoint.quantization ?? null,
    pricing: selected.pricing,
    observedAt
  };

  return { eligible: true, route };
}
