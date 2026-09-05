import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "../layout/AppShell";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
import { AppRoutes } from "./App";

afterEach(() => {
  vi.restoreAllMocks();
});

function renderApp(path = "/new/charge-sheet") {
  return renderWithAppProviders(
    <AppShell>
      <AppRoutes />
    </AppShell>,
    path
  );
}

describe("application shell and routing", () => {
  it("renders primary navigation", () => {
    renderApp();

    expect(screen.getByRole("link", { name: "The Tribunal" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Home" })).toBeVisible();
    // Milestone 14 (Ivory & Iron, Issue #39 Phase 2): nav label renamed
    // "New Case" -> "New Tribunal".
    expect(screen.getByRole("link", { name: "New Tribunal" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Past Cases" })).toBeVisible();
    expect(screen.getByText(/not legal advice/i)).toBeVisible();
  });

  it("supports keyboard traversal through primary navigation", async () => {
    const user = userEvent.setup();
    renderApp();

    await user.tab();
    expect(screen.getByRole("link", { name: "The Tribunal" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Home" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "New Tribunal" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Past Cases" })).toHaveFocus();
  });

  // Milestone 12 (Issue #32 Sec 5; human product override, PR #34
  // Sec 13-14): `/` previously redirected straight into
  // `/new/charge-sheet` -- it is now a small generic Home surface, and
  // the Jon Snow card exposes two explicit actions.
  //
  // Milestone 14 (Ivory & Iron, Issue #39 Phase 2): the old plain
  // `<PageHeader title="Home">` heading was replaced by the hero
  // section's own `<h1>` -- purely presentational, no route/action
  // change. "New Tribunal" now appears three times on this route (nav,
  // hero, card), so it is asserted with getAllByRole rather than a
  // single unique match.
  it("renders the Home route with Create/Past Cases/Jon Snow demo actions", () => {
    renderApp("/");

    expect(
      screen.getByRole("heading", { level: 1, name: /deliberation/i })
    ).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "New Tribunal" }).length
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "View Past Cases" })).toBeVisible();
    expect(screen.getByRole("button", { name: /run jon snow demo/i })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /modify settings \/ models/i })
    ).toBeVisible();
  });

  it("renders New Case and Past Cases routes", () => {
    renderApp("/new/charge-sheet");
    expect(
      screen.getByRole("heading", { name: "Charge Sheet" })
    ).toBeVisible();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ cases: [] }), { status: 200 })
    );
    renderApp("/history");
    expect(screen.getByRole("heading", { name: "Past Cases" })).toBeVisible();
  });

  it("renders an unknown-route state", () => {
    renderApp("/unknown");

    expect(
      screen.getByRole("heading", { name: /page not found/i })
    ).toBeVisible();
  });
});

// Milestone 14 (Ivory & Iron, Issue #39 Phase 4, required route-theme
// tests 1-4 of 5; test 5 is jonSnowThemeRoute.test.ts's direct unit
// test of the pure isJonSnowThemedPath function). AppShell's own AppBar
// sx (`bgcolor: "background.paper"`) resolves through whichever theme
// AppThemeProvider selected -- white (#FFFFFF) for the default theme,
// iron (#161B22) for jonSnowTheme -- so its computed background color
// is a reliable, real (not simulated) signal of which theme rendered
// the actual shell, AppBar included.
const LIGHT_APPBAR_BG = "rgb(255, 255, 255)";
const DARK_APPBAR_BG = "rgb(22, 27, 34)";
const JON_SNOW_RUN_ID = "99999999-9999-4999-8999-999999999999";

function runningRunResponse() {
  return new Response(
    JSON.stringify({
      run: {
        id: JON_SNOW_RUN_ID,
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

describe("Milestone 14 route-scoped theming (Issue #39 Phase 4)", () => {
  it("1: keeps Home's shell Ivory & Iron (light) while the Jon Snow card renders its own dark portal", () => {
    renderApp("/");

    expect(getComputedStyle(screen.getByRole("banner")).backgroundColor).toBe(LIGHT_APPBAR_BG);

    // Milestone 12/14 human decision: JonSnowHomeCard stays intentionally
    // dark on an otherwise fully light Home page -- its own frost
    // (#D8DEE6) text color, applied directly in the card's own sx (not
    // from the ambient theme), is the signal this is the one deliberate
    // dark surface here.
    const card = screen.getByText("Featured demo").closest(".MuiCard-root");

    expect(card).not.toBeNull();
    expect(getComputedStyle(card as Element).color).toBe("rgb(216, 222, 230)");
  });

  it("2: renders /demo/jon-snow as a full dark shell, AppBar included", () => {
    renderApp("/demo/jon-snow");

    expect(getComputedStyle(screen.getByRole("banner")).backgroundColor).toBe(DARK_APPBAR_BG);
  });

  it("3: renders /demo/jon-snow/runs/:runId as a full dark shell, AppBar included", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(runningRunResponse());
    renderApp(`/demo/jon-snow/runs/${JON_SNOW_RUN_ID}`);

    expect(await screen.findByText(/deliberation in progress/i)).toBeVisible();
    expect(getComputedStyle(screen.getByRole("banner")).backgroundColor).toBe(DARK_APPBAR_BG);
  });

  it("4: /runs/:runId stays Ivory & Iron (light) for the exact same canonical Jon Snow run", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(runningRunResponse());
    renderApp(`/runs/${JON_SNOW_RUN_ID}`);

    expect(await screen.findByText(/deliberation in progress/i)).toBeVisible();
    expect(getComputedStyle(screen.getByRole("banner")).backgroundColor).toBe(LIGHT_APPBAR_BG);
  });
});
