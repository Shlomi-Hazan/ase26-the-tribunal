// Milestone 11 (Issue #27) -- CaseDetailPage (/cases/:caseId) test matrix:
// zero/one/multiple Runs, exact status labels (never a fabricated
// verdict), a run-list failure honestly distinguished from zero Runs, an
// unknown Case never presented as a fake zero-run Case, a bounded
// (constant) request count independent of Run count, and the shared
// public-demo retention notice. Zero real network calls -- fetch is
// mocked directly, matching this codebase's established convention.

import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../app/App";
import { renderWithAppProviders } from "../test/renderWithAppProviders";

const CASE_ID = "11111111-1111-4111-8111-111111111111";

const STORED_CASE = {
  id: CASE_ID,
  defendant: "Alex Rowan",
  act: "Entered the restricted lab.",
  exactQuestion: "Did Alex knowingly violate the lab protocol?",
  sourceType: "CHARGE_SHEET_FILE",
  sourceFilename: "charge.md",
  createdAt: "2026-08-25T10:00:00.000Z"
};

afterEach(() => {
  vi.restoreAllMocks();
});

function runSummary(overrides: Record<string, unknown> = {}) {
  return {
    runId: "22222222-2222-4222-8222-222222222222",
    caseId: CASE_ID,
    status: "COMPLETED",
    executionMode: "shared",
    createdAt: "2026-08-29T00:00:00.000Z",
    startedAt: "2026-08-29T00:00:01.000Z",
    completedAt: "2026-08-29T00:00:05.000Z",
    ...overrides
  };
}

function mockCaseFetch(options: {
  caseStatus?: number;
  caseBody?: unknown;
  runsStatus?: number;
  runsBody?: unknown;
  failRuns?: boolean;
}) {
  const {
    caseStatus = 200,
    caseBody = { case: STORED_CASE },
    runsStatus = 200,
    runsBody = { runs: [] },
    failRuns = false
  } = options;

  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);

    if (url === `/api/cases/${CASE_ID}`) {
      return new Response(JSON.stringify(caseBody), { status: caseStatus });
    }

    if (url === `/api/cases/${CASE_ID}/runs`) {
      if (failRuns) {
        throw new TypeError("Network request failed");
      }

      return new Response(JSON.stringify(runsBody), { status: runsStatus });
    }

    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

describe("CaseDetailPage (Milestone 11, Issue #27)", () => {
  it("a real Case with zero Runs shows the honest empty-runs state", async () => {
    mockCaseFetch({ runsBody: { runs: [] } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    expect(await screen.findByRole("heading", { name: "Alex Rowan" })).toBeVisible();
    expect(
      await screen.findByText("No Tribunal run has been started for this case yet.")
    ).toBeVisible();
  });

  it("a Case with one Run lists it and links to /runs/:runId", async () => {
    mockCaseFetch({ runsBody: { runs: [runSummary()] } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    expect(await screen.findByText("Completed")).toBeVisible();
    const link = screen.getByRole("link", { name: "View run" });

    expect(link).toHaveAttribute("href", "/runs/22222222-2222-4222-8222-222222222222");
  });

  it("a Case with multiple Runs lists all of them in the supplied (server) order", async () => {
    mockCaseFetch({
      runsBody: {
        runs: [
          runSummary({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "COMPLETED" }),
          runSummary({ runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "FAILED" })
        ]
      }
    });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    const links = await screen.findAllByRole("link", { name: "View run" });

    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/runs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(links[1]).toHaveAttribute("href", "/runs/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it.each([
    ["DRAFT", "Draft"],
    ["READY", "Ready"],
    ["ADVOCATES_RUNNING", "Advocates running"],
    ["JUDGES_RUNNING", "Judges deliberating"],
    ["COMPLETED", "Completed"],
    ["FAILED", "Failed"],
    ["BLOCKED_BUDGET", "Budget blocked"]
  ])("renders a distinct label for status %s", async (status, label) => {
    mockCaseFetch({ runsBody: { runs: [runSummary({ status })] } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    expect(await screen.findByText(label)).toBeVisible();
  });

  it("a COMPLETED Run row never shows a Tribunal verdict", async () => {
    mockCaseFetch({ runsBody: { runs: [runSummary({ status: "COMPLETED" })] } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    await screen.findByText("Completed");
    expect(screen.queryByText("GUILTY")).not.toBeInTheDocument();
    expect(screen.queryByText("NOT_GUILTY")).not.toBeInTheDocument();
  });

  it("a FAILED Run row never shows a verdict either", async () => {
    mockCaseFetch({ runsBody: { runs: [runSummary({ status: "FAILED" })] } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    await screen.findByText("Failed");
    expect(screen.queryByText("GUILTY")).not.toBeInTheDocument();
    expect(screen.queryByText("NOT_GUILTY")).not.toBeInTheDocument();
  });

  it("BLOCKED_BUDGET is visibly distinct from FAILED", async () => {
    mockCaseFetch({
      runsBody: {
        runs: [
          runSummary({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "FAILED" }),
          runSummary({ runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", status: "BLOCKED_BUDGET" })
        ]
      }
    });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    expect(await screen.findByText("Failed")).toBeVisible();
    expect(screen.getByText("Budget blocked")).toBeVisible();
  });

  it("shows no cost/economics/audit summary on Case Detail", async () => {
    mockCaseFetch({ runsBody: { runs: [runSummary()] } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    await screen.findByText("Completed");
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/logical call/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/attempt/i)).not.toBeInTheDocument();
  });

  it("a run-list failure is surfaced honestly and is NOT presented as zero Runs", async () => {
    mockCaseFetch({ failRuns: true });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    expect(
      await screen.findByText("Tribunal runs could not be loaded.")
    ).toBeVisible();
    expect(
      screen.queryByText("No Tribunal run has been started for this case yet.")
    ).not.toBeInTheDocument();
  });

  it("a run-list server error is also surfaced honestly, not as zero Runs", async () => {
    mockCaseFetch({ runsStatus: 500, runsBody: { error: "run_persistence_failed" } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    expect(
      await screen.findByText("Tribunal runs could not be loaded.")
    ).toBeVisible();
    expect(
      screen.queryByText("No Tribunal run has been started for this case yet.")
    ).not.toBeInTheDocument();
  });

  it("a valid but unknown Case resolves to the existing case-not-found behavior, never a fake zero-run Case", async () => {
    mockCaseFetch({
      caseStatus: 404,
      caseBody: { error: "case_not_found" },
      // Even though the run-list endpoint alone would legitimately
      // return [] for this same id (Issue #27 "Case ID error
      // semantics"), Case Detail must never render the Runs section at
      // all once the Case itself failed to resolve.
      runsBody: { runs: [] }
    });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    expect(await screen.findByText("Saved case was not found.")).toBeVisible();
    expect(screen.queryByText("Tribunal Runs")).not.toBeInTheDocument();
    expect(
      screen.queryByText("No Tribunal run has been started for this case yet.")
    ).not.toBeInTheDocument();
  });

  it("makes a bounded, constant number of requests (case + runs) independent of Run count", async () => {
    const fetchSpy = mockCaseFetch({
      runsBody: {
        runs: [
          runSummary({ runId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
          runSummary({ runId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
          runSummary({ runId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })
        ]
      }
    });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: "View run" })).toHaveLength(3);
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("shows the public-demo retention notice", async () => {
    mockCaseFetch({ runsBody: { runs: [] } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    expect(
      screen.getByText(/shared, single-tenant public course\/demo application/i)
    ).toBeVisible();
  });

  it("attaches no BYOK/OpenRouter credential header to the run-list request", async () => {
    const fetchSpy = mockCaseFetch({ runsBody: { runs: [] } });

    renderWithAppProviders(<AppRoutes />, `/cases/${CASE_ID}`);

    await screen.findByRole("heading", { name: "Alex Rowan" });
    await waitFor(() => {
      expect(
        fetchSpy.mock.calls.some(([url]) => String(url) === `/api/cases/${CASE_ID}/runs`)
      ).toBe(true);
    });

    const runsCall = fetchSpy.mock.calls.find(
      ([url]) => String(url) === `/api/cases/${CASE_ID}/runs`
    );

    expect(runsCall?.[1]).toBeUndefined();
  });
});
