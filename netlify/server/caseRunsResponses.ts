import type { HandlerResponse } from "@netlify/functions";
import { CaseValidationError } from "./cases";
import { RunPersistenceError } from "./runs";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

export function caseRunsJsonResponse(
  statusCode: number,
  body: unknown
): HandlerResponse {
  return {
    statusCode,
    headers: {
      "cache-control": "no-store",
      ...jsonHeaders
    },
    body: JSON.stringify(body)
  };
}

// Milestone 11 (Issue #27) -- GET /api/cases/:id/runs error mapping.
// Deliberately its own small module rather than reusing caseErrorResponse
// (which knows nothing about RunPersistenceError) or runErrorResponse
// (whose RunValidationError branch maps to invalid_run/case_not_found
// semantics this narrow collection endpoint does not use -- it never
// performs a case-existence check of its own; a valid-but-unknown case
// id is not an error here at all, it is a 200 { runs: [] } -- see
// Issue #27 "Case ID error semantics"). A malformed id is validated with
// the existing CaseRepository validateCaseId contract (reused, not
// reimplemented) and reported as invalid_case, exactly matching the
// existing GET /api/cases/:id behavior.
export function caseRunsErrorResponse(error: unknown): HandlerResponse {
  if (error instanceof CaseValidationError) {
    return caseRunsJsonResponse(400, {
      error: "invalid_case",
      errors: error.errors
    });
  }

  if (error instanceof RunPersistenceError) {
    return caseRunsJsonResponse(500, { error: "run_persistence_failed" });
  }

  return caseRunsJsonResponse(500, { error: "case_runs_request_failed" });
}
