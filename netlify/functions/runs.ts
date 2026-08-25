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

export async function handleRunsRequest(
  event: HandlerEvent,
  deps: AcceptRunDeps
) {
  try {
    if (event.httpMethod !== "POST") {
      return runJsonResponse(405, { error: "method_not_allowed" });
    }

    const run = await acceptRun(parseJsonBody(event.body), deps);

    return runJsonResponse(201, { run: toRunResponse(run) });
  } catch (error) {
    return runErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleRunsRequest(event, {
      caseRepository: createSupabaseIdempotentCaseRepository(),
      runRepository: createSupabaseRunRepository()
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
