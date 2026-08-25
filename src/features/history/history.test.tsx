import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyHistoryState } from "./EmptyHistoryState";
import { AppRoutes } from "../../app/App";
import { renderWithAppProviders } from "../../test/renderWithAppProviders";

describe("mock history", () => {
  it("shows completed and failed mock cases without giving failed cases a verdict", () => {
    renderWithAppProviders(<AppRoutes />, "/history");

    expect(screen.getByText("Verdict: GUILTY")).toBeVisible();
    expect(screen.getByText("Verdict: NOT_GUILTY")).toBeVisible();
    expect(screen.getByText("No verdict")).toBeVisible();
    expect(screen.getByText(/static mock history only/i)).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "No cases yet" })
    ).not.toBeInTheDocument();
  });

  it("renders the empty-state component", () => {
    renderWithAppProviders(<EmptyHistoryState />);

    expect(screen.getByRole("heading", { name: "No cases yet" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Bring a Case" })).toBeVisible();
  });
});
