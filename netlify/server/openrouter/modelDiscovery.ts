// Milestone 7 -- sanitized model/route discovery surface
// (ARCHITECTURE.md Sec 5.3). Never proxies the raw OpenRouter catalog
// directly, never exposes credentials.
//
// Corrections (independent review, pre-live gate, first pass):
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
//
// Corrections (independent review, pre-live gate, second pass):
//   - this endpoint resolved and evaluated every candidate route as an
//     ADVOCATE ONLY, then presented it as eligible for a "complete
//     Tribunal" whose tier includes 3 judges. A route can satisfy
//     advocate output/context capacity (>=1000 tokens) while failing
//     judge output/context capacity (>=1200 tokens, plus the judge's own
//     4x1000-token advocate-speech reservation) -- ARCHITECTURE.md
//     Sec 5.3's judge-prompt-capacity requirement was not actually
//     enforced here. `resolveSharedTribunalRoute` (below) now requires
//     the SAME exact endpoint to pass BOTH the advocate and the judge
//     eligibility contract before it is ever returned -- never two
//     independently resolved endpoints described as one route.
//   - PricingSnapshot.observedAt now reflects the actual endpoint
//     metadata cache fetch timestamp (ModelMetadataCache#observedAt),
//     never "whenever this invocation happened to run" -- see
//     `resolveSharedTribunalRoute`.

import {
  cachedFetch,
  ModelMetadataCache,
  requireCacheObservedAt,
  type Clock
} from "./cache";
import {
  checkAliasOrDynamicModel,
  evaluateEndpoint,
  toModelReasoningMetadata
} from "./routeResolution";
import type { PreflightReasonCode } from "./errors";
import type { PriceTier } from "./pricing";
import { classifyPriceTier, toDecimalString, TIER_THRESHOLDS_USD } from "./pricing";
import type { ResolvedModelRoute } from "./routeResolution";
import { computeConservativeFullTribunalCostForRoute } from "./routeTierEconomics";
import {
  ADVOCATE_OUTPUT_CAP_TOKENS,
  JUDGE_OUTPUT_CAP_TOKENS,
  worstCaseAdvocateInputTokens,
  worstCaseJudgeInputTokens
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
  // Added this pass (independent review, pre-live gate): the actual
  // endpoint metadata cache fetch timestamp this pricing was observed
  // at (ADR Decision 9) -- never the current invocation time. Exposed
  // publicly so GET /api/models's fetch-timestamp semantics are directly
  // observable/testable, matching POST /api/preflight's per-participant
  // pricing.observedAt.
  pricingObservedAt: string;
};

export type ModelDiscoveryDeps = {
  provider: OpenRouterProvider;
  modelCache?: ModelMetadataCache<RawOpenRouterModel[]>;
  endpointCache?: ModelMetadataCache<RawOpenRouterEndpoint[]>;
  clock?: Clock;
};

// Discovery-scale correction (live integration gate): the real OpenRouter
// catalog observed live was ~387 models. A fully sequential
// one-endpoint-fetch-per-model sweep took ~45.7s cold against real data --
// close enough to a typical serverless function's execution deadline to
// be a genuine reliability risk, not just a slow best case. Bounded to 8
// concurrent in-flight `listEndpoints()` calls: no current official
// OpenRouter rate-limit document (reverified against
// https://openrouter.ai/openapi.json immediately before this change)
// specifies a numeric per-second/per-minute limit for this metadata
// endpoint that would make 8 unsafe -- only the generic 429 response
// shape and a deprecated, always -1 `rate_limit` field exist. If that
// ever changes, this is a deliberate, separately reviewed value to
// revisit, not something to silently raise.
export const MODEL_DISCOVERY_ENDPOINT_CONCURRENCY = 8;

// Deterministic bounded-concurrency worker pool: at most `concurrency`
// calls to `worker` are ever in flight at once, but the returned array
// is always in the same order as `items` regardless of which call
// actually settles first -- network completion order must never become
// result order. One worker's rejection is only possible if `worker`
// itself throws; every call site below always resolves (its own
// try/catch turns a per-model failure into `null`), so one endpoint
// fetch failing never aborts the pool or any other in-flight worker.
async function mapWithBoundedConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results;
}

// ---------------------------------------------------------------------
// Dual-role ("shared Tribunal") route resolver (independent review,
// pre-live gate, second pass). Narrowly scoped to this generic discovery
// use case -- frozen-run preflight (preflight.ts) remains correctly
// role-specific per participant and is NOT changed by this. Reuses
// routeResolution.ts's checkAliasOrDynamicModel/evaluateEndpoint rather
// than duplicating eligibility logic; only the candidate-selection
// orchestration (require both role contracts, then rank) is new.
// ---------------------------------------------------------------------

export type SharedTribunalRouteResult =
  | { eligible: true; route: ResolvedModelRoute }
  | { eligible: false; reasonCodes: PreflightReasonCode[] };

// An endpoint is only returned by generic Shared-Tribunal discovery when
// the SAME exact endpoint passes both the advocate and the judge
// eligibility contract (Section 4 of the correction task) -- never a
// cheaper advocate-only endpoint standing in for a route that cannot
// actually judge. Selection ranks surviving (both-eligible) candidates
// by the same centralized full-Tribunal cost (routeTierEconomics.ts)
// already used for the tier, so ranking and tiering can never disagree;
// ties break by the same stable providerEndpointTag lexical order used
// everywhere else (ADR Decision 5).
export function resolveSharedTribunalRoute(params: {
  configuredModelId: string;
  models: RawOpenRouterModel[];
  endpoints: RawOpenRouterEndpoint[];
  observedAt: string;
}): SharedTribunalRouteResult {
  const { configuredModelId, models, endpoints, observedAt } = params;

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
  const advocateInputTokens = worstCaseAdvocateInputTokens();
  const judgeInputTokens = worstCaseJudgeInputTokens();
  const modelReasoning = toModelReasoningMetadata(model.reasoning);

  type Candidate = {
    endpoint: RawOpenRouterEndpoint;
    route: ResolvedModelRoute;
    fullTribunalCostUsd: ReturnType<typeof computeConservativeFullTribunalCostForRoute>;
  };
  const eligibleCandidates: Candidate[] = [];

  for (const endpoint of endpoints) {
    const advocateEval = evaluateEndpoint({
      modelId: configuredModelId,
      endpoint,
      role: "ADVOCATE",
      estimatedInputTokens: advocateInputTokens,
      outputCapTokens: ADVOCATE_OUTPUT_CAP_TOKENS,
      allTagsForModel,
      observedAt,
      modelReasoning
    });

    if (!advocateEval.eligible) {
      reasonCodes.add(advocateEval.reasonCode);
      continue;
    }

    const judgeEval = evaluateEndpoint({
      modelId: configuredModelId,
      endpoint,
      role: "JUDGE",
      estimatedInputTokens: judgeInputTokens,
      outputCapTokens: JUDGE_OUTPUT_CAP_TOKENS,
      allTagsForModel,
      observedAt,
      modelReasoning
    });

    if (!judgeEval.eligible) {
      reasonCodes.add(judgeEval.reasonCode);
      continue;
    }

    // Pricing is endpoint-specific, not role-specific -- both
    // evaluations of the same endpoint necessarily produced the same
    // PricingSnapshot; either is authoritative here.
    const pricing = advocateEval.pricing;

    const route: ResolvedModelRoute = {
      configuredModelId,
      canonicalModelId,
      providerEndpointTag: endpoint.tag,
      isUniquelyPinnable: true,
      providerDisplayName: endpoint.provider_name ?? endpoint.tag,
      endpointDisplayName: endpoint.name ?? endpoint.tag,
      contextLength: endpoint.context_length ?? 0,
      maxPromptTokens: endpoint.max_prompt_tokens ?? null,
      maxCompletionTokens: endpoint.max_completion_tokens ?? null,
      supportedParameters: endpoint.supported_parameters ?? [],
      // Pricing is endpoint-specific, not role-specific -- both
      // evaluations of the same endpoint necessarily produced the same
      // reasoningEffort too (it never varies by role); either is
      // authoritative here.
      reasoningEffort: advocateEval.reasoningEffort,
      quantization: endpoint.quantization ?? null,
      pricing,
      observedAt
    };

    eligibleCandidates.push({
      endpoint,
      route,
      fullTribunalCostUsd: computeConservativeFullTribunalCostForRoute(pricing)
    });
  }

  if (eligibleCandidates.length === 0) {
    return { eligible: false, reasonCodes: Array.from(reasonCodes) };
  }

  eligibleCandidates.sort((a, b) => {
    const costComparison = a.fullTribunalCostUsd.comparedTo(b.fullTribunalCostUsd);

    if (costComparison !== 0) {
      return costComparison;
    }

    return a.endpoint.tag.localeCompare(b.endpoint.tag);
  });

  return { eligible: true, route: eligibleCandidates[0].route };
}

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

  const models = await cachedFetch(modelCache, "models", () => deps.provider.listModels());

  // Bounded-concurrency sweep (Section 5/6/7 of the discovery-scale
  // correction): identical per-model eligibility/pricing logic to the
  // previous fully-sequential loop, only the scheduling changed. Each
  // worker call always resolves to `EligibleModel | null` -- it never
  // throws -- so one model's endpoint-fetch failure can never abort the
  // pool or affect any other model's result, and the final `filter`
  // below preserves `models`' original order regardless of which
  // network call actually completed first.
  const perModelResults = await mapWithBoundedConcurrency(
    models,
    MODEL_DISCOVERY_ENDPOINT_CONCURRENCY,
    async (model): Promise<EligibleModel | null> => {
      const separatorIndex = model.id.indexOf("/");
      const author = separatorIndex === -1 ? model.id : model.id.slice(0, separatorIndex);
      const slug = separatorIndex === -1 ? "" : model.id.slice(separatorIndex + 1);

      let endpoints: RawOpenRouterEndpoint[];
      let endpointObservedAt: string;

      try {
        endpoints = await cachedFetch(endpointCache, model.id, () =>
          deps.provider.listEndpoints(author, slug)
        );
        // Corrected this pass (independent review, pre-live micro-
        // correction): PricingSnapshot.observedAt is contractually the
        // metadata FETCH timestamp (ADR Decision 9). requireCacheObservedAt
        // throws rather than returning null -- there is deliberately no
        // `?? currentInvocationTime` fallback here anymore. A model whose
        // endpoint observation timestamp is unexpectedly unavailable
        // immediately after a successful fetch is never returned with a
        // fabricated pricingObservedAt -- it is skipped, exactly like any
        // other metadata fetch failure.
        endpointObservedAt = requireCacheObservedAt(endpointCache, model.id);
      } catch {
        return null;
      }

      const resolution = resolveSharedTribunalRoute({
        configuredModelId: model.id,
        models,
        endpoints,
        observedAt: endpointObservedAt
      });

      if (!resolution.eligible) {
        return null;
      }

      const { route } = resolution;
      const conservativeFullTribunalCostUsd = computeConservativeFullTribunalCostForRoute(
        route.pricing
      );
      const priceTier = classifyPriceTier(conservativeFullTribunalCostUsd);

      if (priceTier === "HARD_BLOCK") {
        return null;
      }

      return {
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
        supportsStructuredOutput: route.supportedParameters.includes("response_format"),
        pricingObservedAt: route.observedAt
      };
    }
  );

  return perModelResults.filter((result): result is EligibleModel => result !== null);
}

// Re-exported for callers that only need the fixed threshold constants
// alongside the discovery list (e.g. a future UI tier legend).
export { TIER_THRESHOLDS_USD };
