// Milestone 7A -- POST /api/setup-extractions (ADR 0004 Decision 19).
// Billable initial extraction attempt.

import type { Handler, HandlerEvent } from "@netlify/functions";
import { readPackageExtractionServerConfig } from "../server/env";
import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../../src/prompts/versions";
import { sharedEndpointCache, sharedModelCache } from "../server/openrouter/sharedMetadataCache";
import { trustedSourceIp } from "../server/extraction/rateLimit";
import { createSupabaseExtractionRepository } from "../server/extraction/repository";
import { submitInitialExtraction, type ExtractionSourceDeps } from "../server/extraction/service";
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

export async function handleSetupExtractionsRequest(
  event: HandlerEvent,
  deps: ExtractionSourceDeps
) {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  // User-funded OpenRouter BYOK correction: this endpoint can call
  // createChatCompletion, so it requires an explicit per-request user
  // credential before anything else -- zero claim, zero persistence,
  // zero spend when absent. Checked before body parsing even, so a
  // malformed body never masks this more fundamental gate.
  if (!readUserOpenRouterKey(event)) {
    return jsonResponse(400, {
      status: "blocked",
      errorCode: OPENROUTER_NOT_CONNECTED,
      message: "Connect your OpenRouter account before starting an extraction."
    });
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

// User-funded OpenRouter BYOK correction: `userOpenRouterKey` is the
// per-request credential extracted from X-User-OpenRouter-Key --
// buildUserScopedProviders builds EVERY provider this function needs
// (metadata included, not only the completion call) from it. This
// endpoint never calls readOpenRouterServerConfig()/reads
// process.env.OPENROUTER_API_KEY at all anymore -- there is no
// operator-key code path here to accidentally fall back to. (Metadata
// staying on the user's own key here, rather than the operator's, is a
// deliberate choice beyond the minimum ADR 0004 Decision 10 amendment
// requires -- see docs/economics.md Sec 22.1 -- purely because it is
// the simplest way to make "never the operator key" structurally true,
// not just true by convention.)
function buildRealDeps(userOpenRouterKey: string | null): ExtractionSourceDeps {
  return {
    ...buildUserScopedProviders(userOpenRouterKey, "handleSetupExtractionsRequest"),
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
    return await handleSetupExtractionsRequest(event, buildRealDeps(readUserOpenRouterKey(event)));
  } catch {
    return jsonResponse(500, {
      status: "blocked",
      errorCode: "PROVIDER_UNAVAILABLE",
      message: "Server configuration error."
    });
  }
};
