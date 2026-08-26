import type { Handler, HandlerEvent } from "@netlify/functions";
import {
  runErrorResponse,
  runJsonResponse,
  toRunResponse
} from "../server/runResponses";
import {
  createSupabaseRunRepository,
  validateRunId,
  type RunRepository
} from "../server/runs";

export async function handleRunByIdRequest(
  event: HandlerEvent,
  repository: RunRepository
) {
  try {
    if (event.httpMethod !== "GET") {
      return runJsonResponse(405, { error: "method_not_allowed" });
    }

    // A malformed id is a 400 invalid_run; an unknown but validly-shaped
    // UUID is a safe 404 run_not_found -- validateRunId throws
    // RunValidationError, mapped to 400 by runErrorResponse, before any
    // repository call for the malformed case.
    const runId = validateRunId(event.queryStringParameters?.id ?? "");
    const run = await repository.getById(runId);

    if (!run) {
      return runJsonResponse(404, { error: "run_not_found" });
    }

    return runJsonResponse(200, { run: toRunResponse(run) });
  } catch (error) {
    return runErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleRunByIdRequest(event, createSupabaseRunRepository());
  } catch (error) {
    // Repository construction (e.g. missing Supabase config) can throw
    // synchronously before handleRunByIdRequest's own try/catch runs.
    // Route it through the same safe error response so no stack
    // trace/internal path ever reaches the client.
    return runErrorResponse(error);
  }
};
