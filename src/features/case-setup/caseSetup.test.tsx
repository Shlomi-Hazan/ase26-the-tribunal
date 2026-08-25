import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithAppProviders } from "../../test/renderWithAppProviders";
import { AppRoutes } from "../../app/App";
import {
  personalityLimit,
  validateParticipantPersonality
} from "./setupState";

const packageDraft = {
  chargeSheet: {
    defendant: "Imported Alex",
    act: "Imported act text.",
    exactQuestion: "Imported exact question?"
  },
  participants: {
    "advocate-pro-1": {
      profileName: "Evidence advocate",
      personality: "Imported PRO I personality.",
      personalitySource: "tribunal_package",
      personalitySourceFilename: "package.md"
    },
    "advocate-pro-2": {
      profileName: "Narrative advocate",
      personality: "Imported PRO II personality.",
      personalitySource: "tribunal_package",
      personalitySourceFilename: "package.md"
    },
    "advocate-con-1": {
      profileName: "Procedure advocate",
      personality: "Imported CON I personality.",
      personalitySource: "tribunal_package",
      personalitySourceFilename: "package.md"
    },
    "advocate-con-2": {
      profileName: "Practical advocate",
      personality: "Imported CON II personality.",
      personalitySource: "tribunal_package",
      personalitySourceFilename: "package.md"
    },
    "judge-1": {
      profileName: "Methodical judge",
      personality: "Imported Judge I personality.",
      personalitySource: "tribunal_package",
      personalitySourceFilename: "package.md"
    },
    "judge-2": {
      profileName: "Fairness judge",
      personality: "Imported Judge II personality.",
      personalitySource: "tribunal_package",
      personalitySourceFilename: "package.md"
    },
    "judge-3": {
      profileName: "Evidence judge",
      personality: "Imported Judge III personality.",
      personalitySource: "tribunal_package",
      personalitySourceFilename: "package.md"
    }
  },
  importSource: {
    type: "TRIBUNAL_PACKAGE_FILE",
    filename: "package.md"
  }
};

afterEach(() => {
  vi.restoreAllMocks();
});

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

    await user.clear(
      screen.getByLabelText(/PRO I personality/i, { selector: "textarea" })
    );

    expect(screen.getByText(/personality is required/i)).toBeVisible();
    expect(screen.getByRole("button", { name: "Continue to Judges" })).toBeDisabled();
    expect(
      screen.getByText(/complete all four advocate personalities before continuing/i)
    ).toBeVisible();

    expect(validateParticipantPersonality("")).toBe("Personality is required.");
    expect(validateParticipantPersonality("x".repeat(personalityLimit + 1))).toMatch(
      /4,000 characters or fewer/
    );

    fireEvent.change(
      screen.getByLabelText(/PRO I personality/i, { selector: "textarea" }),
      { target: { value: "x".repeat(personalityLimit + 1) } }
    );

    expect(screen.getByText(/4,000 characters or fewer/i)).toBeVisible();
  });

  it("blocks invalid judge progression", async () => {
    const user = userEvent.setup();
    renderWithAppProviders(<AppRoutes />, "/new/judges");

    await user.clear(
      screen.getByLabelText(/Judge II personality/i, { selector: "textarea" })
    );

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

  it("saves a valid normalized case without starting deliberation", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          case: {
            id: "11111111-1111-4111-8111-111111111111",
            defendant: "Alex Rowan",
            act: "Entered the restricted lab.",
            exactQuestion: "Did Alex knowingly violate the lab protocol?",
            sourceType: "MANUAL",
            sourceFilename: null,
            createdAt: "2026-08-25T10:00:00.000Z"
          }
        }),
        { status: 201 }
      )
    );

    renderWithAppProviders(<AppRoutes />);
    await user.type(screen.getByLabelText(/defendant/i), "Alex Rowan");
    await user.type(screen.getByLabelText(/^act/i), "Entered the restricted lab.");
    await user.type(
      screen.getByLabelText(/exact question/i),
      "Did Alex knowingly violate the lab protocol?"
    );
    await user.click(screen.getByRole("button", { name: /continue to advocates/i }));
    await user.click(screen.getByRole("link", { name: /continue to judges/i }));
    await user.click(screen.getByRole("link", { name: /review tribunal/i }));
    await user.click(screen.getByRole("button", { name: /save case/i }));

    expect(await screen.findByText(/case saved to past cases/i)).toBeVisible();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/cases",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("Alex Rowan")
      })
    );
    expect(
      screen.queryByText(/deliberation is running/i)
    ).not.toBeInTheDocument();
  });

  it("imports a Charge Sheet file without applying participant configuration", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          chargeSheet: {
            defendant: "Imported Alex",
            act: "Imported act text.",
            exactQuestion: "Imported exact question?"
          },
          filename: "charge.md"
        }),
        { status: 200 }
      )
    );

    renderWithAppProviders(<AppRoutes />);
    await user.upload(
      screen.getByLabelText("Charge Sheet import file"),
      new File(["ignored"], "charge.md", { type: "text/markdown" })
    );

    expect(await screen.findByDisplayValue("Imported Alex")).toBeVisible();
    expect(screen.getByDisplayValue("Imported act text.")).toBeVisible();
    expect(screen.getByDisplayValue("Imported exact question?")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Charge Sheet" })).toBeVisible();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/import/charge-sheet",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("imports a participant personality file only into the selected seat", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          personality: "Imported only for PRO I.",
          filename: "pro-one.md"
        }),
        { status: 200 }
      )
    );

    renderWithAppProviders(<AppRoutes />, "/new/advocates");
    await user.upload(
      screen.getByLabelText("PRO I personality import file"),
      new File(["ignored"], "pro-one.md", { type: "text/markdown" })
    );

    expect(await screen.findByDisplayValue("Imported only for PRO I."))
      .toBeVisible();
    expect(
      screen.getByLabelText(/PRO II personality/i, { selector: "textarea" })
    ).not.toHaveValue("Imported only for PRO I.");
    expect(screen.getByText(/individual personality file/i)).toBeVisible();
  });

  it("imports a complete Tribunal package atomically and reviews all seven participants", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ draft: packageDraft }), { status: 200 })
    );

    renderWithAppProviders(<AppRoutes />);
    await user.upload(
      screen.getByLabelText("Full Tribunal Package import file"),
      new File(["ignored"], "package.md", { type: "text/markdown" })
    );

    expect(
      await screen.findByRole("heading", { name: "Review Tribunal" })
    ).toBeVisible();
    expect(
      screen.getByText(
        "Imported Tribunal package — review all extracted fields before convening."
      )
    ).toBeVisible();
    expect(screen.getByText("Imported Alex")).toBeVisible();
    expect(
      screen.getByText(/^Source: Full Tribunal Package \(package\.md\)$/)
    ).toBeVisible();
    expect(screen.getByText(/Evidence advocate/)).toBeVisible();
    expect(screen.getByText(/Imported Judge III personality\./)).toBeVisible();
    // Package import preserves application-owned execution mode and model
    // assignment: the default Shared mode/model must still be in effect.
    expect(screen.getByText(/Shared Model —/)).toBeVisible();
    expect(screen.getByText(/Shared mock model:/)).toBeVisible();
    expect(
      screen.queryByText(/deliberation is running/i)
    ).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/import/tribunal-package",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("keeps existing setup state when a Tribunal package import fails", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "invalid_import",
          errors: ["Missing package section [JUDGE_3]."]
        }),
        { status: 400 }
      )
    );

    renderWithAppProviders(<AppRoutes />);
    await user.type(screen.getByLabelText(/defendant/i), "Manual Alex");
    await user.upload(
      screen.getByLabelText("Full Tribunal Package import file"),
      new File(["ignored"], "bad-package.md", { type: "text/markdown" })
    );

    expect(await screen.findByText(/Missing package section/)).toBeVisible();
    expect(screen.getByDisplayValue("Manual Alex")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Charge Sheet" })).toBeVisible();
  });
});
