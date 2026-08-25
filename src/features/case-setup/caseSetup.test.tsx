import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderWithAppProviders } from "../../test/renderWithAppProviders";
import { AppRoutes } from "../../app/App";
import {
  personalityLimit,
  validateParticipantPersonality
} from "./setupState";

describe("case setup workflow", () => {
  it("blocks Charge Sheet continuation until required fields are valid", async () => {
    const user = userEvent.setup();
    renderWithAppProviders(<AppRoutes />);

    await user.click(screen.getByRole("button", { name: /continue to advocates/i }));

    expect(screen.getByText("Defendant is required.")).toBeVisible();
    expect(screen.getByText("Act is required.")).toBeVisible();
    expect(screen.getByText("Exact Question is required.")).toBeVisible();
    expect(screen.getByLabelText(/defendant/i)).toHaveFocus();

    await user.type(screen.getByLabelText(/defendant/i), "Alex Rowan");
    await user.type(screen.getByLabelText(/^act/i), "Entered the restricted lab.");
    await user.type(
      screen.getByLabelText(/exact question/i),
      "Did Alex knowingly violate the lab protocol?"
    );
    await user.click(screen.getByRole("button", { name: /continue to advocates/i }));

    expect(screen.getByRole("heading", { name: "Advocates" })).toBeVisible();
  });

  it("validates participant personalities and blocks invalid advocate progression", async () => {
    const user = userEvent.setup();
    renderWithAppProviders(<AppRoutes />, "/new/advocates");

    await user.clear(screen.getByLabelText(/PRO I personality/i));

    expect(screen.getByText(/personality is required/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue to Judges" })).toBeDisabled();
    expect(
      screen.getByText(/complete all four advocate personalities before continuing/i)
    ).toBeVisible();

    expect(validateParticipantPersonality("")).toBe("Personality is required.");
    expect(validateParticipantPersonality("x".repeat(personalityLimit + 1))).toMatch(
      /4,000 characters or fewer/
    );

    fireEvent.change(screen.getByLabelText(/PRO I personality/i), {
      target: { value: "x".repeat(personalityLimit + 1) }
    });

    expect(screen.getByText(/4,000 characters or fewer/i)).toBeVisible();
  });

  it("blocks invalid judge progression", async () => {
    const user = userEvent.setup();
    renderWithAppProviders(<AppRoutes />, "/new/judges");

    await user.clear(screen.getByLabelText(/Judge II personality/i));

    expect(screen.getByRole("button", { name: "Review Tribunal" })).toBeDisabled();
    expect(
      screen.getByText(/complete all three judge personalities before review/i)
    ).toBeVisible();
  });

  it("does not mark invalid setup steps complete and blocks invalid review convening", () => {
    renderWithAppProviders(<AppRoutes />, "/new/review");

    const setupProgress = screen.getByLabelText("Case setup progress");
    expect(
      within(setupProgress).getByRole("link", { name: /Charge Sheet/i })
    ).not.toHaveTextContent("Complete");
    expect(within(setupProgress).getAllByText("Complete")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Convene Tribunal" })).toBeDisabled();
    expect(
      screen.getByText(/mock tribunal cannot be convened yet/i)
    ).toBeVisible();
    expect(screen.getByText(/charge sheet fields must be complete/i)).toBeVisible();
  });

  it("renders exactly four fixed advocates and exactly three fixed judges", () => {
    renderWithAppProviders(<AppRoutes />, "/new/advocates");

    expect(screen.getByRole("heading", { name: "PRO I" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "PRO II" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "CON I" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "CON II" })).toBeVisible();
    expect(screen.getAllByText(/fixed side/i)).toHaveLength(4);

    renderWithAppProviders(<AppRoutes />, "/new/judges");
    expect(screen.getByRole("heading", { name: "Judge I" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Judge II" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Judge III" })).toBeVisible();
  });

  it("uses one shared selector in Shared mode and participant selectors in Separate mode", async () => {
    const user = userEvent.setup();
    renderWithAppProviders(<AppRoutes />, "/new/advocates");

    expect(screen.getByLabelText("Shared mock model")).toBeVisible();
    expect(screen.queryByLabelText("PRO I mock model")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Separate Models" }));

    expect(screen.getByLabelText("PRO I mock model")).toBeVisible();
    expect(screen.getByLabelText("PRO II mock model")).toBeVisible();
    expect(screen.getByLabelText("CON I mock model")).toBeVisible();
    expect(screen.getByLabelText("CON II mock model")).toBeVisible();
  });

  it("shows review gate geometry, budget policy, privacy warning, and mock economics", () => {
    renderWithAppProviders(<AppRoutes />, "/new/review");

    expect(screen.getByText(/expected logical calls/i)).toHaveTextContent("7");
    expect(screen.getByText(/hard policy/i)).toHaveTextContent("$5.00");
    expect(screen.getByText(/mock conservative estimate/i)).toBeVisible();
    expect(screen.getByText(/do not submit sensitive/i)).toBeVisible();
    expect(
      within(screen.getByTestId("economics-section")).getByText(/mock fixture data/i)
    ).toBeVisible();
  });
});
