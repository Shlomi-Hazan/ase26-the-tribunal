import type { Handler, HandlerEvent } from "@netlify/functions";
import {
  type CaseRepository,
  createSupabaseCaseRepository,
  validateCaseId
} from "../server/cases";
import {
  caseErrorResponse,
  caseJsonResponse
} from "../server/caseResponses";
import { CASE_BY_ID_ROUTE_SHAPE, resolveRouteId } from "../server/routing";

export async function handleCaseByIdRequest(
  event: HandlerEvent,
  repository: CaseRepository
) {
  try {
    if (event.httpMethod !== "GET") {
      return caseJsonResponse(405, { error: "method_not_allowed" });
    }

    const caseId = validateCaseId(resolveRouteId(event, CASE_BY_ID_ROUTE_SHAPE) ?? "");
    const storedCase = await repository.getById(caseId);

    if (!storedCase) {
      return caseJsonResponse(404, { error: "case_not_found" });
    }

    return caseJsonResponse(200, { case: storedCase });
  } catch (error) {
    return caseErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleCaseByIdRequest(event, createSupabaseCaseRepository());
  } catch (error) {
    // Repository construction (e.g. missing Supabase config) can throw
    // synchronously before handleCaseByIdRequest's own try/catch runs.
    // Route it through the same safe error response so no stack
    // trace/internal path ever reaches the client.
    return caseErrorResponse(error);
  }
};
