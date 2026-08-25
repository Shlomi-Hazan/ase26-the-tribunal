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
    expect(screen.getByText("No verdict yet")).toBeVisible();
    expect(screen.getByText(/Full Tribunal Package \(package.md\)/)).toBeVisible();
    expect(screen.queryByText(/Mock cost/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "No cases yet" })
    ).not.toBeInTheDocument();
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

  it("opens a persisted case detail without Tribunal output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          case: {
            id: "11111111-1111-4111-8111-111111111111",
            defendant: "Alex Rowan",
            act: "Entered the restricted lab.",
            exactQuestion: "Did Alex knowingly violate the lab protocol?",
            sourceType: "CHARGE_SHEET_FILE",
            sourceFilename: "charge.md",
            createdAt: "2026-08-25T10:00:00.000Z"
          }
        }),
        { status: 200 }
      )
    );

    renderWithAppProviders(
      <AppRoutes />,
      "/cases/11111111-1111-4111-8111-111111111111"
    );

    expect(await screen.findByRole("heading", { name: "Alex Rowan" }))
      .toBeVisible();
    expect(screen.getByText(/Entered the restricted lab/)).toBeVisible();
    expect(screen.getByText(/Charge Sheet file \(charge.md\)/)).toBeVisible();
    expect(screen.getByText(/no advocate speeches/i)).toBeVisible();
  });

  it("renders the empty-state component", () => {
    renderWithAppProviders(<EmptyHistoryState />);

    expect(screen.getByRole("heading", { name: "No cases yet" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Bring a Case" })).toBeVisible();
  });
});
