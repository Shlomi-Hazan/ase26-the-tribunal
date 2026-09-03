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
    expect(screen.getByRole("link", { name: "New Case" })).toBeVisible();
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
    expect(screen.getByRole("link", { name: "New Case" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Past Cases" })).toHaveFocus();
  });

  // Milestone 12 (Issue #32 Sec 5; human product override, PR #34
  // Sec 13-14): `/` previously redirected straight into
  // `/new/charge-sheet` -- it is now a small generic Home surface, and
  // the Jon Snow card exposes two explicit actions.
  it("renders the Home route with Create/Past Cases/Jon Snow demo actions", () => {
    renderApp("/");

    expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
    expect(screen.getByRole("link", { name: "New Tribunal" })).toBeVisible();
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
