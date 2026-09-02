import type { Handler, HandlerEvent } from "@netlify/functions";
import { validateCaseId } from "../server/cases";
import {
  caseRunsErrorResponse,
  caseRunsJsonResponse
} from "../server/caseRunsResponses";
import {
  createSupabaseRunRepository,
  type RunRepository
} from "../server/runs";

// Milestone 11 (Issue #27) -- GET /api/cases/:id/runs, the narrow
// Case-to-Run discovery read bridge. Read-only by construction: this
// file imports nothing from the execution/OpenRouter boundary
// (netlify/server/tribunal/execution.ts, netlify/server/openrouter/*),
// and RunRepository.listByCaseId performs a plain SELECT -- it never
// writes, never performs preflight, and never fetches provider/model
// metadata. See Issue #27 "No-model-call reopen proof".
export async function handleCaseRunsRequest(
  event: HandlerEvent,
  repository: RunRepository
) {
  try {
    if (event.httpMethod !== "GET") {
      return caseRunsJsonResponse(405, { error: "method_not_allowed" });
    }

    // A malformed id is a 400 invalid_case; a syntactically valid but
    // unknown case id is not an error here -- this narrow collection
    // endpoint performs no case-existence check of its own and simply
    // returns an empty array. GET /api/cases/:id remains the sole
    // authority for whether the parent Case itself exists.
    const caseId = validateCaseId(event.queryStringParameters?.id ?? "");
    const runs = await repository.listByCaseId(caseId);

    return caseRunsJsonResponse(200, { runs });
  } catch (error) {
    return caseRunsErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleCaseRunsRequest(event, createSupabaseRunRepository());
  } catch (error) {
    // Repository construction (e.g. missing Supabase config) can throw
    // synchronously before handleCaseRunsRequest's own try/catch runs.
    // Route it through the same safe error response so no stack
    // trace/internal path ever reaches the client.
    return caseRunsErrorResponse(error);
  }
};
