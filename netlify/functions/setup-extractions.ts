// Milestone 7A -- POST /api/setup-extractions (ADR 0004 Decision 19).
// Billable initial extraction attempt.

import type { Handler, HandlerEvent } from "@netlify/functions";
import {
  readOpenRouterServerConfig,
  readPackageExtractionServerConfig
} from "../server/env";
import { RealOpenRouterProvider } from "../server/openrouter/provider";
import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../../src/prompts/versions";
import { sharedEndpointCache, sharedModelCache } from "../server/openrouter/sharedMetadataCache";
import { sharedExtractionRateLimiter, trustedSourceIp } from "../server/extraction/rateLimit";
import { createSupabaseExtractionRepository } from "../server/extraction/repository";
import { submitInitialExtraction, type ExtractionSourceDeps } from "../server/extraction/service";

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

export async function handleSetupExtractionsRequest(
  event: HandlerEvent,
  deps: ExtractionSourceDeps
) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  let rawBody: unknown;

  try {
    rawBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { status: "blocked", errorCode: "INPUT_INVALID", message: "Invalid JSON body." });
  }

  const parsed = rawBody as { extractionRequestId?: unknown; source?: unknown };

  if (typeof parsed.extractionRequestId !== "string") {
    return jsonResponse(400, {
      status: "blocked",
      errorCode: "INPUT_INVALID",
      message: "extractionRequestId is required."
    });
  }

  const result = await submitInitialExtraction(parsed.extractionRequestId, parsed.source, deps);

  return jsonResponse(result.statusCode, result.body);
}

function buildRealDeps(event: HandlerEvent): ExtractionSourceDeps {
  const openRouterConfig = readOpenRouterServerConfig();

  return {
    provider: new RealOpenRouterProvider(openRouterConfig),
    createTimedProvider: (timeoutMs) => new RealOpenRouterProvider(openRouterConfig, undefined, timeoutMs),
    repository: createSupabaseExtractionRepository(),
    rateLimiter: sharedExtractionRateLimiter,
    sourceIp: trustedSourceIp(event.headers as Record<string, string | undefined>),
    configuredModelId: readPackageExtractionServerConfig().PACKAGE_EXTRACTION_MODEL_ID,
    promptVersion: PACKAGE_EXTRACTION_PROMPT_VERSION,
    modelCache: sharedModelCache,
    endpointCache: sharedEndpointCache
  };
}

export const handler: Handler = async (event) => {
  try {
    return await handleSetupExtractionsRequest(event, buildRealDeps(event));
  } catch {
    return jsonResponse(500, {
      status: "blocked",
      errorCode: "PROVIDER_UNAVAILABLE",
      message: "Server configuration error."
    });
  }
};
