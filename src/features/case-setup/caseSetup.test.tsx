import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAppProviders } from "../../test/renderWithAppProviders";
import { AppRoutes } from "../../app/App";
import {
  personalityLimit,
  validateParticipantPersonality
} from "./setupState";

const FAKE_USER_OPENROUTER_KEY = "sk-or-v1-test-fake-user-key-case-setup";

// Milestone 8 (user-funded BYOK): Convene is disabled until connected --
// interacts with the real Connect UI, matching smartImport.test.tsx's own
// connectOpenRouter helper (a direct sessionStorage write does not update
// the component's React state).
async function connectOpenRouter(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/openrouter api key/i), FAKE_USER_OPENROUTER_KEY);
  await user.click(screen.getByRole("button", { name: /^connect$/i }));
}

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

const FAKE_ELIGIBLE_MODEL = {
  id: "openai/gpt-5",
  canonicalModelId: "openai/gpt-5",
  name: "GPT-5",
  providerName: "OpenAI",
  contextLength: 200_000,
  promptPricePerMillion: "1.00",
  completionPricePerMillion: "2.00",
  isFree: false,
  priceTier: "BUDGET",
  conservativeFullTribunalEstimateUsd: "0.42",
  supportsStructuredOutput: true
};

// Milestone 8 (independent audit correction, Issue #17 blocker 1):
// ExecutionModeControl fetches the real GET /api/models catalog on
// mount (zero-cost metadata), and re-fetches on every remount as the
// user navigates between setup pages that render it (Advocates, Judges,
// Review) -- interleaving with each test's own expected calls in a way
// plain `vi.spyOn(...).mockResolvedValueOnce(...)` chaining cannot
// handle (that queue is strictly FIFO by CALL ORDER, not by URL, so an
// incidental /api/models call can silently consume a response a test
// queued for its own POST /api/runs or /api/cases call). Every test in
// this file therefore queues its own expected responses via
// queueFetchResponse/queueFetchError below instead of calling
// `mockResolvedValueOnce` directly -- GET /api/models is answered
// out-of-band by this same mock, by URL, and never touches that queue.
let fetchResponseQueue: Array<Response | Promise<Response> | Error> = [];

function queueFetchResponse(response: Response | Promise<Response>) {
  fetchResponseQueue.push(response);
}

function queueFetchError(error: Error) {
  fetchResponseQueue.push(error);
}

// Calls other than the incidental /api/models ones -- what
// `fetchSpy.mock.calls[N]`-style assertions actually mean in this file.
function nonModelsFetchCalls(): Array<[string, RequestInit | undefined]> {
  return (vi.mocked(globalThis.fetch).mock.calls as Array<[string, RequestInit | undefined]>).filter(
    ([url]) => url !== "/api/models"
  );
}

beforeEach(() => {
  fetchResponseQueue = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/models") {
      return new Response(JSON.stringify({ models: [FAKE_ELIGIBLE_MODEL] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    const next = fetchResponseQueue.shift();

    if (next === undefined) {
      throw new Error(`Unhandled fetch in test: ${url}`);
    }

    if (next instanceof Error) {
      throw next;
    }

    return next;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
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
    // Direct navigation to a later route must never fabricate completion
    // history: Advocates/Judges have default-valid data but were never
    // actually reached via a genuine Continue transition, so neither shows
    // Complete even though this lands directly on Review.
    expect(within(setupProgress).queryAllByText("Complete")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Convene Tribunal" })).toBeDisabled();
    // An invalid Charge Sheet blocks Save Case too — a case cannot be
    // persisted without its three required fields, regardless of
    // participant configuration.
    expect(screen.getByRole("button", { name: /save case/i })).toBeDisabled();
    expect(
      screen.getByText(/tribunal configuration cannot be frozen yet/i)
    ).toBeVisible();
    expect(screen.getByText(/charge sheet fields must be complete/i)).toBeVisible();
  });

  describe("setup stepper completion semantics", () => {
    it("does not mark Advocates or Judges Complete on a fresh setup, even though their default data is already valid", () => {
      renderWithAppProviders(<AppRoutes />);

      const setupProgress = screen.getByLabelText("Case setup progress");

      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).not.toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Judges/i })
      ).not.toHaveTextContent("Complete");
      expect(within(setupProgress).queryAllByText("Complete")).toHaveLength(0);
    });

    it("marks a step Complete only once genuinely left via a validated Continue, never merely because it is current and valid", async () => {
      const user = userEvent.setup();
      renderWithAppProviders(<AppRoutes />);

      let setupProgress;

      await user.type(screen.getByLabelText(/defendant/i), "Alex Rowan");
      await user.type(screen.getByLabelText(/^act/i), "Entered the restricted lab.");
      await user.type(
        screen.getByLabelText(/exact question/i),
        "Did Alex knowingly violate the lab protocol?"
      );
      await user.click(screen.getByRole("button", { name: /continue to advocates/i }));

      setupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(setupProgress).getByRole("link", { name: /Charge Sheet/i })
      ).toHaveTextContent("Complete");
      // Advocates is now the current step; its default data is valid, but
      // it must not show Complete merely for being current and valid.
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).not.toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Judges/i })
      ).not.toHaveTextContent("Complete");

      await user.click(screen.getByRole("link", { name: /continue to judges/i }));

      setupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(setupProgress).getByRole("link", { name: /Charge Sheet/i })
      ).toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Judges/i })
      ).not.toHaveTextContent("Complete");

      await user.click(screen.getByRole("link", { name: /review tribunal/i }));

      setupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(setupProgress).getByRole("link", { name: /Charge Sheet/i })
      ).toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Judges/i })
      ).toHaveTextContent("Complete");
      // Review is the current step and never shows Complete itself.
      expect(
        within(setupProgress).getByRole("link", { name: /Review/i })
      ).not.toHaveTextContent("Complete");
    });

    it("preserves legitimately reached completion across back-navigation, but keeps it gated on current validity", async () => {
      const user = userEvent.setup();
      renderWithAppProviders(<AppRoutes />);
      // A long sequence of real userEvent typing/navigation across the
      // whole setup flow: reliably ~2-3s locally, but can tip past
      // vitest's 5000ms default under a loaded/shared CI runner (observed
      // in CI, not locally) -- an explicit, generous per-test timeout,
      // not a behavior change, per vitest's own suggested remedy.

      await user.type(screen.getByLabelText(/defendant/i), "Alex Rowan");
      await user.type(screen.getByLabelText(/^act/i), "Entered the restricted lab.");
      await user.type(
        screen.getByLabelText(/exact question/i),
        "Did Alex knowingly violate the lab protocol?"
      );
      await user.click(screen.getByRole("button", { name: /continue to advocates/i }));
      await user.click(screen.getByRole("link", { name: /continue to judges/i }));
      await user.click(screen.getByRole("link", { name: /review tribunal/i }));

      // Back-navigate all the way to Charge Sheet via the stepper itself.
      await user.click(
        within(screen.getByLabelText("Case setup progress")).getByRole("link", {
          name: /Charge Sheet/i
        })
      );

      let setupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Judges/i })
      ).toHaveTextContent("Complete");

      // Invalidate Advocates: navigate there and clear PRO I's personality.
      await user.click(
        within(screen.getByLabelText("Case setup progress")).getByRole("link", {
          name: /Advocates/i
        })
      );
      await user.clear(
        screen.getByLabelText(/PRO I personality/i, { selector: "textarea" })
      );

      // Navigate away so Advocates' own badge (suppressed while current) is
      // observable again.
      await user.click(
        within(screen.getByLabelText("Case setup progress")).getByRole("link", {
          name: /Charge Sheet/i
        })
      );

      setupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).not.toHaveTextContent("Complete");
      // Judges was untouched and remains Complete -- invalidation does not
      // cascade to unrelated, already-reached steps.
      expect(
        within(setupProgress).getByRole("link", { name: /Judges/i })
      ).toHaveTextContent("Complete");

      // Restore validity: Advocates was already reached, so Complete
      // returns without needing to "Continue" through it again.
      await user.click(
        within(screen.getByLabelText("Case setup progress")).getByRole("link", {
          name: /Advocates/i
        })
      );
      await user.type(
        screen.getByLabelText(/PRO I personality/i, { selector: "textarea" }),
        "Restored PRO I personality."
      );
      await user.click(
        within(screen.getByLabelText("Case setup progress")).getByRole("link", {
          name: /Charge Sheet/i
        })
      );

      setupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).toHaveTextContent("Complete");
    }, 15000);

    it("does not fabricate completion history merely from directly visiting a later route", () => {
      renderWithAppProviders(<AppRoutes />, "/new/judges");

      const setupProgress = screen.getByLabelText("Case setup progress");

      expect(
        within(setupProgress).getByRole("link", { name: /Charge Sheet/i })
      ).not.toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).not.toHaveTextContent("Complete");
      expect(within(setupProgress).queryAllByText("Complete")).toHaveLength(0);
    });

    it("does not mark Advocates Complete when the user reaches it and immediately goes Back without confirming it", async () => {
      // furthestReachedStepIndex records the furthest step REACHED, not
      // the furthest step COMPLETED -- Continue to Advocates sets it to
      // ADVOCATES the instant Advocates becomes active, before its own
      // data has ever been confirmed by leaving it forward.
      const user = userEvent.setup();
      renderWithAppProviders(<AppRoutes />);

      await user.type(screen.getByLabelText(/defendant/i), "Alex Rowan");
      await user.type(screen.getByLabelText(/^act/i), "Entered the restricted lab.");
      await user.type(
        screen.getByLabelText(/exact question/i),
        "Did Alex knowingly violate the lab protocol?"
      );
      await user.click(screen.getByRole("button", { name: /continue to advocates/i }));
      await user.click(screen.getByRole("link", { name: /^back$/i }));

      const setupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(setupProgress).getByRole("link", { name: /Charge Sheet/i })
      ).not.toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).not.toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Judges/i })
      ).not.toHaveTextContent("Complete");
    });

    it("does not mark Judges Complete when the user reaches it and immediately goes Back without confirming it", async () => {
      const user = userEvent.setup();
      renderWithAppProviders(<AppRoutes />);

      await user.type(screen.getByLabelText(/defendant/i), "Alex Rowan");
      await user.type(screen.getByLabelText(/^act/i), "Entered the restricted lab.");
      await user.type(
        screen.getByLabelText(/exact question/i),
        "Did Alex knowingly violate the lab protocol?"
      );
      await user.click(screen.getByRole("button", { name: /continue to advocates/i }));
      await user.click(screen.getByRole("link", { name: /continue to judges/i }));
      await user.click(screen.getByRole("link", { name: /^back$/i }));

      const setupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(setupProgress).getByRole("link", { name: /Charge Sheet/i })
      ).toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Advocates/i })
      ).not.toHaveTextContent("Complete");
      expect(
        within(setupProgress).getByRole("link", { name: /Judges/i })
      ).not.toHaveTextContent("Complete");

      // Continuing forward normally from here still reaches Review with
      // the first three steps Complete -- the earlier premature Back does
      // not permanently corrupt legitimate forward progression.
      await user.click(screen.getByRole("link", { name: /continue to judges/i }));
      await user.click(screen.getByRole("link", { name: /review tribunal/i }));

      const finalSetupProgress = screen.getByLabelText("Case setup progress");
      expect(
        within(finalSetupProgress).getByRole("link", { name: /Charge Sheet/i })
      ).toHaveTextContent("Complete");
      expect(
        within(finalSetupProgress).getByRole("link", { name: /Advocates/i })
      ).toHaveTextContent("Complete");
      expect(
        within(finalSetupProgress).getByRole("link", { name: /Judges/i })
      ).toHaveTextContent("Complete");
      expect(
        within(finalSetupProgress).getByRole("link", { name: /Review/i })
      ).not.toHaveTextContent("Complete");
    });
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

  it("shows the real Shared model selector and a disabled Separate Models option (M9 scope, independent audit correction)", async () => {
    renderWithAppProviders(<AppRoutes />, "/new/advocates");

    expect(await screen.findByLabelText("Shared model")).toBeVisible();
    expect(screen.queryByLabelText("PRO I mock model")).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Separate Models" })).toBeDisabled();
    expect(screen.getByText(/available in a future milestone/i)).toBeVisible();
  });

  // Final micro-correction #3 (independent audit): validity means real
  // CATALOG MEMBERSHIP, not merely a non-empty id. Auto-select on
  // Advocates picks a real model from a first catalog fetch; by the time
  // Review re-fetches on its own mount, the catalog has changed to no
  // longer contain ANY model (the real-world case a stale/removed model
  // id represents) -- Convene must stay disabled and no POST /api/runs
  // may ever be attempted, even though sharedModelId is still a
  // non-empty string left over from the earlier, now-stale selection.
  it("a sharedModelId no longer present in a freshly re-fetched catalog keeps Convene disabled and makes zero POST /api/runs calls", async () => {
    const user = userEvent.setup();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/models") {
        return new Response(JSON.stringify({ models: [FAKE_ELIGIBLE_MODEL] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      throw new Error(`Unhandled fetch in test: ${url}`);
    });

    renderWithAppProviders(<AppRoutes />);
    await user.type(screen.getByLabelText(/defendant/i), "Alex Rowan");
    await user.type(screen.getByLabelText(/^act/i), "Entered the restricted lab.");
    await user.type(
      screen.getByLabelText(/exact question/i),
      "Did Alex knowingly violate the lab protocol?"
    );
    await user.click(screen.getByRole("button", { name: /continue to advocates/i }));

    // The real (fake, but non-empty) catalog auto-selected a real model.
    expect(await screen.findByText("GPT-5")).toBeInTheDocument();

    // By the time Review mounts and re-fetches on its own, the catalog
    // has changed to return zero eligible models -- simulating the
    // previously-selected model falling out of eligibility.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url === "/api/models") {
        return new Response(JSON.stringify({ models: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }

      throw new Error(`Unhandled fetch in test: ${url}`);
    });

    await user.click(screen.getByRole("link", { name: /continue to judges/i }));
    await user.click(screen.getByRole("link", { name: /review tribunal/i }));
    await connectOpenRouter(user);

    expect(
      await screen.findByText(/select a shared model above/i)
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Convene Tribunal" })).toBeDisabled();

    // Convene is unreachable (disabled), so this is a defensive proof,
    // not merely inferred from the disabled attribute.
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some(([url]) => url === "/api/runs")
    ).toBe(false);
  });

  it("shows review gate geometry, budget policy, and privacy warning", async () => {
    renderWithAppProviders(<AppRoutes />, "/new/review");

    expect(screen.getByText(/expected logical calls/i)).toHaveTextContent("7");
    expect(screen.getByText(/hard policy/i)).toHaveTextContent("$5.00");
    expect(await screen.findByText(/conservative full-Tribunal estimate/i)).toBeVisible();
    expect(screen.getByText(/do not submit sensitive/i)).toBeVisible();
    expect(
      within(screen.getByTestId("economics-section")).getByText(/mock fixture data/i)
    ).toBeVisible();
  });

  it("saves a valid normalized case without starting deliberation", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
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

  it("allows saving a case with a valid Charge Sheet even when participants are invalid, but blocks Convene", async () => {
    // M5 persists only the canonical case (Defendant/Act/Exact Question +
    // source metadata). Participant configuration is not persisted/frozen
    // until M6, so Save Case must not require seven valid participants.
    const user = userEvent.setup();
    queueFetchResponse(
      new Response(
        JSON.stringify({
          case: {
            id: "22222222-2222-4222-8222-222222222222",
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

    // Make PRO I invalid. "Continue to Judges" is now disabled, so jump
    // straight to Review via the always-navigable stepper, mirroring free
    // back/forward navigation between setup steps.
    await user.clear(
      screen.getByLabelText(/PRO I personality/i, { selector: "textarea" })
    );
    expect(
      screen.getByRole("button", { name: "Continue to Judges" })
    ).toBeDisabled();

    const setupProgress = screen.getByLabelText("Case setup progress");
    await user.click(within(setupProgress).getByRole("link", { name: /Review/i }));

    expect(await screen.findByRole("heading", { name: "Review Tribunal" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Convene Tribunal" })).toBeDisabled();
    expect(
      screen.getByText(/all four advocate personalities must be valid/i)
    ).toBeVisible();

    const saveButton = screen.getByRole("button", { name: /save case/i });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    expect(await screen.findByText(/case saved to past cases/i)).toBeVisible();

    const [, requestInit] = nonModelsFetchCalls()[0];
    const requestBody = JSON.parse(requestInit!.body as string);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/cases",
      expect.objectContaining({ method: "POST" })
    );
    // Only normalized case/source metadata is posted — never participant
    // configuration.
    expect(requestBody).toEqual({
      defendant: "Alex Rowan",
      act: "Entered the restricted lab.",
      exactQuestion: "Did Alex knowingly violate the lab protocol?",
      sourceType: "MANUAL"
    });
    expect(
      screen.queryByText(/deliberation is running/i)
    ).not.toBeInTheDocument();
  });

  it("imports a Charge Sheet file without applying participant configuration", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
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
    queueFetchResponse(
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
    queueFetchResponse(
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
    expect(await screen.findByText(/Shared model:/)).toBeVisible();
    expect(
      screen.queryByText(/deliberation is running/i)
    ).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/import/tribunal-package",
      expect.objectContaining({ method: "POST" })
    );
    // A successful package import validly populates the Charge Sheet and
    // all seven participants in one atomic step -- the same forward
    // progression as walking Continue -> Continue -> Review Tribunal by
    // hand, so it marks the same three prior steps Complete on arrival.
    const setupProgress = screen.getByLabelText("Case setup progress");
    expect(
      within(setupProgress).getByRole("link", { name: /Charge Sheet/i })
    ).toHaveTextContent("Complete");
    expect(
      within(setupProgress).getByRole("link", { name: /Advocates/i })
    ).toHaveTextContent("Complete");
    expect(
      within(setupProgress).getByRole("link", { name: /Judges/i })
    ).toHaveTextContent("Complete");
    expect(
      within(setupProgress).getByRole("link", { name: /Review/i })
    ).not.toHaveTextContent("Complete");
  });

  it("freezes a valid Tribunal configuration on Convene and remains on Review", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "33333333-3333-4333-8333-333333333333",
            caseId: "44444444-4444-4444-8444-444444444444",
            executionMode: "shared",
            status: "READY",
            createdAt: "2026-08-25T10:00:00.000Z",
            participants: []
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
    await connectOpenRouter(user);
    await user.click(screen.getByRole("button", { name: "Convene Tribunal" }));

    expect(
      await screen.findByText(/tribunal configuration frozen/i)
    ).toBeVisible();
    expect(
      screen.getByText(/33333333-3333-4333-8333-333333333333/)
    ).toBeVisible();
    expect(
      screen.queryByText(/deliberation is running/i)
    ).not.toBeInTheDocument();

    const [url, requestInit] = nonModelsFetchCalls()[0];
    const requestBody = JSON.parse(requestInit!.body as string);

    expect(url).toBe("/api/runs");
    expect(requestInit!.method).toBe("POST");
    expect(requestBody.case).toEqual({
      kind: "new",
      case: {
        defendant: "Alex Rowan",
        act: "Entered the restricted lab.",
        exactQuestion: "Did Alex knowingly violate the lab protocol?",
        sourceType: "MANUAL"
      }
    });
    expect(requestBody.executionMode).toBe("shared");
    expect(requestBody.participants).toHaveLength(7);
    expect(typeof requestBody.clientRequestId).toBe("string");
    expect(requestBody.clientRequestId.length).toBeGreaterThan(0);
  });

  it("disables Convene while pending and after success, without re-arming", async () => {
    const user = userEvent.setup();
    let resolveFetch: (response: Response) => void = () => {};
    queueFetchResponse(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
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
    await connectOpenRouter(user);

    const conveneButton = screen.getByRole("button", { name: "Convene Tribunal" });
    await user.click(conveneButton);

    expect(screen.getByRole("button", { name: "Convening..." })).toBeDisabled();

    resolveFetch(
      new Response(
        JSON.stringify({
          run: {
            id: "55555555-5555-4555-8555-555555555555",
            caseId: "66666666-6666-4666-8666-666666666666",
            executionMode: "shared",
            status: "READY",
            createdAt: "2026-08-25T10:00:00.000Z",
            participants: []
          }
        }),
        { status: 201 }
      )
    );

    expect(
      await screen.findByRole("button", { name: "Configuration frozen" })
    ).toBeDisabled();
    expect(nonModelsFetchCalls()).toHaveLength(1);
  });

  it("reuses the same client_request_id when retrying an unchanged submission after an ambiguous failure", async () => {
    const user = userEvent.setup();
    // An ambiguous/network failure -- the client cannot tell whether the
    // server actually received and processed the request.
    queueFetchError(new TypeError("Failed to fetch"));
    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            caseId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            executionMode: "shared",
            status: "READY",
            createdAt: "2026-08-25T10:00:00.000Z",
            participants: []
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
    await connectOpenRouter(user);

    await user.click(screen.getByRole("button", { name: "Convene Tribunal" }));
    expect(
      await screen.findByText(/tribunal configuration could not be frozen/i)
    ).toBeVisible();

    // Retry with no edits at all -- the same semantic submission.
    await user.click(screen.getByRole("button", { name: "Convene Tribunal" }));
    expect(await screen.findByText(/tribunal configuration frozen/i)).toBeVisible();

    const calls = nonModelsFetchCalls();

    expect(calls).toHaveLength(2);
    const [, firstInit] = calls[0];
    const [, secondInit] = calls[1];
    const firstBody = JSON.parse(firstInit!.body as string);
    const secondBody = JSON.parse(secondInit!.body as string);

    expect(typeof firstBody.clientRequestId).toBe("string");
    expect(secondBody.clientRequestId).toBe(firstBody.clientRequestId);
  });

  it("uses a fresh client_request_id after a failed submission is materially edited", async () => {
    const user = userEvent.setup();
    queueFetchError(new TypeError("Failed to fetch"));
    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
            caseId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
            executionMode: "shared",
            status: "READY",
            createdAt: "2026-08-25T10:00:00.000Z",
            participants: []
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
    await connectOpenRouter(user);

    await user.click(screen.getByRole("button", { name: "Convene Tribunal" }));
    expect(
      await screen.findByText(/tribunal configuration could not be frozen/i)
    ).toBeVisible();

    // Material edit before retrying: the Charge Sheet itself changes.
    await user.click(
      within(screen.getByLabelText("Case setup progress")).getByRole("link", {
        name: /Charge Sheet/i
      })
    );
    await user.type(screen.getByLabelText(/defendant/i), " Jr.");
    await user.click(
      within(screen.getByLabelText("Case setup progress")).getByRole("link", {
        name: /Review/i
      })
    );

    await user.click(
      await screen.findByRole("button", { name: "Convene Tribunal" })
    );
    expect(await screen.findByText(/tribunal configuration frozen/i)).toBeVisible();

    const calls = nonModelsFetchCalls();

    expect(calls).toHaveLength(2);
    const [, firstInit] = calls[0];
    const [, secondInit] = calls[1];
    const firstBody = JSON.parse(firstInit!.body as string);
    const secondBody = JSON.parse(secondInit!.body as string);

    expect(secondBody.clientRequestId).not.toBe(firstBody.clientRequestId);
  });

  it("reuses the saved case identity on Convene after Save Case", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
      new Response(
        JSON.stringify({
          case: {
            id: "77777777-7777-4777-8777-777777777777",
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
    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "88888888-8888-4888-8888-888888888888",
            caseId: "77777777-7777-4777-8777-777777777777",
            executionMode: "shared",
            status: "READY",
            createdAt: "2026-08-25T10:00:00.000Z",
            participants: []
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
    await connectOpenRouter(user);
    await user.click(screen.getByRole("button", { name: /save case/i }));

    expect(await screen.findByText(/case saved to past cases/i)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Convene Tribunal" }));

    expect(await screen.findByText(/tribunal configuration frozen/i)).toBeVisible();

    const [, requestInit] = nonModelsFetchCalls()[1];
    const requestBody = JSON.parse(requestInit!.body as string);

    expect(requestBody.case).toEqual({
      kind: "existing",
      caseId: "77777777-7777-4777-8777-777777777777"
    });
  });

  it("sends a new case on Convene when the saved case was edited afterward", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
      new Response(
        JSON.stringify({
          case: {
            id: "99999999-9999-4999-8999-999999999999",
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
    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            caseId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            executionMode: "shared",
            status: "READY",
            createdAt: "2026-08-25T10:00:00.000Z",
            participants: []
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
    await connectOpenRouter(user);
    await user.click(screen.getByRole("button", { name: /save case/i }));

    expect(await screen.findByText(/case saved to past cases/i)).toBeVisible();

    await user.click(
      within(screen.getByLabelText("Case setup progress")).getByRole("link", {
        name: /Charge Sheet/i
      })
    );
    await user.type(screen.getByLabelText(/defendant/i), " Jr.");
    await user.click(
      within(screen.getByLabelText("Case setup progress")).getByRole("link", {
        name: /Review/i
      })
    );

    expect(
      await screen.findByRole("button", { name: "Convene Tribunal" })
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Convene Tribunal" }));

    expect(await screen.findByText(/tribunal configuration frozen/i)).toBeVisible();

    const [, requestInit] = nonModelsFetchCalls()[1];
    const requestBody = JSON.parse(requestInit!.body as string);

    expect(requestBody.case).toEqual({
      kind: "new",
      case: {
        defendant: "Alex Rowan Jr.",
        act: "Entered the restricted lab.",
        exactQuestion: "Did Alex knowingly violate the lab protocol?",
        sourceType: "MANUAL"
      }
    });
  });

  it("surfaces a server idempotency conflict honestly without navigating", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
      new Response(
        JSON.stringify({ error: "idempotency_conflict", errors: [] }),
        { status: 409 }
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
    await connectOpenRouter(user);
    await user.click(screen.getByRole("button", { name: "Convene Tribunal" }));

    expect(
      await screen.findByText(/could not be frozen because a prior request/i)
    ).toBeVisible();
    expect(
      screen.queryByText(/tribunal configuration frozen/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/deliberation is running/i)
    ).not.toBeInTheDocument();
    // The Convene button re-arms after a failed attempt so the user can
    // retry (unlike after a success, which is final).
    expect(screen.getByRole("button", { name: "Convene Tribunal" })).toBeEnabled();
  });

  it("surfaces server-side Convene validation errors honestly", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
      new Response(
        JSON.stringify({
          error: "invalid_run",
          errors: ["participants: exactly seven participants are required."]
        }),
        { status: 400 }
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
    await connectOpenRouter(user);
    await user.click(screen.getByRole("button", { name: "Convene Tribunal" }));

    expect(
      await screen.findByText(/exactly seven participants are required/i)
    ).toBeVisible();
    expect(
      screen.queryByText(/tribunal configuration frozen/i)
    ).not.toBeInTheDocument();
  });

  it("keeps existing setup state when a Tribunal package import fails", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
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
    // An invalid package import must not advance completion state.
    expect(
      within(screen.getByLabelText("Case setup progress")).queryAllByText(
        "Complete"
      )
    ).toHaveLength(0);
  });
});
