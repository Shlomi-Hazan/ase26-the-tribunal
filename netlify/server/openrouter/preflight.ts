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
import { ModelMetadataCache, cachedFetch, type Clock } from "./cache";
import { classifyPriceTier, toDecimalString, type PriceTier } from "./pricing";
import {
  computeCandidateAttemptCostUsd,
  resolveModelRoute,
  type ResolvedModelRoute,
  type RouteRole
} from "./routeResolution";
import {
  estimateAdvocateInputTokens,
  estimateJudgeInputTokens,
  outputCapTokensForRole
} from "./tokenEstimation";
import type { OpenRouterProvider } from "./provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";
import type { ParticipantId } from "../../../src/schemas/tribunalSetup";

export const MAX_RUN_COST_USD = new Decimal("5.00");
export const BUDGET_SAFETY_FACTOR = new Decimal("1.10");
// Initial attempt + one permitted retry (SPEC.md Sec 10.1). No cache hit,
// warm cache, or provider discount may ever reduce this reserve
// (ADR Decision 7B).
export const MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL = 2;
// Fixed Tribunal shape: 4 advocates + 3 judges = 7 logical calls.
export const TOTAL_LOGICAL_CALLS = 7;

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

// Complete-Tribunal discovery tier estimate (ADR Decision 12): "computed
// from the exact ResolvedModelRoute's conservative complete-Tribunal cost
// estimate, never a per-token rate, never a model-family average."
// Implementation note: rather than requiring every OTHER participant's
// own estimated token count (which this single participant's route
// resolution does not have), the complete-Tribunal figure is this
// participant's own retry-reserved attempt cost scaled to the fixed
// seven-logical-call Tribunal shape, using this route's own pricing
// throughout -- never a per-token rate or model-family average, and
// always at least as large as this participant's own real contribution.
// This keeps the tier informational and conservative; it is never itself
// budget authority (ADR Decision 12) regardless of the exact scaling
// approach.
function computeCompleteTribunalTierCostUsd(participantAttemptCostWithRetry: Decimal): Decimal {
  return participantAttemptCostWithRetry
    .times(TOTAL_LOGICAL_CALLS)
    .times(BUDGET_SAFETY_FACTOR);
}

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

  const observedAtIso = new Date(clock()).toISOString();
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
        priceTier: null,
        conservativeParticipantCostUsd: null,
        pricing: null,
        reasonCodes: ["PROMPT_VERSION_UNASSIGNED"]
      });
      continue;
    }

    const chargeSheetText = [
      tribunalCase.defendant,
      tribunalCase.act,
      tribunalCase.exactQuestion
    ].join("\n");

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

    try {
      models = await cachedFetch(modelCache, "models", () => deps.provider.listModels());
      endpoints = await cachedFetch(endpointCache, participant.modelId, () =>
        deps.provider.listEndpoints(author, slug)
      );
    } catch {
      blockedReasonCodes.add("PRICING_UNAVAILABLE");
      participants.push({
        participantId: participant.participantId,
        configuredModelId: participant.modelId,
        canonicalModelId: null,
        modelEligible: false,
        providerName: null,
        providerEndpointIdOrTag: null,
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
      observedAt: observedAtIso
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
      priceTier: classifyPriceTier(
        computeCompleteTribunalTierCostUsd(participantCostWithRetry)
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
