// Milestone 7 -- sanitized model/route discovery surface
// (ARCHITECTURE.md Sec 5.3). Never proxies the raw OpenRouter catalog
// directly, never exposes credentials.
//
// Corrections (independent review, pre-live gate):
//   - the tier is now the SAME centralized complete-Tribunal route-tier
//     figure preflight.ts uses for `participant.priceTier`
//     (routeTierEconomics.ts) -- previously this endpoint classified the
//     tier from a single advocate attempt's cost only (no retry reserve,
//     no judge economics at all), which could materially understate a
//     route's real Tribunal-scale cost category.
//   - metadata fetches now go through the shared, injectable
//     ModelMetadataCache (cache.ts) instead of calling the provider
//     directly on every invocation, so a warm production container
//     reuses fresh metadata within the 5-minute TTL exactly like
//     preflight.ts already does, and stale metadata never authorizes
//     discovery.
//   - the returned field is renamed from the misleading
//     `conservativeSingleCallEstimateUsd` (it was never just one call)
//     to `conservativeFullTribunalEstimateUsd`, matching what it now
//     actually contains.

import { cachedFetch, ModelMetadataCache, type Clock } from "./cache";
import type { PriceTier } from "./pricing";
import { classifyPriceTier, toDecimalString, TIER_THRESHOLDS_USD } from "./pricing";
import { resolveModelRoute } from "./routeResolution";
import { computeConservativeFullTribunalCostForRoute } from "./routeTierEconomics";
import {
  ADVOCATE_OUTPUT_CAP_TOKENS,
  worstCaseAdvocateInputTokens
} from "./tokenEstimation";
import type { OpenRouterProvider } from "./provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

export type EligibleModel = {
  id: string;
  canonicalModelId: string;
  name: string;
  providerName: string;
  contextLength: number;
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  isFree: boolean;
  priceTier: PriceTier;
  // Renamed (independent review, pre-live gate) from
  // conservativeSingleCallEstimateUsd -- this is the complete, retry-
  // reserved, safety-factored 4-advocate/3-judge Tribunal shape costed
  // on this exact route, not one call.
  conservativeFullTribunalEstimateUsd: string;
  supportsStructuredOutput: boolean;
};

export type ModelDiscoveryDeps = {
  provider: OpenRouterProvider;
  modelCache?: ModelMetadataCache<RawOpenRouterModel[]>;
  endpointCache?: ModelMetadataCache<RawOpenRouterEndpoint[]>;
  clock?: Clock;
};

// Section 34: "follow ADR policy for ABOVE_PREMIUM exactly" -- ABOVE_PREMIUM
// technically satisfies the hard ceiling but must not automatically appear
// as a normal recommended choice without a separate later product
// decision. This endpoint therefore never returns a route this ceiling
// can't already justify (HARD_BLOCK is excluded entirely, matching
// "ineligible"), but does not withhold ABOVE_PREMIUM from the response --
// it is returned, correctly labelled, so the (future) UI can make the
// separate decision about how prominently to surface it, rather than the
// API silently deciding for it.
export async function listEligibleModels(deps: ModelDiscoveryDeps): Promise<EligibleModel[]> {
  const clock = deps.clock ?? Date.now;
  const modelCache =
    deps.modelCache ?? new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
  const endpointCache =
    deps.endpointCache ?? new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

  // Eligibility filtering itself still uses the same worst-case advocate
  // estimate as before (a route with too little context/prompt capacity
  // for even the worst-case advocate request is never eligible at all);
  // the TIER shown once eligible now comes from the centralized
  // full-Tribunal helper, not this narrower per-endpoint figure.
  const estimatedInputTokens = worstCaseAdvocateInputTokens();
  const observedAt = new Date(clock()).toISOString();
  const results: EligibleModel[] = [];

  const models = await cachedFetch(modelCache, "models", () => deps.provider.listModels());

  for (const model of models) {
    const separatorIndex = model.id.indexOf("/");
    const author = separatorIndex === -1 ? model.id : model.id.slice(0, separatorIndex);
    const slug = separatorIndex === -1 ? "" : model.id.slice(separatorIndex + 1);

    let endpoints: RawOpenRouterEndpoint[];

    try {
      endpoints = await cachedFetch(endpointCache, model.id, () =>
        deps.provider.listEndpoints(author, slug)
      );
    } catch {
      continue;
    }

    const resolution = resolveModelRoute({
      configuredModelId: model.id,
      models,
      endpoints,
      role: "ADVOCATE",
      estimatedInputTokens,
      outputCapTokens: ADVOCATE_OUTPUT_CAP_TOKENS,
      observedAt
    });

    if (!resolution.eligible) {
      continue;
    }

    const { route } = resolution;
    const conservativeFullTribunalCostUsd = computeConservativeFullTribunalCostForRoute(
      route.pricing
    );
    const priceTier = classifyPriceTier(conservativeFullTribunalCostUsd);

    if (priceTier === "HARD_BLOCK") {
      continue;
    }

    results.push({
      id: route.configuredModelId,
      canonicalModelId: route.canonicalModelId,
      name: model.name ?? route.canonicalModelId,
      providerName: route.providerDisplayName,
      contextLength: route.contextLength,
      promptPricePerMillion: toDecimalString(route.pricing.promptPricePerMillion),
      completionPricePerMillion: toDecimalString(route.pricing.completionPricePerMillion),
      isFree: priceTier === "FREE",
      priceTier,
      conservativeFullTribunalEstimateUsd: toDecimalString(conservativeFullTribunalCostUsd),
      supportsStructuredOutput: route.supportedParameters.includes("response_format")
    });
  }

  return results;
}

// Re-exported for callers that only need the fixed threshold constants
// alongside the discovery list (e.g. a future UI tier legend).
export { TIER_THRESHOLDS_USD };
