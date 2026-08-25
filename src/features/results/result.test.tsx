import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../../app/App";
import { renderWithAppProviders } from "../../test/renderWithAppProviders";

describe("mock result hierarchy", () => {
  it("places majority before judge votes, reasoning, speeches, and economics", () => {
    renderWithAppProviders(<AppRoutes />, "/demo/result");

    const verdict = screen.getByText("TRIBUNAL VERDICT");
    const voteGroup = screen.getByTestId("judge-vote-group");
    const reasoning = screen.getByRole("heading", { name: "Judge reasoning" });
    const speeches = screen.getByRole("heading", { name: "Advocate speeches" });
    const economics = screen.getByTestId("economics-section");

    expect(verdict).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "GUILTY" })
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText(/deterministic majority/i)).toBeVisible();
    expect(within(voteGroup).getByText("Judge I")).toBeVisible();
    expect(within(voteGroup).getByText("Judge II")).toBeVisible();
    expect(within(voteGroup).getByText("Judge III")).toBeVisible();
    expect(
      verdict.compareDocumentPosition(voteGroup) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      voteGroup.compareDocumentPosition(reasoning) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      reasoning.compareDocumentPosition(speeches) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      speeches.compareDocumentPosition(economics) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("uses subordinate heading levels for result sections", () => {
    renderWithAppProviders(<AppRoutes />, "/demo/result");

    expect(screen.getByRole("heading", { level: 2, name: "Three judge votes" }))
      .toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Judge reasoning" }))
      .toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Advocate speeches" }))
      .toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Mock economics" }))
      .toBeVisible();
  });

  it("renders historical GUILTY and NOT_GUILTY fixtures consistently", () => {
    const guiltyResult = renderWithAppProviders(
      <AppRoutes />,
      "/demo/result?source=history&case=hist-1"
    );

    expect(screen.getByText(/model calls are not being repeated/i)).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "GUILTY" })
    ).toBeVisible();
    guiltyResult.unmount();

    renderWithAppProviders(
      <AppRoutes />,
      "/demo/result?source=history&case=hist-2"
    );

    expect(screen.getByText(/model calls are not being repeated/i)).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 1, name: "NOT_GUILTY" })
    ).toBeVisible();

    const voteGroup = screen.getByTestId("judge-vote-group");
    expect(within(voteGroup).getAllByText("NOT_GUILTY")).toHaveLength(2);
    expect(within(voteGroup).getAllByText("GUILTY")).toHaveLength(1);
  });

  it("shows a safe mock not-found state for unknown historical result ids", () => {
    renderWithAppProviders(
      <AppRoutes />,
      "/demo/result?source=history&case=unknown"
    );

    expect(
      screen.getByText(/mock historical result could not be found/i)
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to Past Cases" })
    ).toBeVisible();
  });

  it("contains detailed economics in a scrollable table region", () => {
    renderWithAppProviders(<AppRoutes />, "/demo/result");

    const scrollRegion = screen.getByTestId("economics-table-scroll");
    expect(
      within(scrollRegion).getByRole("table", { name: "Mock economics attempts" })
    ).toBeVisible();
  });
});
