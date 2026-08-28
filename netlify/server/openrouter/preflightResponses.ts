import type { HandlerResponse } from "@netlify/functions";
import {
  PreflightPersistenceError,
  PreflightRunNotFoundError,
  type PreflightResult
} from "./preflight";
import { RunValidationError } from "../runs";
import { ServerConfigError } from "../env";
import { ProviderError } from "./errors";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
} as const;

export function preflightJsonResponse(
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

export function toPreflightResponse(result: PreflightResult) {
  return { preflight: result };
}

// Stable safe error categories only -- never a raw Supabase/OpenRouter
// stack trace, response body, or internal exception detail reaches the
// client (SECURITY.md).
export function preflightErrorResponse(error: unknown): HandlerResponse {
  if (error instanceof RunValidationError) {
    return preflightJsonResponse(400, {
      error: "invalid_preflight_request",
      errors: error.errors
    });
  }

  if (error instanceof PreflightRunNotFoundError) {
    return preflightJsonResponse(404, { error: "run_not_found" });
  }

  if (error instanceof PreflightPersistenceError) {
    return preflightJsonResponse(500, { error: "preflight_persistence_failed" });
  }

  if (error instanceof ServerConfigError || error instanceof ProviderError) {
    return preflightJsonResponse(502, { error: "provider_unavailable" });
  }

  return preflightJsonResponse(500, { error: "preflight_request_failed" });
}
