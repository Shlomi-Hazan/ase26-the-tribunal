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

// Milestone 12 (Issue #32 Sec 10-11) -- theme is a pure function of which
// route reached the run, never of the run's own content. Both routes
// fetch and render the IDENTICAL underlying run (same RUN_ID, same
// RunPage data/logic); only the presentational wrapper differs.
describe("Jon Snow theme routing", () => {
  it("renders the themed wrapper on /demo/jon-snow/runs/:runId", async () => {
    renderWithAppProviders(<AppRoutes />, `/demo/jon-snow/runs/${RUN_ID}`);

    expect(
      await screen.findByRole("heading", { name: "The Realm v. Jon Snow" })
    ).toBeVisible();
    expect(await screen.findByText(/deliberation in progress/i)).toBeVisible();
  });

  it("renders the same run generically, with no theming, on /runs/:runId", async () => {
    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/deliberation in progress/i)).toBeVisible();
    expect(screen.queryByRole("heading", { name: "The Realm v. Jon Snow" })).not.toBeInTheDocument();
  });
});
