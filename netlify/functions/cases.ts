import type { Handler, HandlerEvent } from "@netlify/functions";
import {
  type CaseRepository,
  createSupabaseCaseRepository,
  validateCreateCaseInput
} from "../server/cases";
import {
  caseErrorResponse,
  caseJsonResponse
} from "../server/caseResponses";

export async function handleCasesRequest(
  event: HandlerEvent,
  repository: CaseRepository
) {
  try {
    if (event.httpMethod === "GET") {
      return caseJsonResponse(200, { cases: await repository.list() });
    }

    if (event.httpMethod === "POST") {
      const input = validateCreateCaseInput(parseJsonBody(event.body));
      const storedCase = await repository.create(input);

      return caseJsonResponse(201, { case: storedCase });
    }

    return caseJsonResponse(405, { error: "method_not_allowed" });
  } catch (error) {
    return caseErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleCasesRequest(event, createSupabaseCaseRepository());
  } catch (error) {
    // Repository construction (e.g. missing Supabase config) can throw
    // synchronously before handleCasesRequest's own try/catch runs. Route
    // it through the same safe error response so no stack trace/internal
    // path ever reaches the client.
    return caseErrorResponse(error);
  }
};

function parseJsonBody(body: string | null) {
  if (!body) {
    return {};
  }

  try {
    return JSON.parse(body);
  } catch {
    return {
      invalidJson: true
    };
  }
}
