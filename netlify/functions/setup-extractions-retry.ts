// Milestone 7A -- POST /api/setup-extractions/{extractionRequestId}/retry
// (ADR 0004 Decision 19). Billable, explicit retry only.

import type { Handler, HandlerEvent } from "@netlify/functions";
import { readPackageExtractionServerConfig } from "../server/env";
import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../../src/prompts/versions";
import { sharedEndpointCache, sharedModelCache } from "../server/openrouter/sharedMetadataCache";
import { trustedSourceIp } from "../server/extraction/rateLimit";
import { createSupabaseExtractionRepository } from "../server/extraction/repository";
import { submitExtractionRetry, type ExtractionSourceDeps } from "../server/extraction/service";
import {
  buildUserScopedProviders,
  OPENROUTER_NOT_CONNECTED,
  readUserOpenRouterKey
} from "../server/extraction/userOpenRouterKey";

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

export async function handleSetupExtractionsRetryRequest(
  event: HandlerEvent,
  deps: ExtractionSourceDeps
) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  // User-funded OpenRouter BYOK correction: this endpoint can call
  // createChatCompletion, so it requires an explicit per-request user
  // credential before anything else -- zero claim, zero persistence,
  // zero spend when absent.
  if (!readUserOpenRouterKey(event)) {
    return jsonResponse(400, {
      status: "blocked",
      errorCode: OPENROUTER_NOT_CONNECTED,
      message: "Connect your OpenRouter account before retrying an extraction."
    });
  }

  const extractionRequestId = event.queryStringParameters?.id;

  if (typeof extractionRequestId !== "string" || extractionRequestId.length === 0) {
    return jsonResponse(400, {
      status: "blocked",
      errorCode: "INPUT_INVALID",
      message: "extractionRequestId path segment is required."
    });
  }

  let rawBody: unknown;

  try {
    rawBody = event.body ? JSON.parse(event.body) : {};
  } catch {
    return jsonResponse(400, { status: "blocked", errorCode: "INPUT_INVALID", message: "Invalid JSON body." });
  }

  const parsed = rawBody as { source?: unknown };
  const result = await submitExtractionRetry(extractionRequestId, parsed.source, deps);

  return jsonResponse(result.statusCode, result.body);
}

// User-funded OpenRouter BYOK correction: mirrors setup-extractions.ts's
// buildRealDeps exactly -- buildUserScopedProviders builds every
// provider from the per-request user credential;
// readOpenRouterServerConfig()/process.env.OPENROUTER_API_KEY is never
// read anywhere in this file.
function buildRealDeps(userOpenRouterKey: string | null): ExtractionSourceDeps {
  return {
    ...buildUserScopedProviders(userOpenRouterKey, "handleSetupExtractionsRetryRequest"),
    repository: createSupabaseExtractionRepository(),
    // No args -- trustedSourceIp() resolves the trusted platform IP via
    // getContext() itself (Section 5); never a caller-supplied header.
    sourceIp: trustedSourceIp(),
    configuredModelId: readPackageExtractionServerConfig().PACKAGE_EXTRACTION_MODEL_ID,
    promptVersion: PACKAGE_EXTRACTION_PROMPT_VERSION,
    modelCache: sharedModelCache,
    endpointCache: sharedEndpointCache
  };
}

export const handler: Handler = async (event) => {
  try {
    return await handleSetupExtractionsRetryRequest(event, buildRealDeps(readUserOpenRouterKey(event)));
  } catch {
    return jsonResponse(500, {
      status: "blocked",
      errorCode: "PROVIDER_UNAVAILABLE",
      message: "Server configuration error."
    });
  }
};
