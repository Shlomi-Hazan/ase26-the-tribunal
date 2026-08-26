import type { Handler, HandlerEvent } from "@netlify/functions";
import { readOpenRouterServerConfig } from "../server/env";
import { RealOpenRouterProvider } from "../server/openrouter/provider";
import { listEligibleModels } from "../server/openrouter/modelDiscovery";
import { preflightErrorResponse, preflightJsonResponse } from "../server/openrouter/preflightResponses";
import type { OpenRouterProvider } from "../server/openrouter/provider";

export async function handleModelsRequest(
  event: HandlerEvent,
  provider: OpenRouterProvider
) {
  try {
    if (event.httpMethod !== "GET") {
      return preflightJsonResponse(405, { error: "method_not_allowed" });
    }

    const models = await listEligibleModels(provider);

    return preflightJsonResponse(200, { models });
  } catch (error) {
    return preflightErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleModelsRequest(
      event,
      new RealOpenRouterProvider(readOpenRouterServerConfig())
    );
  } catch (error) {
    // Provider construction (e.g. missing OPENROUTER_API_KEY) can throw
    // synchronously before handleModelsRequest's own try/catch runs.
    return preflightErrorResponse(error);
  }
};
