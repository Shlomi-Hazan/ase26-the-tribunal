// Milestone 7A -- extraction-specific model/endpoint eligibility and
// route resolution (ADR 0004 Decisions 9, 10, 13). Deliberately a
// SEPARATE evaluator from M7's routeResolution.ts `evaluateEndpoint`,
// which is parameterized by ADVOCATE/JUDGE `RouteRole` and the
// 1000/1200-token output floors -- extraction requires the much larger
// EXTRACTION_OUTPUT_CAP_TOKENS floor and is never inferred from the
// Tribunal FREE/BUDGET/PREMIUM tier classifier. Reuses M7's alias/
// pinnability/pricing primitives unchanged (the same real OpenRouter
// metadata shape, evaluated under a different bound), never duplicates
// them.

import Decimal from "decimal.js";
import {
  checkAliasOrDynamicModel,
  isUniquelyPinnable,
  REQUIRED_BOUNDED_OUTPUT_PARAMETER,
  REQUIRED_STRUCTURED_OUTPUT_PARAMETER
} from "../openrouter/routeResolution";
import { buildPricingSnapshot, type PricingSnapshot } from "../openrouter/pricing";
import type { PreflightReasonCode } from "../openrouter/errors";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";
import { EXTRACTION_OUTPUT_CAP_TOKENS } from "./constants";

export type ResolvedExtractionRoute = {
  configuredModelId: string;
  canonicalModelId: string;
  providerEndpointTag: string;
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

function isEndpointStatusUsable(status: string | number | undefined): boolean {
  if (status === undefined) {
    return true;
  }

  if (typeof status === "number") {
    return status === 0;
  }

  return status.toLowerCase() === "active" || status.toLowerCase() === "online";
}

export type ExtractionEndpointEvaluation =
  | { eligible: true; pricing: PricingSnapshot }
  | { eligible: false; reasonCode: PreflightReasonCode };

export function evaluateExtractionEndpoint(params: {
  modelId: string;
  endpoint: RawOpenRouterEndpoint;
  estimatedInputTokens: number;
  allTagsForModel: string[];
  observedAt: string;
}): ExtractionEndpointEvaluation {
  const { modelId, endpoint, estimatedInputTokens, allTagsForModel, observedAt } =
    params;

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

  // The one materially different floor from M7's evaluateEndpoint:
  // EXTRACTION_OUTPUT_CAP_TOKENS (65,000), never the 1000/1200 advocate/
  // judge caps -- this is the ADR's explicit "extraction eligibility is
  // never inferred from a route's Tribunal tier" boundary in code form.
  if (maxCompletionTokens === null || maxCompletionTokens < EXTRACTION_OUTPUT_CAP_TOKENS) {
    return { eligible: false, reasonCode: "BOUNDED_OUTPUT_UNSUPPORTED" };
  }

  const contextLength = endpoint.context_length ?? null;

  if (
    contextLength === null ||
    contextLength < estimatedInputTokens + EXTRACTION_OUTPUT_CAP_TOKENS
  ) {
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

export function computeExtractionCandidateCostUsd(
  pricing: PricingSnapshot,
  estimatedInputTokens: number
): Decimal {
  const inputCost = pricing.effectiveInputPricePerToken.times(estimatedInputTokens);
  const outputCost = pricing.completionPricePerToken.times(EXTRACTION_OUTPUT_CAP_TOKENS);

  return inputCost.plus(outputCost).plus(pricing.requestPriceUsd);
}

export type ExtractionRouteResolutionResult =
  | { eligible: true; route: ResolvedExtractionRoute }
  | { eligible: false; reasonCodes: PreflightReasonCode[] };

export function resolveExtractionModelRoute(params: {
  configuredModelId: string;
  models: RawOpenRouterModel[];
  endpoints: RawOpenRouterEndpoint[];
  estimatedInputTokens: number;
  observedAt: string;
}): ExtractionRouteResolutionResult {
  const { configuredModelId, models, endpoints, estimatedInputTokens, observedAt } =
    params;

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

  type Candidate = {
    endpoint: RawOpenRouterEndpoint;
    pricing: PricingSnapshot;
    costUsd: Decimal;
  };
  const eligibleCandidates: Candidate[] = [];

  for (const endpoint of endpoints) {
    const evaluation = evaluateExtractionEndpoint({
      modelId: configuredModelId,
      endpoint,
      estimatedInputTokens,
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
      costUsd: computeExtractionCandidateCostUsd(evaluation.pricing, estimatedInputTokens)
    });
  }

  if (eligibleCandidates.length === 0) {
    return { eligible: false, reasonCodes: Array.from(reasonCodes) };
  }

  eligibleCandidates.sort((a, b) => {
    const costComparison = a.costUsd.comparedTo(b.costUsd);

    if (costComparison !== 0) {
      return costComparison;
    }

    return a.endpoint.tag.localeCompare(b.endpoint.tag);
  });

  const selected = eligibleCandidates[0];

  const route: ResolvedExtractionRoute = {
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
