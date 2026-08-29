// Milestone 7A -- POST /api/setup-extractions/preflight (ADR 0004
// Decision 19). Read-only, non-billable, zero createChatCompletion
// calls, zero persistence.

import type { Handler, HandlerEvent } from "@netlify/functions";
import { readOpenRouterServerConfig, readPackageExtractionServerConfig } from "../server/env";
import { RealOpenRouterProvider } from "../server/openrouter/provider";
import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../../src/prompts/versions";
import { sharedEndpointCache, sharedModelCache } from "../server/openrouter/sharedMetadataCache";
import { trustedSourceIp } from "../server/extraction/rateLimit";
import { runExtractionPreflight, type ExtractionSourceDeps } from "../server/extraction/service";
import {
  createSupabaseExtractionRepository,
  type ExtractionRepository
} from "../server/extraction/repository";

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
    // Corrected this pass (second independent pre-live re-audit, Section
    // 9): preflight now genuinely calls `checkAndRecordAdmission` (it is
    // its OWN authoritative admission gate, no longer only the
    // process-local rate limiter) -- a repository whose
    // `checkAndRecordAdmission` also threw unconditionally would break
    // every real preflight request. Every OTHER method stays a hard
    // throwing stub: preflight must still never touch extraction-row
    // persistence, and a repository that throws if ever invoked there is
    // a stronger guarantee than a working one. The real Supabase-backed
    // implementation is only ever asked to do the one thing preflight
    // actually needs.
    const realAdmissionRepository = createSupabaseExtractionRepository();
    const throwingRepository: ExtractionRepository = {
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
      checkAndRecordAdmission(bucket, extractionRequestId, windowSeconds, maxRequests) {
        return realAdmissionRepository.checkAndRecordAdmission(
          bucket,
          extractionRequestId,
          windowSeconds,
          maxRequests
        );
      }
    };
    const deps: ExtractionSourceDeps = {
      provider: new RealOpenRouterProvider(openRouterConfig),
      createTimedMetadataProvider: (timeoutMs) =>
        new RealOpenRouterProvider(openRouterConfig, undefined, timeoutMs),
      repository: throwingRepository,
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
