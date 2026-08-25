import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { AppShell } from "../layout/AppShell";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
import { AppRoutes } from "./App";

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
    expect(screen.getByRole("link", { name: "New Case" })).toHaveFocus();

    await user.tab();
    expect(screen.getByRole("link", { name: "Past Cases" })).toHaveFocus();
  });

  it("renders New Case and Past Cases routes", () => {
    renderApp("/new/charge-sheet");
    expect(
      screen.getByRole("heading", { name: "Charge Sheet" })
    ).toBeVisible();

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
