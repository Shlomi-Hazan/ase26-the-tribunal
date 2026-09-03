// Milestone 12 (human product override, PR #34) -- the canonical,
// operator-funded Jon Snow demo endpoint's core logic. NOT a second
// Tribunal engine: this module owns only (a) strict validation of the
// two client-controlled fields, (b) an independent, server-side
// re-verification of the client-selected model against the current
// eligible catalog and the demo cost policy, and (c) constructing the
// canonical case/participant payload from the SAME isomorphic preset
// module the client's Modify-settings page reads
// (src/features/jon-snow-demo/canonicalPreset.ts) -- then it calls the
// exact same acceptRun/triggerExecutionIfEligible every other Tribunal
// run already uses. No execution/freeze/preflight/majority/protocol
// logic is duplicated here.
//
// The client cannot influence Defendant/Act/Exact Question, any
// participant profile name/personality/seat mapping, prompt versions,
// or execution mode (always SHARED) -- the only accepted client fields
// are `modelId` and `clientRequestId`.

import Decimal from "decimal.js";
import { z } from "zod";
import {
  JON_SNOW_CASE_SOURCE_TYPE,
  JON_SNOW_CHARGE_SHEET,
  JON_SNOW_PARTICIPANTS
} from "../../../src/features/jon-snow-demo/canonicalPreset";
import { JON_SNOW_DEMO_MAX_ESTIMATE_USD } from "../../../src/features/jon-snow-demo/jonSnowDemoEconomics";
import { participantIds } from "../../../src/schemas/tribunalSetup";
import type { IdempotentCaseRepository } from "../cases";
import { listEligibleModels, type ModelDiscoveryDeps } from "../openrouter/modelDiscovery";
import { acceptRun, RunValidationError, type PersistedRun, type RunRepository } from "../runs";
import { triggerExecutionIfEligible, type TriggerExecutionDeps } from "./triggerExecution";
import type { TribunalExecutionRepository } from "./repository";

const jonSnowDemoInputSchema = z.strictObject({
  clientRequestId: z.string().uuid("clientRequestId must be a valid UUID."),
  modelId: z
    .string()
    .trim()
    .min(1, "Model ID is required.")
    .max(256, "Model ID exceeds 256 characters.")
});

export type JonSnowDemoInput = z.infer<typeof jonSnowDemoInputSchema>;

function validateJonSnowDemoInput(rawInput: unknown): JonSnowDemoInput {
  const result = jonSnowDemoInputSchema.safeParse(rawInput);

  if (!result.success) {
    throw new RunValidationError(result.error.issues.map((issue) => issue.message));
  }

  return result.data;
}

export type JonSnowDemoDeps = {
  caseRepository: IdempotentCaseRepository;
  runRepository: RunRepository;
  tribunalRepository: TribunalExecutionRepository;
  // Metadata-only catalog inspection deps (operator's OWN general
  // OPENROUTER_API_KEY, zero cost -- the same construction GET
  // /api/models already uses; never the demo provider credential below).
  modelDiscovery: Omit<ModelDiscoveryDeps, "clock">;
  // The operator-funded demo's OWN OpenRouter provider credential
  // (JON_SNOW_DEMO_OPENROUTER_API_KEY) -- used ONLY as the execution
  // credential forwarded into the existing triggerExecutionIfEligible,
  // never for metadata/catalog listing above.
  demoOpenRouterKey: string;
  fetchImpl?: TriggerExecutionDeps["fetchImpl"];
  backgroundFunctionBaseUrl?: TriggerExecutionDeps["backgroundFunctionBaseUrl"];
};

export type JonSnowDemoRunResult = {
  run: PersistedRun;
  executionTriggered: boolean;
};

export async function acceptJonSnowDemoRun(
  rawInput: unknown,
  deps: JonSnowDemoDeps
): Promise<JonSnowDemoRunResult> {
  const input = validateJonSnowDemoInput(rawInput);

  // Independent server-side re-verification of the client-selected
  // model -- never trusts a client-supplied price/tier/eligibility
  // claim. Reuses the exact same discovery primitive GET /api/models
  // already uses; no second eligibility formula.
  const eligibleModels = await listEligibleModels(deps.modelDiscovery);
  const resolvedModel = eligibleModels.find((model) => model.id === input.modelId);

  if (!resolvedModel) {
    throw new RunValidationError(["The selected model is not currently eligible."]);
  }

  const maxEstimate = new Decimal(JON_SNOW_DEMO_MAX_ESTIMATE_USD);

  if (new Decimal(resolvedModel.conservativeFullTribunalEstimateUsd).gt(maxEstimate)) {
    throw new RunValidationError([
      `The selected model's current conservative estimate exceeds the operator-funded demo maximum of $${JON_SNOW_DEMO_MAX_ESTIMATE_USD}.`
    ]);
  }

  // Server-owned canonical construction, from the same isomorphic preset
  // module the client reads -- the client contributes only modelId
  // (already independently verified above) and clientRequestId.
  // Execution mode is always SHARED; Separate Mode is not reachable
  // through this endpoint at all.
  const participants = participantIds.map((participantId) => {
    const preset = JON_SNOW_PARTICIPANTS[participantId];

    return {
      participantId,
      profileName: preset.profileName,
      personality: preset.personality,
      personalitySource: preset.personalitySource,
      modelId: input.modelId
    };
  });

  const run = await acceptRun(
    {
      clientRequestId: input.clientRequestId,
      case: {
        kind: "new" as const,
        case: {
          ...JON_SNOW_CHARGE_SHEET,
          sourceType: JON_SNOW_CASE_SOURCE_TYPE
        }
      },
      executionMode: "shared" as const,
      participants
    },
    { caseRepository: deps.caseRepository, runRepository: deps.runRepository }
  );

  // Reuses the exact same trigger/preflight/execution path every other
  // Tribunal run already uses -- the only difference from the generic
  // flow is where the credential string came from (the operator's
  // dedicated demo key, never a user-supplied one).
  const triggerResult = await triggerExecutionIfEligible(run, deps.demoOpenRouterKey, {
    runRepository: deps.runRepository,
    caseRepository: deps.caseRepository,
    tribunalRepository: deps.tribunalRepository,
    fetchImpl: deps.fetchImpl,
    backgroundFunctionBaseUrl: deps.backgroundFunctionBaseUrl
  });

  const finalRun =
    triggerResult.invoked || triggerResult.reason === "blocked_budget"
      ? ((await deps.runRepository.getById(run.id)) ?? run)
      : run;

  return { run: finalRun, executionTriggered: triggerResult.invoked };
}
