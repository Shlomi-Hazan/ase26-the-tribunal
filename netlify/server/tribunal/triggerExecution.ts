// Milestone 8 -- the one place POST /api/runs decides whether to invoke
// the Background Function after a successful freeze (ARCHITECTURE.md
// Sec 3.2, Issue #17's "Final M8 Execution Order"). This module owns
// exactly the synchronous, user's-own-credential preflight gate and the
// one server-to-server invocation -- no credential is ever persisted,
// logged, or exposed in a response; it exists only in this request's own
// in-memory handling and the one forwarded header.

import type { HandlerEvent } from "@netlify/functions";
import { runPreflight } from "../openrouter/preflight";
import { createPreflightRunLoader } from "../openrouter/preflightRunLoader";
import type { CaseRepository } from "../cases";
import type { RunRepository, PersistedRun } from "../runs";
import { readInternalFunctionSecretConfig } from "../env";
import { INTERNAL_FUNCTION_SECRET_HEADER } from "./internalSecret";
import { USER_OPENROUTER_KEY_HEADER, buildUserScopedProviders } from "../extraction/userOpenRouterKey";
import type { TribunalExecutionRepository } from "./repository";

export type TriggerExecutionResult =
  | { invoked: true }
  | { invoked: false; reason: "not_connected" }
  | { invoked: false; reason: "blocked_budget"; blockedReasonCodes: string[] }
  | { invoked: false; reason: "invocation_failed" };

export type TriggerExecutionDeps = {
  runRepository: RunRepository;
  caseRepository: CaseRepository;
  tribunalRepository: TribunalExecutionRepository;
  // Injectable for tests -- defaults to the real global fetch.
  fetchImpl?: typeof fetch;
};

function resolveBackgroundFunctionUrl(event: HandlerEvent): string {
  const headers = event.headers ?? {};
  const host = headers.host ?? headers.Host ?? "localhost:8888";
  const proto = headers["x-forwarded-proto"] ?? "https";

  return `${proto}://${host}/.netlify/functions/tribunal-execute-background`;
}

// Called only after acceptRun has already returned a READY run (freeze
// succeeded or was idempotently reused). No credential -> zero preflight
// attempt, zero worker invocation -- the run remains READY, exactly as
// the "if credential is absent: do not invoke worker" contract requires.
export async function triggerExecutionIfEligible(
  run: PersistedRun,
  userOpenRouterKey: string | null,
  event: HandlerEvent,
  deps: TriggerExecutionDeps
): Promise<TriggerExecutionResult> {
  if (run.status !== "READY") {
    // Already progressed (a replay of an already-frozen run whose
    // execution trigger already fired, or already terminal) -- never
    // re-trigger.
    return { invoked: false, reason: "not_connected" };
  }

  if (!userOpenRouterKey) {
    return { invoked: false, reason: "not_connected" };
  }

  const { provider } = buildUserScopedProviders(userOpenRouterKey, "triggerExecutionIfEligible");
  const preflightRunLoader = createPreflightRunLoader(deps.runRepository, deps.caseRepository);

  const preflight = await runPreflight(run.id, { runLoader: preflightRunLoader, provider });

  if (!preflight.eligible) {
    const reasonCodes = preflight.blockedReasonCodes;

    await deps.tribunalRepository.blockBudget(
      run.id,
      reasonCodes[0] ?? "BUDGET_EXCEEDED",
      `Synchronous preflight blocked: ${reasonCodes.join(", ") || "ineligible"}`
    );

    return { invoked: false, reason: "blocked_budget", blockedReasonCodes: reasonCodes };
  }

  let internalSecret: string;

  try {
    internalSecret = readInternalFunctionSecretConfig().INTERNAL_FUNCTION_SECRET;
  } catch {
    return { invoked: false, reason: "invocation_failed" };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;

  try {
    await fetchImpl(resolveBackgroundFunctionUrl(event), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [INTERNAL_FUNCTION_SECRET_HEADER]: internalSecret,
        [USER_OPENROUTER_KEY_HEADER]: userOpenRouterKey
      },
      body: JSON.stringify({ runId: run.id })
    });
  } catch {
    // The worker invocation itself failed to be accepted (network/DNS
    // failure calling our own deployment) -- the run remains READY, a
    // documented P1 limitation (no queue/retry system for submission
    // scope). Never silently claim success.
    return { invoked: false, reason: "invocation_failed" };
  }

  return { invoked: true };
}
