// Milestone 8 -- RunPage result-integrity regression tests (independent
// audit correction, Issue #17 blocker 6). Zero real network calls --
// fetch is mocked directly.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../app/App";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
import { theme } from "../theme/theme";
import type { StoredRun } from "../services/runApi";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.restoreAllMocks();
});

function baseRun(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    id: RUN_ID,
    caseId: "22222222-2222-4222-8222-222222222222",
    executionMode: "shared",
    status: "COMPLETED",
    createdAt: "2026-08-29T00:00:00.000Z",
    startedAt: "2026-08-29T00:00:01.000Z",
    completedAt: "2026-08-29T00:00:05.000Z",
    majorityVerdict: "GUILTY",
    failureCode: null,
    failureMessage: null,
    totalCostUsd: "0.05",
    advocateCostUsd: "0.03",
    judgeCostUsd: "0.02",
    participants: [
      participant("advocate-pro-1", "ADVOCATE", "PRO", { speech: "PRO I speech." }),
      participant("advocate-pro-2", "ADVOCATE", "PRO", { speech: "PRO II speech." }),
      participant("advocate-con-1", "ADVOCATE", "CON", { speech: "CON I speech." }),
      participant("advocate-con-2", "ADVOCATE", "CON", { speech: "CON II speech." }),
      participant("judge-1", "JUDGE", null, { verdict: "GUILTY", reasoning: "Judge I reasoning." }),
      participant("judge-2", "JUDGE", null, { verdict: "GUILTY", reasoning: "Judge II reasoning." }),
      participant("judge-3", "JUDGE", null, { verdict: "NOT_GUILTY", reasoning: "Judge III reasoning." })
    ],
    ...overrides
  };
}

function participant(
  participantId: string,
  role: "ADVOCATE" | "JUDGE",
  side: "PRO" | "CON" | null,
  overrides: { speech?: string; verdict?: "GUILTY" | "NOT_GUILTY" | null; reasoning?: string | null } = {}
): StoredRun["participants"][number] {
  return {
    participantId: participantId as StoredRun["participants"][number]["participantId"],
    role,
    side,
    profileName: null,
    personality: "A measured, professional demeanor.",
    personalitySource: "manual",
    personalitySourceFilename: null,
    modelId: "openai/gpt-5",
    promptVersion: role === "ADVOCATE" ? "advocate-v1" : "judge-v1",
    attemptStatus: "SUCCESS",
    speech: overrides.speech ?? null,
    verdict: overrides.verdict ?? null,
    reasoning: overrides.reasoning ?? null
  };
}

function mockRunFetch(run: StoredRun) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ run }), { status: 200 })
  );
}

describe("RunPage result integrity (Milestone 8, independent audit correction)", () => {
  it("a complete, valid COMPLETED run renders the real majority/speeches/verdicts", async () => {
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByRole("heading", { name: "GUILTY" })).toBeVisible();
    // Accordion bodies are collapsed by default -- present in the DOM,
    // not necessarily visible without expanding.
    expect(screen.getByText("PRO I speech.")).toBeInTheDocument();
    expect(screen.getByText("Judge III reasoning.")).toBeInTheDocument();
  });

  it("a COMPLETED run missing a judge verdict never fabricates NOT_GUILTY -- shows a result-integrity error instead", async () => {
    const run = baseRun();
    // Corrupt judge-3's verdict -- the exact fabrication risk this
    // correction targets (previously `participant?.verdict ?? "NOT_GUILTY"`).
    run.participants = run.participants.map((entry) =>
      entry.participantId === "judge-3" ? { ...entry, verdict: null, reasoning: null } : entry
    );
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/result cannot be safely displayed/i)).toBeVisible();
    expect(screen.queryByText("NOT_GUILTY")).not.toBeInTheDocument();
    expect(screen.queryByText("GUILTY")).not.toBeInTheDocument();
  });

  it("a COMPLETED run missing an advocate speech never renders an empty speech -- shows a result-integrity error instead", async () => {
    const run = baseRun();
    run.participants = run.participants.map((entry) =>
      entry.participantId === "advocate-con-2" ? { ...entry, speech: null } : entry
    );
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/result cannot be safely displayed/i)).toBeVisible();
  });

  it("a COMPLETED run with a null majority verdict never renders anything as a verdict", async () => {
    const run = baseRun({ majorityVerdict: null });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await waitFor(() => {
      expect(screen.getByText(/result cannot be safely displayed/i)).toBeVisible();
    });
  });
});

// Post-M9 Result UX follow-up (originally recorded under the M14 UI
// Polish & Accessibility note, pulled forward): explicit expand
// affordances on the Judge/Advocate Accordions, and semantic
// GUILTY/NOT_GUILTY verdict coloring. Result-only UX -- no execution,
// economics, or database behavior is touched.
describe("RunPage Result UX affordances (post-M9 follow-up)", () => {
  function notGuiltyRun(): StoredRun {
    return baseRun({
      majorityVerdict: "NOT_GUILTY",
      participants: [
        participant("advocate-pro-1", "ADVOCATE", "PRO", { speech: "PRO I speech." }),
        participant("advocate-pro-2", "ADVOCATE", "PRO", { speech: "PRO II speech." }),
        participant("advocate-con-1", "ADVOCATE", "CON", { speech: "CON I speech." }),
        participant("advocate-con-2", "ADVOCATE", "CON", { speech: "CON II speech." }),
        participant("judge-1", "JUDGE", null, { verdict: "NOT_GUILTY", reasoning: "Judge I reasoning." }),
        participant("judge-2", "JUDGE", null, { verdict: "NOT_GUILTY", reasoning: "Judge II reasoning." }),
        participant("judge-3", "JUDGE", null, { verdict: "GUILTY", reasoning: "Judge III reasoning." })
      ]
    });
  }

  it("A: a NOT_GUILTY run still renders the correct overall majority text", async () => {
    mockRunFetch(notGuiltyRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByRole("heading", { name: "NOT_GUILTY" })).toBeVisible();
  });

  it("B: a GUILTY overall verdict receives the theme's error semantics", async () => {
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    const heading = await screen.findByRole("heading", { name: "GUILTY" });

    expect(getComputedStyle(heading).color).toBe(hexToRgb(theme.palette.error.main));
  });

  it("C: a NOT_GUILTY overall verdict receives the theme's success semantics", async () => {
    mockRunFetch(notGuiltyRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    const heading = await screen.findByRole("heading", { name: "NOT_GUILTY" });

    expect(getComputedStyle(heading).color).toBe(hexToRgb(theme.palette.success.main));
  });

  it("E: every Judge Accordion visibly exposes an expand affordance", async () => {
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    expect(screen.getByRole("button", { expanded: false, name: /^Judge I\b/ })).toBeVisible();
    expect(screen.getAllByText("View reasoning")).toHaveLength(3);
  });

  it("F: every Advocate Accordion visibly exposes an expand affordance", async () => {
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    expect(screen.getByRole("button", { expanded: false, name: /^PRO I\b/ })).toBeVisible();
    expect(screen.getAllByText("View argument")).toHaveLength(4);
  });

  it("G: activating a Judge Accordion (click) reveals the persisted reasoning", async () => {
    const user = userEvent.setup();
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const reasoning = screen.getByText("Judge I reasoning.");

    expect(reasoning).not.toBeVisible();

    await user.click(screen.getByRole("button", { expanded: false, name: /^Judge I\b/ }));

    expect(screen.getByRole("button", { expanded: true, name: /^Judge I\b/ })).toBeInTheDocument();
    expect(reasoning).toBeVisible();
  });

  it("G: activating a Judge Accordion (keyboard) reveals the persisted reasoning", async () => {
    const user = userEvent.setup();
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const judgeButton = screen.getByRole("button", { expanded: false, name: /^Judge I\b/ });
    judgeButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { expanded: true, name: /^Judge I\b/ })).toBeInTheDocument();
    expect(screen.getByText("Judge I reasoning.")).toBeVisible();
  });

  it("H: activating an Advocate Accordion (click) reveals the persisted speech", async () => {
    const user = userEvent.setup();
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const speech = screen.getByText("PRO I speech.");

    expect(speech).not.toBeVisible();

    await user.click(screen.getByRole("button", { expanded: false, name: /^PRO I\b/ }));

    expect(screen.getByRole("button", { expanded: true, name: /^PRO I\b/ })).toBeInTheDocument();
    expect(speech).toBeVisible();
  });

  it("I: collapsed reasoning/speech content is present in the DOM but never presented as already visible", async () => {
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const reasoning = screen.getByText("Judge I reasoning.");
    const speech = screen.getByText("PRO I speech.");

    expect(reasoning).toBeInTheDocument();
    expect(reasoning).not.toBeVisible();
    expect(speech).toBeInTheDocument();
    expect(speech).not.toBeVisible();
  });

  it("J: a FAILED run is never styled as a verdict", async () => {
    const run = baseRun({
      status: "FAILED",
      majorityVerdict: null,
      failureCode: "ADVOCATE_TERMINAL_FAILURE",
      failureMessage: "Advocate advocate-pro-1 did not produce a valid speech after the permitted retry."
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/The Tribunal could not complete/i)).toBeVisible();
    expect(screen.queryByText("GUILTY")).not.toBeInTheDocument();
    expect(screen.queryByText("NOT_GUILTY")).not.toBeInTheDocument();
  });

  it("J: a BLOCKED_BUDGET run is never styled as a verdict", async () => {
    const run = baseRun({
      status: "BLOCKED_BUDGET",
      majorityVerdict: null,
      failureMessage: "Conservative preflight exceeded the $5.00 policy limit."
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/this run cannot be executed/i)).toBeVisible();
    expect(screen.queryByText("GUILTY")).not.toBeInTheDocument();
    expect(screen.queryByText("NOT_GUILTY")).not.toBeInTheDocument();
  });
});

function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);

  return `rgb(${r}, ${g}, ${b})`;
}
