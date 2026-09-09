import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
import { AppRoutes } from "../app/App";

const RUN_ID = "99999999-9999-4999-8999-999999999999";

function runningRunResponse() {
  return new Response(
    JSON.stringify({
      run: {
        id: RUN_ID,
        caseId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        executionMode: "shared",
        status: "ADVOCATES_RUNNING",
        createdAt: "2026-08-25T10:00:00.000Z",
        startedAt: "2026-08-25T10:00:01.000Z",
        completedAt: null,
        majorityVerdict: null,
        failureCode: null,
        failureMessage: null,
        totalCostUsd: null,
        advocateCostUsd: null,
        judgeCostUsd: null,
        totalInputTokens: null,
        totalOutputTokens: null,
        totalTokens: null,
        logicalCallCount: 0,
        providerAttemptCount: 0,
        wallClockMs: null,
        partialSpend: null,
        admission: null,
        attempts: [],
        protocol: null,
        participants: []
      }
    }),
    { status: 200 }
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(runningRunResponse());
});

afterEach(() => {
  vi.restoreAllMocks();
});

// M14 presentation-routing correction (PR #40): a Jon Snow run is a real
// Tribunal run and must render through the exact same generic Ivory &
// Iron `/runs/:runId` presentation every other run uses -- the dark
// cinematic identity (JonSnowRunPage, now removed) belonged to the
// settings page only, never to the run/result screen. The legacy
// `/demo/jon-snow/runs/:runId` URL is preserved for backward
// compatibility as a stateless redirect to the same generic route,
// carrying the same runId, fetching/rendering nothing of its own.
describe("Legacy Jon Snow run URL (M14 presentation-routing correction)", () => {
  it("redirects /demo/jon-snow/runs/:runId to the generic /runs/:runId, rendering the ordinary RunPage with no Jon Snow banner", async () => {
    renderWithAppProviders(<AppRoutes />, `/demo/jon-snow/runs/${RUN_ID}`);

    expect(await screen.findByText(/deliberation in progress/i)).toBeVisible();
    // The removed JonSnowRunPage banner must never appear -- the run's
    // Jon Snow identity already lives in the case/run data itself, not
    // in a page-level presentation wrapper.
    expect(
      screen.queryByRole("heading", { name: "The Realm v. Jon Snow" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/featured demo/i)).not.toBeInTheDocument();
  });

  it("the same canonical Jon Snow run renders identically whether reached via the legacy URL or the generic URL directly", async () => {
    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/deliberation in progress/i)).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "The Realm v. Jon Snow" })
    ).not.toBeInTheDocument();
  });
});
