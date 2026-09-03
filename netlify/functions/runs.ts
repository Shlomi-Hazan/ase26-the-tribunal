import type { Handler, HandlerEvent } from "@netlify/functions";
import { z } from "zod";
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
import { hashedAdmissionBucket, trustedSourceIp } from "../server/extraction/rateLimit";
import { RUN_START_RATE_LIMIT } from "../server/tribunal/rateLimitPolicy";
import {
  createSupabaseAdmissionControl,
  type AdmissionControl
} from "../server/admissionControl";

// Superset of AcceptRunDeps -- acceptRun's own contract (case/run
// repositories only) is unchanged; the M8 execution trigger and the M13
// admission-control rate limit (Issue #36 G3) are additive steps layered
// on top, injected the same way so tests can fully control them without
// touching real Supabase. Both optional: a caller that omits them gets
// the pre-M8/pre-M13 behavior (the trigger step, or the rate-limit
// check, is skipped entirely) -- every pre-M8/pre-M13 test in this file
// constructs deps without them; the real handler below always supplies
// both.
export type HandleRunsRequestDeps = AcceptRunDeps & {
  tribunalRepository?: TribunalExecutionRepository;
  admissionControl?: AdmissionControl;
  sourceIp?: string;
};

// A lightweight, standalone UUID check -- deliberately NOT the full
// createRunInputSchema (that remains acceptRun's own, unchanged
// authority): this only decides whether a syntactically-plausible
// clientRequestId exists to key the admission-control dedup by. A
// missing/malformed value skips rate limiting entirely and falls
// straight through to acceptRun's own validation, which will reject it
// with the correct `invalid_run` response -- mirroring the extraction
// endpoint's own "reject malformed input before it ever reaches
// admission control" precedent.
const clientRequestIdPeekSchema = z.string().uuid();

function peekClientRequestId(rawBody: unknown): string | null {
  if (typeof rawBody !== "object" || rawBody === null || !("clientRequestId" in rawBody)) {
    return null;
  }

  const result = clientRequestIdPeekSchema.safeParse((rawBody as { clientRequestId: unknown }).clientRequestId);

  return result.success ? result.data : null;
}

export async function handleRunsRequest(
  event: HandlerEvent,
  deps: HandleRunsRequestDeps
) {
  try {
    if (event.httpMethod !== "POST") {
      return runJsonResponse(405, { error: "method_not_allowed" });
    }

    const rawBody = parseJsonBody(event.body);

    // Milestone 13 (Issue #36 G3): admission-control rate limiting,
    // BEFORE any validation/case-resolution/freeze work -- reuses the
    // SAME authoritative check_and_record_admission RPC the extraction
    // endpoints already call (netlify/server/admissionControl.ts), under
    // its own "run-start" bucket namespace (never shared capacity with
    // the demo endpoint's own "jon-snow-demo-start" bucket, or with
    // extraction's own buckets). The same clientRequestId never consumes
    // a second slot (the RPC's own (bucket, requestId) dedup) -- a
    // legitimate idempotent retry of an already-accepted request is
    // never penalized. Optional in the deps contract purely for
    // pre-M13 test compatibility; the real handler below always supplies
    // it.
    //
    // Corrected (independent review, PR #37): a malformed/missing
    // clientRequestId MUST skip the admission-control call ENTIRELY --
    // calling checkAndRecordAdmission with `null` does NOT "skip rate
    // limiting" as an earlier revision's own comment incorrectly
    // claimed; the RPC counts every null-identity call as an
    // independent event, so repeated malformed requests could otherwise
    // exhaust the whole bucket and deny legitimate requests from the
    // same source IP. A malformed/missing id instead falls straight
    // through, unrated-limited, to acceptRun's own validation below,
    // which rejects it with the correct `invalid_run` response.
    const peekedClientRequestId = peekClientRequestId(rawBody);

    if (deps.admissionControl && peekedClientRequestId !== null) {
      const bucket = hashedAdmissionBucket("run-start", deps.sourceIp ?? trustedSourceIp());
      const admitted = await deps.admissionControl.checkAndRecordAdmission(
        bucket,
        peekedClientRequestId,
        RUN_START_RATE_LIMIT.windowMs / 1000,
        RUN_START_RATE_LIMIT.maxAcceptedRequests
      );

      if (!admitted) {
        return runJsonResponse(429, { error: "rate_limited" });
      }
    }

    const run = await acceptRun(rawBody, deps);

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
    const client = createServerSupabaseClient();

    return await handleRunsRequest(event, {
      caseRepository: createSupabaseIdempotentCaseRepository(),
      runRepository: createSupabaseRunRepository(),
      tribunalRepository: createSupabaseTribunalExecutionRepository(client),
      admissionControl: createSupabaseAdmissionControl(client),
      sourceIp: trustedSourceIp()
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
