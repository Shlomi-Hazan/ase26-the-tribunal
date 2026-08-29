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
import { ProviderError, type PreflightReasonCode } from "../openrouter/errors";
import type { OpenRouterProvider } from "../openrouter/provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";
import {
  computeExtractionCandidateCostUsd,
  resolveExtractionModelRoute,
  type ResolvedExtractionRoute
} from "./routeResolution";
import { estimateExtractionInputTokens } from "./tokenEstimation";
import { ExtractionError } from "./errors";
import type { HandlerDeadline } from "./deadline";
import {
  EXTRACTION_BUDGET_SAFETY_FACTOR,
  EXTRACTION_HARD_CEILING_USD,
  MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL,
  PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS
} from "./constants";

// Corrected this pass (independent pre-live audit, Section 2): attempt-
// level vs. logical-call economics were conflated -- the single
// `conservativeMaxCostUsd` field was the WHOLE two-attempt logical
// reserve, but was being stored as if it were attempt #1's own
// per-attempt maximum (netlify/server/extraction/service.ts), so a
// retry's budget guard added a second logical-call-sized figure on top
// of an already-doubled attempt #1 debit and could incorrectly block a
// retry that was always within the original <= $0.50 reservation.
// `perAttemptConservativeMaxCostUsd` is what an individual attempt claim
// (Decision 15) must store; `logicalConservativeMaxCostUsd` is the
// complete-logical-call figure the preflight quote/UI displays (ADR
// Decision 9) -- the two are never interchangeable, and every caller
// must pick the field it actually means.
export type ExtractionPreflightResult = {
  eligible: boolean;
  configuredModelId: string;
  canonicalModelId: string | null;
  providerEndpointTag: string | null;
  perAttemptConservativeMaxCostUsd: string;
  logicalConservativeMaxCostUsd: string;
  hardCeilingUsd: string;
  blockedReasonCodes: PreflightReasonCode[];
  pricingObservedAt: string | null;
  route: ResolvedExtractionRoute | null;
};

export type ExtractionPreflightDeps = {
  provider: OpenRouterProvider;
  // Corrected this pass (independent pre-live audit, Section 6): the
  // handler-wide soft deadline (Decision 8) must govern EVERY network
  // await this path makes, not only the final completion call --
  // listModels()/listEndpoints() otherwise ran under
  // RealOpenRouterProvider's own default 60,000ms timeout, which alone
  // could consume/exceed the whole 55s handler budget before it was ever
  // rechecked. `deadline` is checked immediately before each uncached
  // network operation (a cache hit skips the check entirely -- there is
  // no network await to bound); `createTimedMetadataProvider`, if
  // supplied, builds a fresh provider whose own timeout is capped at the
  // freshly recomputed remaining time for that specific call.
  deadline: HandlerDeadline;
  createTimedMetadataProvider?: (timeoutMs: number) => OpenRouterProvider;
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
    models = await cachedFetch(modelCache, "models", () => {
      // Checked immediately before this uncached network operation --
      // a fresh cache hit never reaches this callback at all.
      deps.deadline.assertMinimumWindow();

      const timedProvider = deps.createTimedMetadataProvider
        ? deps.createTimedMetadataProvider(deps.deadline.remainingMs())
        : deps.provider;

      return timedProvider.listModels();
    });
    endpoints = await cachedFetch(endpointCache, configuredModelId, () => {
      // Recomputed fresh again -- never reuses the check/value from the
      // listModels() call above, which may itself have consumed time.
      deps.deadline.assertMinimumWindow();

      const timedProvider = deps.createTimedMetadataProvider
        ? deps.createTimedMetadataProvider(deps.deadline.remainingMs())
        : deps.provider;

      return timedProvider.listEndpoints(author, slug);
    });
    endpointObservedAt = requireCacheObservedAt(endpointCache, configuredModelId);
  } catch (error) {
    // A deadline exhaustion must propagate as its own distinct outcome
    // (INPUT_PROCESSING_TIMEOUT), never be swallowed into the generic
    // PRICING_UNAVAILABLE catch-all below.
    if (error instanceof ExtractionError) {
      throw error;
    }

    // Corrected this pass (second independent pre-live re-audit, Section
    // 10): `createTimedMetadataProvider(deps.deadline.remainingMs())`
    // constructs a provider whose OWN abort timeout is EXACTLY the
    // handler's remaining time at that call -- so a ProviderError
    // TIMEOUT surfacing from it is not, in general, ordinary provider
    // unavailability; when the handler's deadline window is genuinely
    // exhausted (or effectively so) by the time this error is caught,
    // it means the handler budget itself ran out, not that pricing is
    // merely unavailable. Re-checking `remainingMs()` HERE (a fresh
    // read, not reused from before the network call) is the same
    // "recompute don't cache across an await" discipline
    // HandlerDeadline's own docs require everywhere else. A TIMEOUT
    // that still leaves a healthy window remaining is left as-is
    // (genuine provider-side slowness, unrelated to this handler's own
    // budget) -- falls through to the existing PRICING_UNAVAILABLE path
    // below, unchanged.
    if (
      error instanceof ProviderError &&
      error.category === "TIMEOUT" &&
      deps.deadline.remainingMs() < PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS
    ) {
      throw new ExtractionError(
        "INPUT_PROCESSING_TIMEOUT",
        "Insufficient time remained in the handler's soft deadline for a metadata fetch."
      );
    }

    return {
      eligible: false,
      configuredModelId,
      canonicalModelId: null,
      providerEndpointTag: null,
      perAttemptConservativeMaxCostUsd: "0",
      logicalConservativeMaxCostUsd: "0",
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
      perAttemptConservativeMaxCostUsd: "0",
      logicalConservativeMaxCostUsd: "0",
      hardCeilingUsd: toDecimalString(EXTRACTION_HARD_CEILING_USD),
      blockedReasonCodes: resolution.reasonCodes,
      pricingObservedAt: null,
      route: null
    };
  }

  const route = resolution.route;
  const perAttemptCandidateCost = computeExtractionCandidateCostUsd(
    route.pricing,
    estimatedInputTokens
  );
  // Locked rule (Section 2, independent pre-live audit): the safety
  // factor applies once, at the PER-ATTEMPT level -- this is the exact
  // figure a single attempt claim (Decision 15) must store. The
  // whole-logical-call figure (both permitted attempts, Decision 9) is
  // derived from it, never the other way around, so there is exactly
  // one place either value can be computed from.
  const perAttemptConservativeMaxCostUsd = perAttemptCandidateCost.times(
    EXTRACTION_BUDGET_SAFETY_FACTOR
  );
  const logicalConservativeMaxCostUsd = perAttemptConservativeMaxCostUsd.times(
    MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL
  );

  const blockedReasonCodes: PreflightReasonCode[] = [];

  if (logicalConservativeMaxCostUsd.gt(EXTRACTION_HARD_CEILING_USD)) {
    blockedReasonCodes.push("BUDGET_EXCEEDED");
  }

  return {
    eligible: blockedReasonCodes.length === 0,
    configuredModelId,
    canonicalModelId: route.canonicalModelId,
    providerEndpointTag: route.providerEndpointTag,
    perAttemptConservativeMaxCostUsd: toDecimalString(perAttemptConservativeMaxCostUsd),
    logicalConservativeMaxCostUsd: toDecimalString(logicalConservativeMaxCostUsd),
    hardCeilingUsd: toDecimalString(EXTRACTION_HARD_CEILING_USD),
    blockedReasonCodes,
    pricingObservedAt: route.observedAt,
    route
  };
}

// Retry-specific conservative guard (Decision 9): attempt #1's real spend
// (or its stored PER-ATTEMPT conservative maximum if unknown) + a fresh
// PER-ATTEMPT conservative maximum for attempt #2 <=
// EXTRACTION_HARD_CEILING_USD. Both inputs and the comparison are
// per-attempt figures -- this function never receives or derives a
// logical (both-attempts) figure; the TypeScript pre-check exists only
// for fast client-visible failure -- the atomic claim RPC
// (claim_setup_extraction_attempt_two) re-verifies this same formula
// server-authoritatively before ever inserting attempt #2 (Section 3).
export function evaluateRetryBudget(params: {
  attemptOneActualCostUsd: string | null;
  attemptOnePerAttemptConservativeMaxCostUsd: string;
  attemptTwoPerAttemptConservativeMaxCostUsd: Decimal;
}): { allowed: boolean; totalUsd: Decimal } {
  const attempt1Debit =
    params.attemptOneActualCostUsd !== null
      ? Decimal.max(
          new Decimal(params.attemptOneActualCostUsd),
          new Decimal(params.attemptOnePerAttemptConservativeMaxCostUsd)
        )
      : new Decimal(params.attemptOnePerAttemptConservativeMaxCostUsd);

  const total = attempt1Debit.plus(params.attemptTwoPerAttemptConservativeMaxCostUsd);

  return { allowed: total.lte(EXTRACTION_HARD_CEILING_USD), totalUsd: total };
}
