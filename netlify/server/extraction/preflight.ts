// Milestone 7A -- standalone, read-only, non-billable extraction
// preflight service (ADR 0004 Decision 9/19). Zero persistence, zero
// `createChatCompletion` calls. Mirrors M7's preflight.ts pattern
// (cachedFetch + ModelMetadataCache + requireCacheObservedAt), scoped to
// a single configured extraction model rather than seven participants.

import Decimal from "decimal.js";
import {
  cachedFetch,
  ModelMetadataCache,
  requireCacheObservedAt,
  type Clock
} from "../openrouter/cache";
import { toDecimalString } from "../openrouter/pricing";
import type { PreflightReasonCode } from "../openrouter/errors";
import type { OpenRouterProvider } from "../openrouter/provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";
import {
  computeExtractionCandidateCostUsd,
  resolveExtractionModelRoute,
  type ResolvedExtractionRoute
} from "./routeResolution";
import { estimateExtractionInputTokens } from "./tokenEstimation";
import {
  EXTRACTION_BUDGET_SAFETY_FACTOR,
  EXTRACTION_HARD_CEILING_USD,
  MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL
} from "./constants";

export type ExtractionPreflightResult = {
  eligible: boolean;
  configuredModelId: string;
  canonicalModelId: string | null;
  providerEndpointTag: string | null;
  conservativeMaxCostUsd: string;
  hardCeilingUsd: string;
  blockedReasonCodes: PreflightReasonCode[];
  pricingObservedAt: string | null;
  route: ResolvedExtractionRoute | null;
};

export type ExtractionPreflightDeps = {
  provider: OpenRouterProvider;
  modelCache?: ModelMetadataCache<RawOpenRouterModel[]>;
  endpointCache?: ModelMetadataCache<RawOpenRouterEndpoint[]>;
  clock?: Clock;
};

function splitModelId(modelId: string): { author: string; slug: string } {
  const separatorIndex = modelId.indexOf("/");

  if (separatorIndex === -1) {
    return { author: modelId, slug: "" };
  }

  return {
    author: modelId.slice(0, separatorIndex),
    slug: modelId.slice(separatorIndex + 1)
  };
}

// The single authoritative eligibility/conservative-cost computation --
// used identically by the read-only preflight quote (below) AND the
// billable initial/retry endpoints' authoritative re-check (service.ts),
// so the two can never silently diverge.
export async function evaluateExtractionEligibility(
  configuredModelId: string,
  normalizedDossierText: string,
  deps: ExtractionPreflightDeps
): Promise<ExtractionPreflightResult> {
  const clock = deps.clock ?? Date.now;
  const modelCache =
    deps.modelCache ?? new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
  const endpointCache =
    deps.endpointCache ?? new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

  const estimatedInputTokens = estimateExtractionInputTokens(normalizedDossierText);
  const { author, slug } = splitModelId(configuredModelId);

  let models: RawOpenRouterModel[];
  let endpoints: RawOpenRouterEndpoint[];
  let endpointObservedAt: string;

  try {
    models = await cachedFetch(modelCache, "models", () => deps.provider.listModels());
    endpoints = await cachedFetch(endpointCache, configuredModelId, () =>
      deps.provider.listEndpoints(author, slug)
    );
    endpointObservedAt = requireCacheObservedAt(endpointCache, configuredModelId);
  } catch {
    return {
      eligible: false,
      configuredModelId,
      canonicalModelId: null,
      providerEndpointTag: null,
      conservativeMaxCostUsd: "0",
      hardCeilingUsd: toDecimalString(EXTRACTION_HARD_CEILING_USD),
      blockedReasonCodes: ["PRICING_UNAVAILABLE"],
      pricingObservedAt: null,
      route: null
    };
  }

  const resolution = resolveExtractionModelRoute({
    configuredModelId,
    models,
    endpoints,
    estimatedInputTokens,
    observedAt: endpointObservedAt
  });

  if (!resolution.eligible) {
    return {
      eligible: false,
      configuredModelId,
      canonicalModelId: null,
      providerEndpointTag: null,
      conservativeMaxCostUsd: "0",
      hardCeilingUsd: toDecimalString(EXTRACTION_HARD_CEILING_USD),
      blockedReasonCodes: resolution.reasonCodes,
      pricingObservedAt: null,
      route: null
    };
  }

  const route = resolution.route;
  const perAttemptCost = computeExtractionCandidateCostUsd(
    route.pricing,
    estimatedInputTokens
  );
  // Both permitted attempts reserved (Decision 9) -- never assuming a
  // cheaper/warm-cache retry.
  const bothAttemptsCost = perAttemptCost.times(
    MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL
  );
  const conservativeMaxCostWithSafetyFactor = bothAttemptsCost.times(
    EXTRACTION_BUDGET_SAFETY_FACTOR
  );

  const blockedReasonCodes: PreflightReasonCode[] = [];

  if (conservativeMaxCostWithSafetyFactor.gt(EXTRACTION_HARD_CEILING_USD)) {
    blockedReasonCodes.push("BUDGET_EXCEEDED");
  }

  return {
    eligible: blockedReasonCodes.length === 0,
    configuredModelId,
    canonicalModelId: route.canonicalModelId,
    providerEndpointTag: route.providerEndpointTag,
    conservativeMaxCostUsd: toDecimalString(conservativeMaxCostWithSafetyFactor),
    hardCeilingUsd: toDecimalString(EXTRACTION_HARD_CEILING_USD),
    blockedReasonCodes,
    pricingObservedAt: route.observedAt,
    route
  };
}

// Retry-specific conservative guard (Decision 9): attempt #1's real spend
// (or its stored conservative maximum if unknown) + a fresh attempt #2
// conservative maximum <= EXTRACTION_HARD_CEILING_USD.
export function evaluateRetryBudget(params: {
  attemptOneActualCostUsd: string | null;
  attemptOneConservativeMaxCostUsd: string;
  attemptTwoConservativeMaxCostUsd: Decimal;
}): { allowed: boolean; totalUsd: Decimal } {
  const attempt1Debit =
    params.attemptOneActualCostUsd !== null
      ? Decimal.max(
          new Decimal(params.attemptOneActualCostUsd),
          new Decimal(params.attemptOneConservativeMaxCostUsd)
        )
      : new Decimal(params.attemptOneConservativeMaxCostUsd);

  const total = attempt1Debit.plus(params.attemptTwoConservativeMaxCostUsd);

  return { allowed: total.lte(EXTRACTION_HARD_CEILING_USD), totalUsd: total };
}
