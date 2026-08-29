// Milestone 7A -- Smart Import client (ADR 0004 Decision 19). Mirrors
// importApi.ts's ImportApiError/fetch pattern.

import type { PackageExtractionResult } from "../schemas/packageExtraction";
import { withUserOpenRouterKeyHeader } from "./openRouterCredential";

export type DossierSourcePayload =
  | { kind: "text"; text: string }
  | { kind: "file"; filename: string; contentBase64: string };

// Corrected this pass (independent pre-live audit, Section 13): mirrors
// service.ts's toPreflightBody exactly -- the quote's headline figure is
// the LOGICAL (both-attempts) conservative maximum the user is actually
// agreeing to spend up to, against the fixed $0.50 hardCeilingUsd, with
// the per-attempt figure and full model/endpoint/pricing provenance also
// exposed for the audit detail. The prior revision of this type still
// had the old, pre-correction single `conservativeMaxCostUsd` field,
// which no longer matches what the server actually returns.
export type PreflightResponse = {
  eligible: boolean;
  configuredModelId: string;
  canonicalModelId: string | null;
  providerEndpointTag: string | null;
  logicalConservativeMaxCostUsd: string;
  perAttemptConservativeMaxCostUsd: string;
  hardCeilingUsd: string;
  blockedReasonCodes: string[];
  pricingObservedAt: string | null;
  // New this pass (second independent pre-live re-audit, Section 8):
  // ADR 0004 Decision 18 requires Extraction Review to show the frozen
  // prompt version at secondary audit-detail level -- the prior
  // response never exposed it at all.
  promptVersion: string;
};

export type ExtractionAttemptSummary = {
  attemptNumber: 1 | 2;
  status: string;
  canonicalModelId: string | null;
  providerEndpointTag: string | null;
  conservativeMaxCostUsd: string;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCostUsd: string | null;
  latencyMs: number | null;
  errorCode: string | null;
};

export type ExtractionSuccessResponse = {
  status: "success" | "needs_review" | "in_progress";
  draft?: PackageExtractionResult;
  warnings?: PackageExtractionResult["warnings"];
  attempt?: ExtractionAttemptSummary;
};

export type ExtractionBlockedResponse = {
  status: "blocked";
  errorCode: string;
  message: string;
  attempt?: ExtractionAttemptSummary;
};

export type ExtractionResponse = ExtractionSuccessResponse | ExtractionBlockedResponse;

export class ExtractionApiError extends Error {
  readonly errorCode: string;

  constructor(errorCode: string, message: string) {
    super(message);
    this.name = "ExtractionApiError";
    this.errorCode = errorCode;
  }
}

export async function requestExtractionPreflight(
  source: DossierSourcePayload
): Promise<PreflightResponse> {
  const response = await fetch("/api/setup-extractions/preflight", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source })
  });

  const payload = (await response.json().catch(() => ({}))) as PreflightResponse & {
    errorCode?: string;
    message?: string;
  };

  if (!response.ok) {
    throw new ExtractionApiError(payload.errorCode ?? "PRICING_UNAVAILABLE", payload.message ?? "Preflight failed.");
  }

  return payload;
}

// User-funded OpenRouter BYOK correction: this is the only completion-
// capable call besides retryExtraction below -- attaches the user's own
// connected OpenRouter credential (never the operator's) as a header.
// requestExtractionPreflight above deliberately does NOT attach it: it
// makes zero createChatCompletion calls, so it remains usable before
// connecting (Section 5/Section 6 of the correction task).
export async function submitExtraction(
  extractionRequestId: string,
  source: DossierSourcePayload
): Promise<ExtractionResponse> {
  const response = await fetch("/api/setup-extractions", {
    method: "POST",
    headers: withUserOpenRouterKeyHeader({ "content-type": "application/json" }),
    body: JSON.stringify({ extractionRequestId, source })
  });

  return parseExtractionResponse(response);
}

export async function retryExtraction(
  extractionRequestId: string,
  source: DossierSourcePayload
): Promise<ExtractionResponse> {
  const response = await fetch(
    `/api/setup-extractions/${encodeURIComponent(extractionRequestId)}/retry`,
    {
      method: "POST",
      headers: withUserOpenRouterKeyHeader({ "content-type": "application/json" }),
      body: JSON.stringify({ source })
    }
  );

  return parseExtractionResponse(response);
}

async function parseExtractionResponse(response: Response): Promise<ExtractionResponse> {
  const payload = (await response.json().catch(() => ({}))) as ExtractionResponse;

  // 429/409/400/5xx all arrive as a body-level { status: "blocked", ... }
  // shape (mirroring runPreflight's own body-level-status convention) --
  // the caller distinguishes further by errorCode, not raw HTTP status.
  return payload;
}

export async function dossierFileToPayload(file: File): Promise<DossierSourcePayload> {
  return {
    kind: "file",
    filename: file.name,
    contentBase64: arrayBufferToBase64(await file.arrayBuffer())
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}
