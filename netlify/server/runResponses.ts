import type { HandlerResponse } from "@netlify/functions";
import { CasePersistenceError, IdempotencyConflictError } from "./cases";
import { RunPersistenceError, RunValidationError, type PersistedRun } from "./runs";

// Public response shape: deliberately excludes request_fingerprint,
// convene_request_id, and clientRequestId -- none are documented as part
// of the M6 read contract, and there is no operational reason to expose
// the fingerprint to the browser. No fake economics/speeches/verdicts
// exist because they are never part of PersistedRun in the first place.
//
// Milestone 10 (Issue #23) -- additive only: every field below this
// comment is new; every field above it is unchanged, so no existing
// caller of GET /api/runs/:id breaks. `attempts`/`protocol`/`admission`
// are already public-safe shapes by construction (AttemptAudit,
// ResolvedProtocol, AdmissionReconstructionResult in runs.ts /
// protocolResolution.ts / admissionReconstruction.ts never carry
// participant_config_id, client_request_id, request_fingerprint, or any
// raw provider payload -- see Issue #23's "Public audit field safety
// review"), so they are passed through directly rather than re-mapped
// field by field here.
export function toRunResponse(run: PersistedRun) {
  return {
    id: run.id,
    caseId: run.caseId,
    executionMode: run.executionMode,
    status: run.status,
    createdAt: run.createdAt,
    // Milestone 8 execution/economics -- null on a still-READY run.
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    majorityVerdict: run.majorityVerdict,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    totalCostUsd: run.totalCostUsd,
    advocateCostUsd: run.advocateCostUsd,
    judgeCostUsd: run.judgeCostUsd,
    totalInputTokens: run.totalInputTokens,
    totalOutputTokens: run.totalOutputTokens,
    totalTokens: run.totalTokens,
    logicalCallCount: run.logicalCallCount,
    providerAttemptCount: run.providerAttemptCount,
    wallClockMs: run.wallClockMs,
    partialSpend: run.partialSpend,
    admission: run.admission,
    attempts: run.attempts,
    protocol: run.protocol,
    participants: run.participants.map((participant) => ({
      participantId: participant.participantId,
      role: participant.role,
      side: participant.side,
      profileName: participant.profileName,
      personality: participant.personality,
      personalitySource: participant.personalitySource,
      personalitySourceFilename: participant.personalitySourceFilename,
      modelId: participant.modelId,
      promptVersion: participant.promptVersion,
      // Milestone 8 -- never the internal participant_config_id itself.
      attemptStatus: participant.attemptStatus,
      speech: participant.speech,
      verdict: participant.verdict,
      reasoning: participant.reasoning
    }))
  };
}

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

export function runJsonResponse(statusCode: number, body: unknown): HandlerResponse {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      ...jsonHeaders
    },
    body: JSON.stringify(body)
  };
}

// Stable safe error categories only -- never a raw Supabase/Postgres
// stack trace or error payload reaches the client (SECURITY.md Sec 13).
export function runErrorResponse(error: unknown): HandlerResponse {
  if (error instanceof RunValidationError) {
    const isCaseNotFound = error.errors.some((message) =>
      message.toLowerCase().includes("case not found")
    );

    if (isCaseNotFound) {
      return runJsonResponse(404, {
        error: "case_not_found",
        errors: error.errors
      });
    }

    return runJsonResponse(400, {
      error: "invalid_run",
      errors: error.errors
    });
  }

  if (error instanceof IdempotencyConflictError) {
    return runJsonResponse(409, { error: "idempotency_conflict" });
  }

  // A genuine cases-table failure encountered while resolving/creating the
  // case for this run (existing-case lookup, idempotent new-case insert,
  // or its idempotent fallback SELECT -- see acceptRun step F) is still a
  // run-acceptance persistence failure from the caller's point of view,
  // not a generic/opaque one -- map it to the same stable safe category
  // as RunPersistenceError, never a raw Supabase/Postgres detail.
  if (error instanceof RunPersistenceError || error instanceof CasePersistenceError) {
    return runJsonResponse(500, { error: "run_persistence_failed" });
  }

  return runJsonResponse(500, { error: "run_request_failed" });
}
