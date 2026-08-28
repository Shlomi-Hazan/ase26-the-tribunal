// Milestone 7A -- POST /api/setup-extractions/preflight (ADR 0004
// Decision 19). Read-only, non-billable, zero createChatCompletion
// calls, zero persistence.

import type { Handler, HandlerEvent } from "@netlify/functions";
import { readOpenRouterServerConfig, readPackageExtractionServerConfig } from "../server/env";
import { RealOpenRouterProvider } from "../server/openrouter/provider";
import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../../src/prompts/versions";
import { sharedEndpointCache, sharedModelCache } from "../server/openrouter/sharedMetadataCache";
import { sharedExtractionRateLimiter, trustedSourceIp } from "../server/extraction/rateLimit";
import { runExtractionPreflight, type ExtractionSourceDeps } from "../server/extraction/service";
import type { ExtractionRepository } from "../server/extraction/repository";

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}

export async function handleSetupExtractionsPreflightRequest(
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

  const parsed = rawBody as { source?: unknown };
  const result = await runExtractionPreflight(parsed.source, deps);

  return jsonResponse(result.statusCode, result.body);
}

export const handler: Handler = async (event) => {
  try {
    const openRouterConfig = readOpenRouterServerConfig();
    const throwingRepository: ExtractionRepository = {
      // Preflight never persists -- these methods are structurally
      // unreachable from runExtractionPreflight, but ExtractionSourceDeps
      // requires a repository field. A repository that throws if ever
      // invoked is a stronger guarantee than a working one here.
      getExtraction() {
        throw new Error("Preflight must never touch persistence.");
      },
      getAttempt() {
        throw new Error("Preflight must never touch persistence.");
      },
      claimAttemptOne() {
        throw new Error("Preflight must never touch persistence.");
      },
      claimAttemptTwo() {
        throw new Error("Preflight must never touch persistence.");
      },
      terminalize() {
        throw new Error("Preflight must never touch persistence.");
      },
      block() {
        throw new Error("Preflight must never touch persistence.");
      },
      reconcileAttempts() {
        throw new Error("Preflight must never touch persistence.");
      },
      checkAndRecordAdmission() {
        throw new Error("Preflight must never touch persistence.");
      }
    };
    const deps: ExtractionSourceDeps = {
      provider: new RealOpenRouterProvider(openRouterConfig),
      createTimedMetadataProvider: (timeoutMs) =>
        new RealOpenRouterProvider(openRouterConfig, undefined, timeoutMs),
      repository: throwingRepository,
      rateLimiter: sharedExtractionRateLimiter,
      // No args -- trustedSourceIp() resolves the trusted platform IP via
      // getContext() itself (Section 5); never a caller-supplied header.
      sourceIp: trustedSourceIp(),
      configuredModelId: readPackageExtractionServerConfig().PACKAGE_EXTRACTION_MODEL_ID,
      promptVersion: PACKAGE_EXTRACTION_PROMPT_VERSION,
      modelCache: sharedModelCache,
      endpointCache: sharedEndpointCache
    };

    return await handleSetupExtractionsPreflightRequest(event, deps);
  } catch {
    return jsonResponse(500, {
      status: "blocked",
      errorCode: "PRICING_UNAVAILABLE",
      message: "Server configuration error."
    });
  }
};
