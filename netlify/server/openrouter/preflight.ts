// Milestone 7 -- standalone, read-only authoritative preflight service
// (ADR Decisions 14, 15). Zero persistence, zero run mutation, zero
// completion calls. Does not touch POST /api/runs or the M6 freeze RPC.

import Decimal from "decimal.js";
import {
  ADVOCATE_PROMPT_VERSION,
  JUDGE_PROMPT_VERSION,
  PROMPT_VERSION_PLACEHOLDER
} from "../../../src/prompts/versions";
import { buildAdvocateSystemPrompt, type AdvocateSide } from "../../../src/prompts/advocate-system";
import { JUDGE_SYSTEM_PROMPT } from "../../../src/prompts/judge-system";
import type { PreflightReasonCode } from "./errors";
import {
  cachedFetch,
  ModelMetadataCache,
  requireCacheObservedAt,
  type Clock
} from "./cache";
import { classifyPriceTier, toDecimalString, type PriceTier } from "./pricing";
import {
  computeCandidateAttemptCostUsd,
  resolveModelRoute,
  type ResolvedModelRoute,
  type RouteRole
} from "./routeResolution";
import { computeConservativeFullTribunalCostForRoute } from "./routeTierEconomics";
import {
  estimateAdvocateInputTokens,
  estimateJudgeInputTokens,
  outputCapTokensForRole,
  serializeChargeSheetForModelContext
} from "./tokenEstimation";
import type { OpenRouterProvider } from "./provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";
import type { ParticipantId } from "../../../src/schemas/tribunalSetup";
// Correction (independent review, pre-live gate): these locked economics
// constants now live in economicsConstants.ts, shared unchanged with
// routeTierEconomics.ts and modelDiscovery.ts -- re-exported here so
// nothing importing them from preflight.ts (their original home) breaks.
export {
  MAX_RUN_COST_USD,
  BUDGET_SAFETY_FACTOR,
  MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL,
  TOTAL_LOGICAL_CALLS
} from "./economicsConstants";
import {
  MAX_RUN_COST_USD,
  BUDGET_SAFETY_FACTOR,
  MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL,
  TOTAL_LOGICAL_CALLS
} from "./economicsConstants";

const ROLE_BY_PARTICIPANT_ID: Record<ParticipantId, RouteRole> = {
  "advocate-pro-1": "ADVOCATE",
  "advocate-pro-2": "ADVOCATE",
  "advocate-con-1": "ADVOCATE",
  "advocate-con-2": "ADVOCATE",
  "judge-1": "JUDGE",
  "judge-2": "JUDGE",
  "judge-3": "JUDGE"
};

const SIDE_BY_PARTICIPANT_ID: Record<ParticipantId, AdvocateSide | null> = {
  "advocate-pro-1": "PRO",
  "advocate-pro-2": "PRO",
  "advocate-con-1": "CON",
  "advocate-con-2": "CON",
  "judge-1": null,
  "judge-2": null,
  "judge-3": null
};

const EXPECTED_PROMPT_VERSION: Record<RouteRole, string> = {
  ADVOCATE: ADVOCATE_PROMPT_VERSION,
  JUDGE: JUDGE_PROMPT_VERSION
};

export type PreflightRunParticipant = {
  participantId: ParticipantId;
  modelId: string;
  personality: string;
  promptVersion: string;
};

export type PreflightRun = {
  id: string;
  caseId: string;
  participants: PreflightRunParticipant[];
};

export type PreflightCase = {
  defendant: string;
  act: string;
  exactQuestion: string;
};

export type PreflightRunLoader = {
  getRun(runId: string): Promise<PreflightRun | null>;
  getCase(caseId: string): Promise<PreflightCase | null>;
};

export class PreflightRunNotFoundError extends Error {
  constructor() {
    super("Run not found.");
    this.name = "PreflightRunNotFoundError";
  }
}

export class PreflightPersistenceError extends Error {
  constructor(message = "Preflight failed to load required data.") {
    super(message);
    this.name = "PreflightPersistenceError";
  }
}

export type PreflightParticipantResult = {
  participantId: ParticipantId;
  configuredModelId: string;
  canonicalModelId: string | null;
  modelEligible: boolean;
  providerName: string | null;
  providerEndpointIdOrTag: string | null;
  // M8 reasoning-compatibility correction (Issue #17): carried straight
  // from the exact ResolvedModelRoute THIS preflight resolved -- never
  // inferred from configuredModelId/canonicalModelId. "minimal" or "low"
  // only when this exact endpoint AND this exact model's own reasoning
  // metadata together prove it safe (routeResolution.ts's
  // resolveReasoningPolicy); null for every ineligible participant (no
  // route was ever resolved to ask) and for any route that doesn't need
  // reasoning control at all.
  reasoningEffort: "minimal" | "low" | null;
  priceTier: PriceTier | null;
  conservativeParticipantCostUsd: string | null;
  pricing: {
    promptPricePerToken: string;
    completionPricePerToken: string;
    requestPriceUsd: string;
    cacheReadPricePerToken: string | null;
    cacheWritePricePerToken: string | null;
    effectiveInputPricePerToken: string;
    promptPricePerMillion: string;
    completionPricePerMillion: string;
    currency: "USD";
    observedAt: string;
  } | null;
  reasonCodes: PreflightReasonCode[];
};

export type PreflightResult = {
  eligible: boolean;
  runId: string;
  hardBudgetUsd: string;
  conservativeMaxCostUsd: string;
  remainingBudgetUsd: string;
  blockedReasonCodes: PreflightReasonCode[];
  pricingObservedAt: string | null;
  participants: PreflightParticipantResult[];
};

export type PreflightServiceDeps = {
  runLoader: PreflightRunLoader;
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

// Correction (independent review, pre-live gate): the prior "one
// participant's own retry-reserved cost x 7" approximation is removed.
// It was wrong for any judge participant -- judge economics (1200-token
// output cap, plus the 4x1000-token advocate-speech input reservation no
// advocate carries) differ materially from advocate economics, so
// scaling a judge's own cost by 7 systematically misrepresented what
// the same route would cost across the real 4-advocate/3-judge shape.
// `computeConservativeFullTribunalCostForRoute` (routeTierEconomics.ts)
// is now the single shared helper for this route-discovery tier,
// correctly weighting 4 advocate + 3 judge attempts with their own
// distinct token/output bounds -- used identically here and by
// GET /api/models (modelDiscovery.ts).

export async function runPreflight(
  runId: string,
  deps: PreflightServiceDeps
): Promise<PreflightResult> {
  const clock = deps.clock ?? Date.now;
  const modelCache =
    deps.modelCache ?? new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
  const endpointCache =
    deps.endpointCache ?? new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

  const run = await deps.runLoader.getRun(runId);

  if (!run) {
    throw new PreflightRunNotFoundError();
  }

  if (run.participants.length !== TOTAL_LOGICAL_CALLS) {
    throw new PreflightPersistenceError("Run does not have exactly seven participants.");
  }

  const tribunalCase = await deps.runLoader.getCase(run.caseId);

  if (!tribunalCase) {
    throw new PreflightPersistenceError("Run's case could not be loaded.");
  }

  const blockedReasonCodes = new Set<PreflightReasonCode>();
  const participants: PreflightParticipantResult[] = [];
  let conservativeMaxCostUsd = new Decimal(0);
  let anyPricingObservedAt: string | null = null;

  for (const participant of run.participants) {
    const role = ROLE_BY_PARTICIPANT_ID[participant.participantId];
    const side = SIDE_BY_PARTICIPANT_ID[participant.participantId];

    // Reject a run whose prompt_version is still the pre-M7 placeholder,
    // or any value other than the current role-specific version -- never
    // reported execution-eligible (SPEC.md MODEL-006, Section 35).
    if (
      participant.promptVersion === PROMPT_VERSION_PLACEHOLDER ||
      participant.promptVersion !== EXPECTED_PROMPT_VERSION[role]
    ) {
      blockedReasonCodes.add("PROMPT_VERSION_UNASSIGNED");
      participants.push({
        participantId: participant.participantId,
        configuredModelId: participant.modelId,
        canonicalModelId: null,
        modelEligible: false,
        providerName: null,
        providerEndpointIdOrTag: null,
        reasoningEffort: null,
        priceTier: null,
        conservativeParticipantCostUsd: null,
        pricing: null,
        reasonCodes: ["PROMPT_VERSION_UNASSIGNED"]
      });
      continue;
    }

    // Uses the same canonical serializer worstCaseAdvocateInputTokens/
    // worstCaseJudgeInputTokens use (tokenEstimation.ts) -- one contract,
    // not two independently-written copies that can silently drift.
    const chargeSheetText = serializeChargeSheetForModelContext({
      defendant: tribunalCase.defendant,
      act: tribunalCase.act,
      exactQuestion: tribunalCase.exactQuestion
    });

    const estimatedInputTokens =
      role === "ADVOCATE"
        ? estimateAdvocateInputTokens({
            basePrompt: buildAdvocateSystemPrompt(side ?? "PRO"),
            sideInstructions: side ?? "",
            personality: participant.personality,
            chargeSheetText
          })
        : estimateJudgeInputTokens({
            basePrompt: JUDGE_SYSTEM_PROMPT,
            personality: participant.personality,
            chargeSheetText
          });

    const outputCapTokens = outputCapTokensForRole(role);

    const { author, slug } = splitModelId(participant.modelId);

    let models: RawOpenRouterModel[];
    let endpoints: RawOpenRouterEndpoint[];
    let endpointObservedAt: string;

    try {
      models = await cachedFetch(modelCache, "models", () => deps.provider.listModels());
      endpoints = await cachedFetch(endpointCache, participant.modelId, () =>
        deps.provider.listEndpoints(author, slug)
      );
      // Corrected this pass (independent review, pre-live micro-
      // correction): PricingSnapshot.observedAt is contractually the
      // metadata FETCH timestamp (ADR Decision 9). requireCacheObservedAt
      // throws rather than returning null -- there is deliberately no
      // `?? currentInvocationTime` fallback here anymore. If the endpoint
      // cache's observation timestamp is unexpectedly unavailable
      // immediately after a successful fetch of that same key, the
      // application does not actually know when the pricing was
      // observed, and must not fabricate a value -- it fails closed via
      // the same catch block below, exactly like any other metadata
      // fetch failure.
      endpointObservedAt = requireCacheObservedAt(endpointCache, participant.modelId);
    } catch {
      blockedReasonCodes.add("PRICING_UNAVAILABLE");
      participants.push({
        participantId: participant.participantId,
        configuredModelId: participant.modelId,
        canonicalModelId: null,
        modelEligible: false,
        providerName: null,
        providerEndpointIdOrTag: null,
        reasoningEffort: null,
        priceTier: null,
        conservativeParticipantCostUsd: null,
        pricing: null,
        reasonCodes: ["PRICING_UNAVAILABLE"]
      });
      continue;
    }

    const resolution = resolveModelRoute({
      configuredModelId: participant.modelId,
      models,
      endpoints,
      role,
      estimatedInputTokens,
      outputCapTokens,
      observedAt: endpointObservedAt
    });

    if (!resolution.eligible) {
      for (const code of resolution.reasonCodes) {
        blockedReasonCodes.add(code);
      }

      participants.push({
        participantId: participant.participantId,
        configuredModelId: participant.modelId,
        canonicalModelId: null,
        modelEligible: false,
        providerName: null,
        providerEndpointIdOrTag: null,
        reasoningEffort: null,
        priceTier: null,
        conservativeParticipantCostUsd: null,
        pricing: null,
        reasonCodes: resolution.reasonCodes
      });
      continue;
    }

    const route: ResolvedModelRoute = resolution.route;
    const attemptCost = computeCandidateAttemptCostUsd(
      route.pricing,
      estimatedInputTokens,
      outputCapTokens
    );
    // Retry reserve (Section 22): the same conservative per-attempt cost
    // is reserved for both the initial attempt and the one permitted
    // retry -- never assuming a warm cache, a cache discount, or a
    // cheaper retry.
    const participantCostWithRetry = attemptCost.times(
      MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL
    );

    conservativeMaxCostUsd = conservativeMaxCostUsd.plus(participantCostWithRetry);
    anyPricingObservedAt = route.observedAt;

    participants.push({
      participantId: participant.participantId,
      configuredModelId: route.configuredModelId,
      canonicalModelId: route.canonicalModelId,
      modelEligible: true,
      providerName: route.providerDisplayName,
      providerEndpointIdOrTag: route.providerEndpointTag,
      reasoningEffort: route.reasoningEffort ?? null,
      // Route-discovery tier: what this exact resolved route/pricing
      // would conservatively cost across the complete fixed Tribunal
      // shape -- a reusable category of the ROUTE, not a measurement of
      // this participant's own contribution (that remains
      // conservativeParticipantCostUsd, just below, unaffected by this
      // correction). Identical helper/formula to GET /api/models
      // (modelDiscovery.ts) for the same route.
      priceTier: classifyPriceTier(
        computeConservativeFullTribunalCostForRoute(route.pricing)
      ),
      conservativeParticipantCostUsd: toDecimalString(participantCostWithRetry),
      pricing: {
        promptPricePerToken: toDecimalString(route.pricing.promptPricePerToken),
        completionPricePerToken: toDecimalString(route.pricing.completionPricePerToken),
        requestPriceUsd: toDecimalString(route.pricing.requestPriceUsd),
        cacheReadPricePerToken: route.pricing.cacheReadPricePerToken
          ? toDecimalString(route.pricing.cacheReadPricePerToken)
          : null,
        cacheWritePricePerToken: route.pricing.cacheWritePricePerToken
          ? toDecimalString(route.pricing.cacheWritePricePerToken)
          : null,
        effectiveInputPricePerToken: toDecimalString(
          route.pricing.effectiveInputPricePerToken
        ),
        promptPricePerMillion: toDecimalString(route.pricing.promptPricePerMillion),
        completionPricePerMillion: toDecimalString(
          route.pricing.completionPricePerMillion
        ),
        currency: "USD",
        observedAt: route.observedAt
      },
      reasonCodes: []
    });
  }

  // Whole-run safety margin (docs/economics.md Sec 10.5), applied once to
  // the already retry-reserved sum -- never per participant, to avoid
  // compounding it seven times.
  const conservativeMaxCostWithSafetyFactor = conservativeMaxCostUsd.times(
    BUDGET_SAFETY_FACTOR
  );

  if (conservativeMaxCostWithSafetyFactor.gt(MAX_RUN_COST_USD)) {
    blockedReasonCodes.add("BUDGET_EXCEEDED");
  }

  const eligible =
    blockedReasonCodes.size === 0 &&
    participants.every((participant) => participant.modelEligible);

  const remainingBudgetUsd = MAX_RUN_COST_USD.minus(
    conservativeMaxCostWithSafetyFactor
  );

  return {
    eligible,
    runId,
    hardBudgetUsd: toDecimalString(MAX_RUN_COST_USD),
    conservativeMaxCostUsd: toDecimalString(conservativeMaxCostWithSafetyFactor),
    remainingBudgetUsd: toDecimalString(remainingBudgetUsd),
    blockedReasonCodes: Array.from(blockedReasonCodes),
    pricingObservedAt: anyPricingObservedAt,
    participants
  };
}
