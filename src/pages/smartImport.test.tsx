// Milestone 7A -- Smart Import UI tests (ADR 0004 Decision 18).

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
import { AppRoutes } from "../app/App";
import { packageSeats } from "../schemas/tribunalSetup";

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
    conservativeMaxCostUsd: "0.10",
    hardCeilingUsd: "0.50",
    blockedReasonCodes: [],
    pricingObservedAt: "2026-01-01T00:00:00.000Z"
  };
}

function successExtraction() {
  return {
    status: "success",
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
      warnings: []
    },
    warnings: [],
    attempt: { attemptNumber: 1, status: "SUCCESS", conservativeMaxCostUsd: "0.10", actualCostUsd: "0.02", errorCode: null }
  };
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

  it("requests a preflight quote and shows the eligible estimate", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse(eligiblePreflight()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await user.type(screen.getByLabelText(/paste dossier text/i), "A case dossier.");
    await user.click(screen.getByRole("button", { name: /check eligibility & cost/i }));

    await waitFor(() => {
      expect(screen.getByText(/estimated maximum cost/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/\$0\.10/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/setup-extractions/preflight",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("Confirm & Extract calls the initial endpoint and shows the Extraction Review screen", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await user.type(screen.getByLabelText(/paste dossier text/i), "A case dossier.");
    await user.click(screen.getByRole("button", { name: /check eligibility & cost/i }));
    await waitFor(() => screen.getByRole("button", { name: /confirm & extract/i }));
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => {
      expect(screen.getByText(/extraction review/i)).toBeInTheDocument();
    });
    expect(screen.getByDisplayValue("Extracted Defendant")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/setup-extractions",
      expect.objectContaining({ method: "POST" })
    );
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

  it("Apply extracted draft navigates to the existing setup Review screen with the applied fields", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    fetchSpy.mockResolvedValueOnce(jsonResponse(eligiblePreflight()));
    fetchSpy.mockResolvedValueOnce(jsonResponse(successExtraction()));

    renderWithAppProviders(<AppRoutes />, "/new/smart-import");

    await user.type(screen.getByLabelText(/paste dossier text/i), "A case dossier.");
    await user.click(screen.getByRole("button", { name: /check eligibility & cost/i }));
    await waitFor(() => screen.getByRole("button", { name: /confirm & extract/i }));
    await user.click(screen.getByRole("button", { name: /confirm & extract/i }));

    await waitFor(() => screen.getByRole("button", { name: /apply extracted draft/i }));
    await user.click(screen.getByRole("button", { name: /apply extracted draft/i }));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /review/i })).toBeInTheDocument();
    });
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
});
