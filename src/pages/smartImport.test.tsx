// Milestone 7A -- Smart Import UI tests (ADR 0004 Decision 18; corrected
// this pass, independent pre-live audit, Sections 8/13/15/16: lost-
// response recovery replays the correct endpoint, all warnings including
// field:null ones are visible, the economics/audit quote and post-attempt
// figures are displayed, and the Smart-Import provenance marker
// disambiguates the reused TRIBUNAL_PACKAGE_FILE/tribunal_package
// enum values on the downstream Review screen).

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
import { AppRoutes } from "../app/App";
import { packageSeats } from "../schemas/tribunalSetup";
import { RETRYABLE_ERROR_CODES, SMART_IMPORT_PROVENANCE_MARKER } from "./smartImportConstants";
// Server-only module -- safe to import here because vitest test files are
// never part of the Vite app entry graph that `npm run build` bundles
// into dist/, so this import cannot leak into the client bundle (see
// scripts/verify-client-bundle.mjs, which only scans dist/).
import { isRetryableExtractionFailure } from "../../netlify/server/extraction/errors";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function eligiblePreflight() {
  return {
    eligible: true,
    configuredModelId: "vendor/model",
    canonicalModelId: "vendor/model-canonical",
    providerEndpointTag: "vendor/model/endpoint-a",
    logicalConservativeMaxCostUsd: "0.20",
    perAttemptConservativeMaxCostUsd: "0.10",
    hardCeilingUsd: "0.50",
    blockedReasonCodes: [],
    pricingObservedAt: "2026-01-01T00:00:00.000Z",
    promptVersion: "package-extraction-v1"
  };
}

function attemptSummary(overrides: Record<string, unknown> = {}) {
  return {
    attemptNumber: 1,
    status: "SUCCESS",
    canonicalModelId: "vendor/model-canonical",
    providerEndpointTag: "vendor/model/endpoint-a",
    conservativeMaxCostUsd: "0.10",
    actualInputTokens: 500,
    actualOutputTokens: 200,
    actualCostUsd: "0.02",
    latencyMs: 1200,
    errorCode: null,
    ...overrides
  };
}

function successExtraction(
  warnings: { code: string; field: string | null }[] = [],
  attemptOverrides: Record<string, unknown> = {}
) {
  return {
    status: warnings.length > 0 ? "needs_review" : "success",
    draft: {
      chargeSheet: {
        defendant: "Extracted Defendant",
        act: "Extracted act.",
        exactQuestion: "Extracted exact question?"
      },
      participants: Object.fromEntries(
        packageSeats.map((seat) => [
          seat,
          { profileName: `${seat} profile`, personality: `${seat} personality description.` }
        ])
      ),
      warnings
    },
    warnings,
    attempt: attemptSummary(attemptOverrides)
  };
}

function blocked(errorCode: string, attemptOverrides: Record<string, unknown> = {}) {
  return {
    status: "blocked",
    errorCode,
    message: `Extraction failed: ${errorCode}.`,
    attempt: attemptSummary({ status: errorCode, errorCode, actualCostUsd: null, ...attemptOverrides })
  };
}

function inProgress() {
  return {
    status: "in_progress",
    attempt: attemptSummary({ status: "CLAIMED", errorCode: null, actualCostUsd: null })
  };
}

async function reachQuote(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/paste dossier text/i), "A case dossier.");
  await user.click(screen.getByRole("button", { name: /check eligibility & cost/i }));
  await waitFor(() => screen.getByRole("button", { name: /confirm & extract/i }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Smart Import", () => {
  it("shows the four-part privacy disclosure before upload/paste", () => {
    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    expect(screen.getByText(/raw dossier is not retained/i)).toBeInTheDocument();
    expect(screen.getByText(/may be retained for recovery and audit/i)).toBeInTheDocument();
    expect(screen.getByText(/no private per-user ownership guarantee/i)).toBeInTheDocument();
    expect(screen.getByText(/do not submit sensitive/i)).toBeInTheDocument();
  });

  it("requests a preflight quote and shows the logical (both-attempts) estimate plus the audit detail (Section 13)", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(eligiblePreflight()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await user.type(screen.getByLabelText(/paste dossier text/i), "A case dossier.");
    await user.click(screen.getByRole("button", { name: /check eligibility & cost/i }));

    await waitFor(() => {
      expect(screen.getByText(/estimated maximum cost/i)).toBeInTheDocument();
    });
    // Headline is the LOGICAL (both-attempts) figure against the $0.50
    // ceiling, not the per-attempt figure alone.
    expect(screen.getByText(/\$0\.20/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.50/)).toBeInTheDocument();
    // Audit detail: configured vs. resolved canonical model, endpoint,
    // per-attempt maximum, and pricing observation timestamp.
    expect(screen.getByText(/vendor\/model/)).toBeInTheDocument();
    expect(screen.getByText(/vendor\/model-canonical/)).toBeInTheDocument();
    expect(screen.getByText(/vendor\/model\/endpoint-a/)).toBeInTheDocument();
    expect(screen.getByText(/per-attempt conservative maximum.*\$0\.10/i)).toBeInTheDocument();
    expect(screen.getByText(/pricing observed/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/setup-extractions/preflight",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("Confirm & Extract calls the initial endpoint and shows the Extraction Review screen with the actual post-attempt cost (Section 13)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Extracted Defendant")).toBeInTheDocument();
    expect(screen.getByText(/attempt 1 actual.*\$0\.02/i)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/setup-extractions",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("shows document-level (field: null) warnings, e.g. UNSUPPORTED_CONTENT_IGNORED, which the per-field display alone would never surface (Section 15)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(successExtraction([{ code: "UNSUPPORTED_CONTENT_IGNORED", field: null }]))
    );

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/not used for any field/i)).toBeInTheDocument();
    expect(screen.getByText("UNSUPPORTED_CONTENT_IGNORED")).toBeInTheDocument();
  });

  it("an explicit attempt #1 retryable failure (e.g. PROVIDER_UNAVAILABLE) offers Retry, which calls the retry endpoint with the same extraction id (Section 8)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(blocked("PROVIDER_UNAVAILABLE")));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => screen.getByRole("button", { name: /^retry$/i }));

    const initialCall = fetchSpy.mock.calls[1];
    const initialBody = JSON.parse(String(initialCall[1]?.body)) as { extractionRequestId: string };

    await user.click(screen.getByRole("button", { name: /^retry$/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });

    const retryCall = fetchSpy.mock.calls[2];

    expect(String(retryCall[0])).toBe(`/api/setup-extractions/${initialBody.extractionRequestId}/retry`);
    expect(retryCall[1]).toEqual(expect.objectContaining({ method: "POST" }));
  });

  // Second independent pre-live re-audit, Section 7: ADR 0004 Decision 9
  // requires a running cumulative total across BOTH attempts, visible
  // before AND after Retry -- attempt #1's own economics must not
  // disappear once attempt #2 exists.
  it("shows a running cumulative economics total across both attempts after a successful retry (Section 7)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(blocked("PROVIDER_UNAVAILABLE")));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => screen.getByRole("button", { name: /^retry$/i }));

    // Before Retry: attempt #1's own conservative maximum (actual
    // unknown -- never fabricated as zero) plus a clearly-labeled
    // POTENTIAL attempt #2 figure and potential cumulative.
    expect(screen.getByText(/attempt 1 conservative maximum.*\$0\.10/i)).toBeInTheDocument();
    expect(screen.getByText(/attempt 2 potential conservative maximum.*\$0\.10/i)).toBeInTheDocument();
    expect(screen.getByText(/potential cumulative.*\$0\.2 \/ \$0\.50/i)).toBeInTheDocument();

    fetchSpy.mockResolvedValueOnce(
      jsonResponse(
        successExtraction([], {
          attemptNumber: 2,
          status: "SUCCESS",
          actualCostUsd: "0.03",
          errorCode: null
        })
      )
    );
    await user.click(screen.getByRole("button", { name: /^retry$/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });

    // After Retry: BOTH attempts' real figures are visible together,
    // and the cumulative total is no longer labeled "potential".
    expect(screen.getByText(/attempt 1 conservative maximum.*\$0\.10/i)).toBeInTheDocument();
    expect(screen.getByText(/attempt 2 actual.*\$0\.03/i)).toBeInTheDocument();
    expect(screen.getByText(/^cumulative:.*\$0\.13 \/ \$0\.50/i)).toBeInTheDocument();
    expect(screen.queryByText(/potential cumulative/i)).not.toBeInTheDocument();
  });

  // Second independent pre-live re-audit, Section 8: ADR 0004 Decision 18
  // requires Extraction Review to show, at secondary audit-detail level,
  // the source (filename/type) and the frozen prompt version -- neither
  // was displayed (or even available from the API response) before.
  it("Extraction Review shows the source, frozen prompt version, and model/endpoint audit detail (Section 8)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/source: pasted text/i)).toBeInTheDocument();
    expect(screen.getByText(/prompt version: package-extraction-v1/i)).toBeInTheDocument();
    expect(screen.getByText(/vendor\/model-canonical/)).toBeInTheDocument();
    expect(screen.getByText(/vendor\/model\/endpoint-a/)).toBeInTheDocument();
  });

  it("an explicit attempt #1 NON-retryable failure (e.g. MODEL_NOT_ELIGIBLE) never offers Retry and never calls the retry endpoint merely because an extraction id exists (Section 8)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(blocked("MODEL_NOT_ELIGIBLE")));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction failed: model_not_eligible/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /^retry$/i })).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("a lost HTTP response after Confirm & Extract offers Recover, which idempotently replays the INITIAL endpoint (not retry) with the same extraction id (Section 8)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => screen.getByRole("button", { name: /^recover$/i }));
    expect(screen.getByText(/connection was lost/i)).toBeInTheDocument();

    const initialCall = fetchSpy.mock.calls[1];
    const initialBody = JSON.parse(String(initialCall[1]?.body)) as { extractionRequestId: string };

    await user.click(screen.getByRole("button", { name: /^recover$/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });

    const recoverCall = fetchSpy.mock.calls[2];
    const recoverBody = JSON.parse(String(recoverCall[1]?.body)) as { extractionRequestId: string };

    expect(String(recoverCall[0])).toBe("/api/setup-extractions");
    expect(recoverBody.extractionRequestId).toBe(initialBody.extractionRequestId);
  });

  it("a server-confirmed in-progress (CLAIMED) outcome offers Check Status, which replays the same last-sent endpoint rather than starting a new attempt (Section 8)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(inProgress()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => screen.getByRole("button", { name: /check status/i }));
    expect(screen.getByText(/still in progress on the server/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /check status/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });
    expect(String(fetchSpy.mock.calls[2][0])).toBe("/api/setup-extractions");
  });

  it("a lost HTTP response after clicking Retry recovers by replaying the RETRY endpoint again, not the initial endpoint (Section 8)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(blocked("TIMEOUT")));
    fetchSpy.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => screen.getByRole("button", { name: /^retry$/i }));
    await user.click(screen.getByRole("button", { name: /^retry$/i }));

    await waitFor(() => screen.getByRole("button", { name: /^recover$/i }));

    const retryCallUrl = String(fetchSpy.mock.calls[2][0]);

    await user.click(screen.getByRole("button", { name: /^recover$/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });

    expect(String(fetchSpy.mock.calls[3][0])).toBe(retryCallUrl);
    expect(retryCallUrl).toMatch(/\/retry$/);
  });

  it("Cancel from the quote screen returns to Charge Sheet without dispatching anything", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(eligiblePreflight()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await user.type(screen.getByLabelText(/paste dossier text/i), "A case dossier.");
    await user.click(screen.getByRole("button", { name: /check eligibility & cost/i }));
    await waitFor(() => screen.getByRole("button", { name: /cancel/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /charge sheet/i })).toBeInTheDocument();
    });
  });

  it("Apply extracted draft navigates to the existing setup Review screen with the applied fields, and the Review screen visibly disambiguates the reused TRIBUNAL_PACKAGE_FILE/tribunal_package provenance mapping as Smart Import rather than a literal file upload (Section 16)", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await reachQuote(user);
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => screen.getByRole("button", { name: /apply extracted draft/i }));
    await user.click(screen.getByRole("button", { name: /apply extracted draft/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /review/i })).toBeInTheDocument();
    });
    expect(screen.getAllByText(new RegExp(SMART_IMPORT_PROVENANCE_MARKER)).length).toBeGreaterThan(0);
  });

  it("never makes an OpenRouter completion call directly -- only ever calls the /api/setup-extractions* endpoints", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await user.type(screen.getByLabelText(/paste dossier text/i), "A case dossier.");
    await user.click(screen.getByRole("button", { name: /check eligibility & cost/i }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).toMatch(/^\/api\/setup-extractions/);
    }
  });

  it("the client's retryable-error-code set stays in sync with the server's authoritative netlify/server/extraction/errors.ts (anti-drift)", () => {
    const serverRetryableCodes = [
      "INPUT_INVALID",
      "UNSUPPORTED_FILE_TYPE",
      "FILE_TOO_LARGE",
      "PDF_TEXT_UNAVAILABLE",
      "PDF_ENCRYPTED_OR_INVALID",
      "NORMALIZED_TEXT_EMPTY",
      "INPUT_TOO_LARGE_FOR_MODEL",
      "MODEL_NOT_ELIGIBLE",
      "PRICING_UNAVAILABLE",
      "BLOCKED_BUDGET",
      "PROVIDER_UNAVAILABLE",
      "TIMEOUT",
      "INVALID_STRUCTURED_OUTPUT",
      "IDEMPOTENCY_CONFLICT",
      "INPUT_PROCESSING_TIMEOUT",
      "RATE_LIMITED",
      "PROMPT_VERSION_UNAVAILABLE"
    ] as const;

    for (const code of serverRetryableCodes) {
      expect(RETRYABLE_ERROR_CODES.has(code)).toBe(isRetryableExtractionFailure(code));
    }
  });
});
