import type { HandlerResponse } from "@netlify/functions";
import {
  CasePersistenceError,
  CaseValidationError
} from "./cases";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

export function caseJsonResponse(
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

export function caseErrorResponse(error: unknown): HandlerResponse {
  if (error instanceof CaseValidationError) {
    return caseJsonResponse(400, {
      error: "invalid_case",
      errors: error.errors
    });
  }

  if (error instanceof CasePersistenceError) {
    return caseJsonResponse(500, { error: "case_persistence_failed" });
  }

  return caseJsonResponse(500, { error: "case_request_failed" });
}
