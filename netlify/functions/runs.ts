import type { Handler, HandlerEvent } from "@netlify/functions";
import { createSupabaseIdempotentCaseRepository } from "../server/cases";
import {
  runErrorResponse,
  runJsonResponse,
  toRunResponse
} from "../server/runResponses";
import {
  acceptRun,
  createSupabaseRunRepository,
  RunValidationError,
  type AcceptRunDeps
} from "../server/runs";
import { createServerSupabaseClient } from "../server/supabase";
import {
  createSupabaseTribunalExecutionRepository,
  type TribunalExecutionRepository
} from "../server/tribunal/repository";
import { triggerExecutionIfEligible } from "../server/tribunal/triggerExecution";
import { readUserOpenRouterKey } from "../server/extraction/userOpenRouterKey";

// Superset of AcceptRunDeps -- acceptRun's own contract (case/run
// repositories only) is unchanged; the M8 execution trigger is an
// additive step layered on top, injected the same way so tests can
// fully control it without touching real Supabase. Optional: a caller
// that omits it gets the freeze-only M6 behavior (the trigger step is
// skipped entirely) -- every pre-M8 test in this file constructs deps
// without it and never sends a BYOK header either, so the two are
// behaviorally identical for that case; the real handler below always
// supplies it.
export type HandleRunsRequestDeps = AcceptRunDeps & {
  tribunalRepository?: TribunalExecutionRepository;
};

export async function handleRunsRequest(
  event: HandlerEvent,
  deps: HandleRunsRequestDeps
) {
  try {
    if (event.httpMethod !== "POST") {
      return runJsonResponse(405, { error: "method_not_allowed" });
    }

    const run = await acceptRun(parseJsonBody(event.body), deps);

    // Milestone 8: freeze succeeded (or was idempotently reused) --
    // decide whether to trigger real execution. Zero credential -> zero
    // preflight attempt, zero worker invocation; the run stays READY.
    // This never turns a successful freeze into an error response --
    // Convene itself remains a free, always-succeeds-on-valid-input
    // operation, exactly as M6 established; execution triggering is an
    // additive side effect layered on top, never a new failure mode for
    // the freeze itself.
    const userOpenRouterKey = readUserOpenRouterKey(event);
    const tribunalRepository = deps.tribunalRepository;

    const triggerResult = tribunalRepository
      ? await triggerExecutionIfEligible(run, userOpenRouterKey, {
          runRepository: deps.runRepository,
          caseRepository: deps.caseRepository,
          tribunalRepository
        })
      : ({ invoked: false, reason: "not_connected" } as const);

    // Re-read after the trigger decision so the response's status is
    // honest -- e.g. BLOCKED_BUDGET rather than the now-stale READY the
    // in-memory `run` object still carries if the synchronous preflight
    // gate just blocked it.
    const finalRun =
      triggerResult.invoked || triggerResult.reason === "blocked_budget"
        ? ((await deps.runRepository.getById(run.id)) ?? run)
        : run;

    return runJsonResponse(201, {
      run: toRunResponse(finalRun),
      executionTriggered: triggerResult.invoked
    });
  } catch (error) {
    return runErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleRunsRequest(event, {
      caseRepository: createSupabaseIdempotentCaseRepository(),
      runRepository: createSupabaseRunRepository(),
      tribunalRepository: createSupabaseTribunalExecutionRepository(createServerSupabaseClient())
    });
  } catch (error) {
    // Repository construction (e.g. missing Supabase config) can throw
    // synchronously before handleRunsRequest's own try/catch runs. Route
    // it through the same safe error response so no stack trace/internal
    // path ever reaches the client (same pattern as netlify/functions/cases.ts).
    return runErrorResponse(error);
  }
};

function parseJsonBody(body: string | null) {
  if (!body) {
    throw new RunValidationError(["Request body is required."]);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new RunValidationError(["Request body must be valid JSON."]);
  }
}
