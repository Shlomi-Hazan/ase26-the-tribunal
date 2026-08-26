import type { Handler, HandlerEvent } from "@netlify/functions";
import { readOpenRouterServerConfig } from "../server/env";
import { RealOpenRouterProvider } from "../server/openrouter/provider";
import { listEligibleModels, type ModelDiscoveryDeps } from "../server/openrouter/modelDiscovery";
import {
  sharedEndpointCache,
  sharedModelCache
} from "../server/openrouter/sharedMetadataCache";
import { preflightErrorResponse, preflightJsonResponse } from "../server/openrouter/preflightResponses";

export async function handleModelsRequest(
  event: HandlerEvent,
  deps: Omit<ModelDiscoveryDeps, "clock">
) {
  try {
    if (event.httpMethod !== "GET") {
      return preflightJsonResponse(405, { error: "method_not_allowed" });
    }

    const models = await listEligibleModels(deps);

    return preflightJsonResponse(200, { models });
  } catch (error) {
    return preflightErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleModelsRequest(event, {
      provider: new RealOpenRouterProvider(readOpenRouterServerConfig()),
      // Shared with POST /api/preflight (netlify/functions/preflight.ts)
      // -- same module-scope cache singletons, so a warm container never
      // independently refetches metadata the other endpoint already has.
      modelCache: sharedModelCache,
      endpointCache: sharedEndpointCache
    });
  } catch (error) {
    // Provider construction (e.g. missing OPENROUTER_API_KEY) can throw
    // synchronously before handleModelsRequest's own try/catch runs.
    return preflightErrorResponse(error);
  }
};
