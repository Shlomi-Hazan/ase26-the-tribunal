// Milestone 8 -- RunPage result-integrity regression tests (independent
// audit correction, Issue #17 blocker 6). Zero real network calls --
// fetch is mocked directly.

import { screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../app/App";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
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
