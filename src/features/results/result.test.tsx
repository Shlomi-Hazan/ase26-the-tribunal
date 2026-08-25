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
    expect(screen.getByRole("heading", { name: "GUILTY" })).toBeVisible();
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

  it("discloses historical result reopening", () => {
    renderWithAppProviders(<AppRoutes />, "/demo/result?source=history");

    expect(screen.getByText(/model calls are not being repeated/i)).toBeVisible();
  });
});
