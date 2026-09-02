// Milestone 11 (Issue #27) -- History (/history) is case-level browsing
// only; it never fetches Run data. Case Detail (/cases/:caseId)'s own,
// much larger Milestone 11 test matrix -- zero/one/multiple Runs, exact
// status labels, no fabricated verdict, run-list failure vs. zero-run
// distinction, unknown-case safety, bounded request count, retention
// notice -- lives in src/pages/caseDetail.test.tsx, not here.

import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyHistoryState } from "./EmptyHistoryState";
import { AppRoutes } from "../../app/App";
import { renderWithAppProviders } from "../../test/renderWithAppProviders";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("stored case history", () => {
  it("shows persisted cases without fabricating verdicts or economics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cases: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              defendant: "Alex Rowan",
              act: "Entered the restricted lab.",
              exactQuestion: "Did Alex knowingly violate the lab protocol?",
              sourceType: "TRIBUNAL_PACKAGE_FILE",
              sourceFilename: "package.md",
              createdAt: "2026-08-25T10:00:00.000Z"
            }
          ]
        }),
        { status: 200 }
      )
    );

    renderWithAppProviders(<AppRoutes />, "/history");

    expect(await screen.findByText("Alex Rowan")).toBeVisible();
    // Milestone 11 (Issue #27) -- the stale unconditional M5-era
    // "No verdict yet" claim is removed, not replaced with a fetched
    // Run status (History stays case-level browsing and never fetches
    // Run data per card -- the real status lives one click away, on
    // Case Detail).
    expect(screen.queryByText("No verdict yet")).not.toBeInTheDocument();
    expect(screen.getByText(/Full Tribunal Package \(package.md\)/)).toBeVisible();
    expect(screen.queryByText(/Mock cost/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "No cases yet" })
    ).not.toBeInTheDocument();
  });

  it("shows the public-demo retention notice", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ cases: [] }), { status: 200 })
    );

    renderWithAppProviders(<AppRoutes />, "/history");

    await screen.findByRole("heading", { name: "No cases yet" });
    expect(
      screen.getByText(/shared, single-tenant public course\/demo application/i)
    ).toBeVisible();
  });

  it("makes exactly one case-list request regardless of case count", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          cases: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              defendant: "Alex Rowan",
              act: "Entered the restricted lab.",
              exactQuestion: "Did Alex knowingly violate the lab protocol?",
              sourceType: "MANUAL",
              sourceFilename: null,
              createdAt: "2026-08-25T10:00:00.000Z"
            },
            {
              id: "22222222-2222-4222-8222-222222222222",
              defendant: "Jordan Vega",
              act: "Mislabeled a product.",
              exactQuestion: "Did Jordan know the label was wrong?",
              sourceType: "MANUAL",
              sourceFilename: null,
              createdAt: "2026-08-24T10:00:00.000Z"
            }
          ]
        }),
        { status: 200 }
      )
    );

    renderWithAppProviders(<AppRoutes />, "/history");

    await screen.findByText("Alex Rowan");
    expect(screen.getByText("Jordan Vega")).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith("/api/cases");
  });

  it("renders the empty state when no stored cases exist", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ cases: [] }), { status: 200 })
    );

    renderWithAppProviders(<AppRoutes />, "/history");

    expect(
      await screen.findByRole("heading", { name: "No cases yet" })
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Bring a Case" })).toBeVisible();
  });

  it("renders the empty-state component", () => {
    renderWithAppProviders(<EmptyHistoryState />);

    expect(screen.getByRole("heading", { name: "No cases yet" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Bring a Case" })).toBeVisible();
  });
});
