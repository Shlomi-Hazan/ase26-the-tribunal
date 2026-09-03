// Milestone 8 -- RunPage result-integrity regression tests (independent
// audit correction, Issue #17 blocker 6). Zero real network calls --
// fetch is mocked directly.

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../app/App";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
import { theme } from "../theme/theme";
import type { AttemptAudit, StoredRun } from "../services/runApi";

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
    // Milestone 10 (Issue #23) -- a realistic, self-consistent default:
    // 7 logical calls / 7 provider attempts (no retry), matching
    // ATTEMPT_PARTICIPANT_IDS below, real-shaped totals, no admission/
    // protocol by default (individual tests override where needed).
    totalInputTokens: 1234,
    totalOutputTokens: 567,
    totalTokens: 1801,
    logicalCallCount: 7,
    providerAttemptCount: 7,
    wallClockMs: 4200,
    partialSpend: { knownCostUsd: "0.05", hasUnknownCost: false },
    admission: null,
    attempts: ATTEMPT_PARTICIPANT_IDS.map((id) => attemptAudit(id)),
    protocol: null,
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

const ATTEMPT_PARTICIPANT_IDS = [
  "advocate-pro-1",
  "advocate-pro-2",
  "advocate-con-1",
  "advocate-con-2",
  "judge-1",
  "judge-2",
  "judge-3"
] as const;

function attemptAudit(participantId: string, overrides: Partial<AttemptAudit> = {}): AttemptAudit {
  const role = participantId.startsWith("advocate") ? "ADVOCATE" : "JUDGE";

  return {
    participantId: participantId as AttemptAudit["participantId"],
    role,
    side: participantId.includes("-pro-") ? "PRO" : participantId.includes("-con-") ? "CON" : null,
    attemptNumber: 1,
    status: "SUCCESS",
    configuredModelId: "openai/gpt-5",
    canonicalModelId: "openai/gpt-5-2026-01-01",
    providerEndpointTag: "azure/swedencentral",
    promptVersion: role === "ADVOCATE" ? "advocate-v1" : "judge-v1",
    conservativeMaxCostUsd: "0.001",
    inputTokens: 400,
    outputTokens: 500,
    totalTokens: 900,
    inputPricePerMillion: "0.055",
    outputPricePerMillion: "0.44",
    requestPriceUsd: "0",
    pricingObservedAt: "2026-08-29T00:00:00.000Z",
    actualCostUsd: "0.0002",
    derivedCostUsd: "0.0002",
    latencyMs: 600,
    providerRequestId: `gen-${participantId}`,
    errorCategory: null,
    errorMessage: null,
    startedAt: "2026-08-29T00:00:01.000Z",
    completedAt: "2026-08-29T00:00:02.000Z",
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

// ---------------------------------------------------------------------
// Milestone 10 (Issue #23) -- Economics/Audit, Admission/Budget Safety,
// and Protocol Result UX. Reuses baseRun()'s realistic 7-attempt default
// and PR #22's established expand-affordance test style (accessible
// queries, aria-expanded, click AND keyboard activation).
// ---------------------------------------------------------------------

function resolvedProtocolFixture(overrides: Partial<NonNullable<StoredRun["protocol"]>> = {}): NonNullable<
  StoredRun["protocol"]
> {
  return {
    schemaVersion: "tribunal-protocol-v1",
    runId: RUN_ID,
    caseId: "22222222-2222-4222-8222-222222222222",
    executionMode: "shared",
    majorityVerdict: "GUILTY",
    chargeSheet: {
      defendant: "Alex Rowan",
      act: "Sold a mislabeled cake.",
      exactQuestion: "Did Alex know the label was wrong?"
    },
    participants: [
      {
        participantId: "advocate-pro-1",
        role: "ADVOCATE",
        side: "PRO",
        profileName: null,
        personality: "A measured, professional demeanor.",
        // Deliberately distinct from attemptAudit()'s default
        // configuredModelId ("openai/gpt-5") so the two sections' model
        // text never collides in an accessible-query test.
        modelId: "openai/gpt-4.1-nano",
        promptVersion: "advocate-v1"
      }
    ],
    advocates: [{ participantId: "advocate-pro-1", side: "PRO", speech: "PRO I speech." }],
    judges: [{ participantId: "judge-1", verdict: "GUILTY", reasoning: "Judge I reasoning." }],
    economics: { logicalCallCount: 7, providerAttemptCount: 7, totalTokens: 1801, totalCostUsd: "0.05" },
    ...overrides
  };
}

describe("RunPage Economics/Audit summary (Milestone 10, Issue #23)", () => {
  it("renders logical-call count, provider-attempt count, tokens, cost, and wall clock from real response values", async () => {
    mockRunFetch(
      baseRun({
        logicalCallCount: 7,
        providerAttemptCount: 8,
        totalTokens: 18420,
        totalCostUsd: "0.17",
        wallClockMs: 7400
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    // The full compact line, matched as one string -- "$0.17" alone would
    // also match the separate "Total model cost: $0.17" card above it.
    expect(
      screen.getByText(/7 logical calls · 8 attempts · 18,420 tokens · \$0\.17 · 7\.4s/)
    ).toBeInTheDocument();
  });

  it("reflects a retry in the summary: 7 logical calls but 8 provider attempts, never 8 logical calls", async () => {
    mockRunFetch(baseRun({ logicalCallCount: 7, providerAttemptCount: 8 }));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    expect(screen.getByText(/7 logical calls · 8 attempts/)).toBeInTheDocument();
  });
});

describe("RunPage Economics/Audit details Accordion (Milestone 10, Issue #23)", () => {
  it("exposes a visible expand affordance, collapsed by default", async () => {
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    expect(screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ })).toBeVisible();
    expect(screen.getByText("View attempt-level detail")).toBeInTheDocument();
  });

  it("click reveals the attempt audit table", async () => {
    const user = userEvent.setup();
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    // While the Accordion is collapsed, MUI's Collapse wrapper hides the
    // subtree from the accessibility tree -- getByRole("table") cannot
    // see it yet even though it exists in the DOM (a plain-text query
    // still can, matching PR #22's own established pattern for judge/
    // advocate accordions).
    const firstRowLabel = screen.getByText("advocate-pro-1");

    expect(firstRowLabel).not.toBeVisible();

    await user.click(screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ }));

    expect(screen.getByRole("button", { expanded: true, name: /Economics \/ Audit details/ })).toBeInTheDocument();
    expect(firstRowLabel).toBeVisible();
    expect(screen.getByRole("table", { name: /Model call attempt audit/i })).toBeVisible();
  });

  it("keyboard activation reveals the attempt audit table", async () => {
    const user = userEvent.setup();
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const button = screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ });
    button.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { expanded: true, name: /Economics \/ Audit details/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Model call attempt audit/i })).toBeVisible();
  });

  it("labels an actual-cost row as Actual, a derived-only row as Derived, and a telemetry-missing row as Unavailable -- never $0", async () => {
    const run = baseRun({
      attempts: [
        attemptAudit("advocate-pro-1", { actualCostUsd: "0.0002", derivedCostUsd: "0.0002" }),
        attemptAudit("advocate-pro-2", { actualCostUsd: null, derivedCostUsd: "0.0003" }),
        attemptAudit("advocate-con-1", {
          actualCostUsd: null,
          derivedCostUsd: null,
          inputTokens: null,
          outputTokens: null,
          totalTokens: null
        }),
        attemptAudit("advocate-con-2", { actualCostUsd: "0.0004", derivedCostUsd: "0.0004" }),
        attemptAudit("judge-1", { actualCostUsd: "0.0005", derivedCostUsd: "0.0005" }),
        attemptAudit("judge-2", { actualCostUsd: "0.0006", derivedCostUsd: "0.0006" }),
        attemptAudit("judge-3", { actualCostUsd: "0.0007", derivedCostUsd: "0.0007" })
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });
    await userEvent.setup().click(screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ }));

    expect(screen.getByText("$0.0002").closest("td")?.textContent).toMatch(/Actual/);
    expect(screen.getByText("$0.0003").closest("td")?.textContent).toMatch(/Derived/);
    // The telemetry-missing row: Unavailable cost AND Unavailable tokens,
    // never a fabricated $0/0.
    const unavailableCells = screen.getAllByText("Unavailable");

    expect(unavailableCells.length).toBeGreaterThanOrEqual(4); // cost + input + output + total for that one row
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });
});

describe("RunPage per-attempt pricing-snapshot detail (Milestone 10, independent source audit Finding 3)", () => {
  const FIRST_DETAIL_ID = "attempt-detail-advocate-pro-1-1";

  async function expandEconomicsAndOpenFirstDetail(run: StoredRun) {
    const user = userEvent.setup();
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });
    await user.click(screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ }));

    const detailButton = screen.getByRole("button", {
      expanded: false,
      name: /View pricing detail for advocate-pro-1 attempt 1/
    });
    // Scoped to THIS row's own detail box (its id is unique per
    // participant+attempt) -- every row shares the same field labels/
    // values in the default fixture, so an unscoped screen.getByText
    // would be ambiguous across all seven rows' (collapsed) detail boxes.
    const detailBox = document.getElementById(FIRST_DETAIL_ID) as HTMLElement;

    return { user, detailButton, detailBox };
  }

  it("exposes a visible, collapsed-by-default detail affordance per attempt row", async () => {
    const { detailButton, detailBox } = await expandEconomicsAndOpenFirstDetail(baseRun());

    expect(detailButton).toBeVisible();
    expect(within(detailBox).getByText(/Canonical model:/)).not.toBeVisible();
  });

  it("click reveals the pricing-snapshot detail", async () => {
    const { user, detailButton, detailBox } = await expandEconomicsAndOpenFirstDetail(baseRun());

    await user.click(detailButton);

    expect(screen.getByRole("button", { expanded: true, name: /View pricing detail for advocate-pro-1/ })).toBeInTheDocument();
    expect(within(detailBox).getByText(/Canonical model:/)).toBeVisible();
  });

  it("keyboard activation reveals the pricing-snapshot detail", async () => {
    const { user, detailButton, detailBox } = await expandEconomicsAndOpenFirstDetail(baseRun());

    detailButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { expanded: true, name: /View pricing detail for advocate-pro-1/ })).toBeInTheDocument();
    expect(within(detailBox).getByText(/Canonical model:/)).toBeVisible();
  });

  it("renders canonical model, provider endpoint, prompt version, pricing snapshot, and conservative reserve", async () => {
    const run = baseRun({
      attempts: [
        attemptAudit("advocate-pro-1", {
          canonicalModelId: "openai/gpt-4.1-nano-2025-04-14",
          providerEndpointTag: "azure/swedencentral",
          promptVersion: "advocate-v1",
          inputPricePerMillion: "0.055",
          outputPricePerMillion: "0.44",
          requestPriceUsd: "0",
          pricingObservedAt: "2026-08-29T00:00:00.000Z",
          conservativeMaxCostUsd: "0.00098076"
        }),
        ...ATTEMPT_PARTICIPANT_IDS.slice(1).map((id) => attemptAudit(id))
      ]
    });
    const { user, detailButton, detailBox } = await expandEconomicsAndOpenFirstDetail(run);

    await user.click(detailButton);

    const detail = within(detailBox);

    expect(detail.getByText("Canonical model: openai/gpt-4.1-nano-2025-04-14")).toBeVisible();
    expect(detail.getByText("Provider endpoint: azure/swedencentral")).toBeVisible();
    expect(detail.getByText("Prompt version: advocate-v1")).toBeVisible();
    expect(detail.getByText("Historical pricing snapshot")).toBeVisible();
    expect(detail.getByText(/Prices recorded when this attempt was authorized/)).toBeVisible();
    expect(detail.getByText("Input price: $0.055 / 1M tokens")).toBeVisible();
    expect(detail.getByText("Output price: $0.44 / 1M tokens")).toBeVisible();
    expect(detail.getByText("Request fee: $0")).toBeVisible();
    expect(detail.getByText("Pricing observed at: 2026-08-29T00:00:00.000Z")).toBeVisible();
    expect(detail.getByText("Conservative participant reserve: $0.00098076")).toBeVisible();
  });

  it("keeps actual and derived cost separately labeled in the detail view, never merged into one ambiguous figure", async () => {
    const run = baseRun({
      attempts: [
        attemptAudit("advocate-pro-1", { actualCostUsd: "0.0002", derivedCostUsd: "0.00025" }),
        ...ATTEMPT_PARTICIPANT_IDS.slice(1).map((id) => attemptAudit(id))
      ]
    });
    const { user, detailButton, detailBox } = await expandEconomicsAndOpenFirstDetail(run);

    await user.click(detailButton);

    const detail = within(detailBox);

    expect(detail.getByText("Actual provider cost: $0.0002")).toBeVisible();
    expect(detail.getByText("Derived comparison: $0.00025")).toBeVisible();
  });

  it("renders Unavailable, never $0/blank, for a missing pricing field", async () => {
    const run = baseRun({
      attempts: [
        attemptAudit("advocate-pro-1", {
          canonicalModelId: null,
          providerEndpointTag: null,
          inputPricePerMillion: null,
          outputPricePerMillion: null,
          requestPriceUsd: null,
          pricingObservedAt: null,
          conservativeMaxCostUsd: null,
          providerRequestId: null,
          errorCategory: null,
          errorMessage: null
        }),
        ...ATTEMPT_PARTICIPANT_IDS.slice(1).map((id) => attemptAudit(id))
      ]
    });
    const { user, detailButton, detailBox } = await expandEconomicsAndOpenFirstDetail(run);

    await user.click(detailButton);

    const detail = within(detailBox);

    expect(detail.getByText("Canonical model: Unavailable")).toBeVisible();
    expect(detail.getByText("Provider endpoint: Unavailable")).toBeVisible();
    expect(detail.getByText("Input price: Unavailable")).toBeVisible();
    expect(detail.getByText("Output price: Unavailable")).toBeVisible();
    expect(detail.getByText("Request fee: Unavailable")).toBeVisible();
    expect(detail.getByText("Pricing observed at: Unavailable")).toBeVisible();
    expect(detail.getByText("Conservative participant reserve: Unavailable")).toBeVisible();
    expect(detail.getByText("Provider request ID: Unavailable")).toBeVisible();
    expect(detail.queryByText(/: \$0(?!\.)/)).not.toBeInTheDocument();
  });

  it("makes no current-price/network call when rendering pricing detail (structural -- no fetch beyond the initial run poll)", async () => {
    const { user, detailButton } = await expandEconomicsAndOpenFirstDetail(baseRun());
    const fetchSpy = vi.mocked(globalThis.fetch);
    const callsBeforeExpand = fetchSpy.mock.calls.length;

    await user.click(detailButton);

    expect(fetchSpy.mock.calls.length).toBe(callsBeforeExpand);
  });
});

describe("RunPage Admission / Budget Safety (Milestone 10, Issue #23)", () => {
  it("distinguishes the conservative admission bound from actual spend, and shows Policy V1/1.10/$5.00 evidence", async () => {
    const run = baseRun({
      totalCostUsd: "0.0014619",
      admission: {
        available: true,
        economicsPolicyVersion: "tribunal-economics-policy-v1",
        participantReserveSum: "0.00696652",
        budgetSafetyFactor: "1.1",
        authoritativeHistoricalBound: "0.007663172",
        hardBudgetUsd: "5",
        withinBudget: true
      }
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });
    await userEvent.setup().click(screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ }));

    expect(screen.getByText(/Economics policy:\s*V1/)).toBeInTheDocument();
    expect(screen.getByText(/Conservative authorized maximum:\s*\$0\.007663172/)).toBeInTheDocument();
    expect(screen.getByText(/Safety factor:\s*1\.1/)).toBeInTheDocument();
    expect(screen.getByText(/Hard run ceiling:\s*\$5/)).toBeInTheDocument();
    expect(screen.getByText(/Admission result:\s*Within budget/)).toBeInTheDocument();
    // The actual total model cost (top of page) is a separate, distinctly
    // labeled figure from the conservative authorized maximum.
    expect(screen.getByText(/Total model cost: \$0\.0014619/)).toBeInTheDocument();
    expect(screen.getByText(/not the actual amount charged/)).toBeInTheDocument();
  });

  it("renders an honest Unavailable when admission evidence could not be reconstructed", async () => {
    mockRunFetch(baseRun({ admission: { available: false, reason: "incomplete evidence" } }));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });
    await userEvent.setup().click(screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ }));

    expect(screen.getByText(/Admission evidence:\s*Unavailable/)).toBeInTheDocument();
  });

  it("renders nothing under Admission / Budget Safety when admission is not applicable (null)", async () => {
    mockRunFetch(baseRun({ admission: null }));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });
    await userEvent.setup().click(screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ }));

    expect(screen.queryByText("Admission / Budget Safety")).not.toBeInTheDocument();
  });
});

describe("RunPage Protocol Accordion (Milestone 10, Issue #23)", () => {
  it("exposes a visible expand affordance and is absent when no protocol is available", async () => {
    mockRunFetch(baseRun({ protocol: null }));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    expect(screen.queryByRole("button", { name: /^Protocol/ })).not.toBeInTheDocument();
  });

  it("click reveals the resolved Charge Sheet, participants, and judge reasoning", async () => {
    const user = userEvent.setup();
    mockRunFetch(baseRun({ protocol: resolvedProtocolFixture() }));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const protocolButton = screen.getByRole("button", { expanded: false, name: /^Protocol/ });
    const chargeSheetHeading = screen.getByText("Charge Sheet");

    expect(chargeSheetHeading).not.toBeVisible();

    await user.click(protocolButton);

    expect(screen.getByRole("button", { expanded: true, name: /^Protocol/ })).toBeInTheDocument();
    expect(chargeSheetHeading).toBeVisible();
    expect(screen.getByText(/Defendant: Alex Rowan/)).toBeVisible();
    expect(screen.getByText(/openai\/gpt-4\.1-nano/)).toBeVisible();
    expect(screen.getByText(/judge-1 \(GUILTY\): Judge I reasoning\./)).toBeVisible();
  });

  it("keyboard activation reveals the protocol content", async () => {
    const user = userEvent.setup();
    mockRunFetch(baseRun({ protocol: resolvedProtocolFixture() }));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const protocolButton = screen.getByRole("button", { expanded: false, name: /^Protocol/ });
    protocolButton.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { expanded: true, name: /^Protocol/ })).toBeInTheDocument();
    expect(screen.getByText("Charge Sheet")).toBeVisible();
  });

  it("shows profile name, personality, model, and prompt version for a frozen participant with a profile name set", async () => {
    const user = userEvent.setup();
    mockRunFetch(
      baseRun({
        protocol: resolvedProtocolFixture({
          participants: [
            {
              participantId: "advocate-pro-1",
              role: "ADVOCATE",
              side: "PRO",
              profileName: "The Zealous Prosecutor",
              personality: "A measured, professional demeanor.",
              // Deliberately distinct from attemptAudit()'s defaults
              // ("openai/gpt-5" / "advocate-v1") so the Protocol
              // section's own model/prompt-version text never
              // collides with the (collapsed but still present)
              // per-attempt pricing-detail rows.
              modelId: "openai/gpt-4.1-nano",
              promptVersion: "advocate-protocol-fixture-v1"
            }
          ]
        })
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    await user.click(screen.getByRole("button", { expanded: false, name: /^Protocol/ }));

    expect(screen.getByText("Profile: The Zealous Prosecutor")).toBeVisible();
    expect(screen.getByText("Personality: A measured, professional demeanor.")).toBeVisible();
    expect(screen.getByText("Model: openai/gpt-4.1-nano")).toBeVisible();
    expect(screen.getByText("Prompt version: advocate-protocol-fixture-v1")).toBeVisible();
  });

  it("does not fabricate a profile name when the frozen participant has none, and renders personality as plain text", async () => {
    const user = userEvent.setup();
    mockRunFetch(
      baseRun({
        protocol: resolvedProtocolFixture({
          participants: [
            {
              participantId: "advocate-pro-1",
              role: "ADVOCATE",
              side: "PRO",
              profileName: null,
              personality: "<script>alert('x')</script> & a measured demeanor.",
              // Same disambiguation as the previous test.
              modelId: "openai/gpt-4.1-nano",
              promptVersion: "advocate-protocol-fixture-v1"
            }
          ]
        })
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    await user.click(screen.getByRole("button", { expanded: false, name: /^Protocol/ }));

    expect(screen.queryByText(/^Profile:/)).not.toBeInTheDocument();
    expect(
      screen.getByText("Personality: <script>alert('x')</script> & a measured demeanor.")
    ).toBeVisible();
    expect(screen.getByText("Model: openai/gpt-4.1-nano")).toBeVisible();
    expect(screen.getByText("Prompt version: advocate-protocol-fixture-v1")).toBeVisible();
  });
});

describe("RunPage FAILED partial-spend disclosure (Milestone 10, Issue #23 Finding 2)", () => {
  it("shows a single honest line when every incurred attempt cost is known", async () => {
    mockRunFetch(
      baseRun({
        status: "FAILED",
        majorityVerdict: null,
        failureCode: "ADVOCATE_TERMINAL_FAILURE",
        failureMessage: "Advocate advocate-pro-1 did not produce a valid speech after the permitted retry.",
        partialSpend: { knownCostUsd: "0.0003", hasUnknownCost: false },
        admission: null,
        protocol: null
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/Partial model cost so far: \$0\.0003/)).toBeVisible();
    expect(screen.queryByText(/Known partial model cost/)).not.toBeInTheDocument();
  });

  it("shows the known/unavailable split when at least one attempt's cost is genuinely unknown -- never a misleading single total", async () => {
    mockRunFetch(
      baseRun({
        status: "FAILED",
        majorityVerdict: null,
        failureCode: "ADVOCATE_TERMINAL_FAILURE",
        failureMessage: "Advocate advocate-pro-1 did not produce a valid speech after the permitted retry.",
        partialSpend: { knownCostUsd: "0.0003", hasUnknownCost: true },
        admission: null,
        protocol: null
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/Known partial model cost: \$0\.0003/)).toBeVisible();
    expect(screen.getByText(/Additional attempt cost: Unavailable/)).toBeVisible();
    expect(screen.queryByText(/Partial model cost so far/)).not.toBeInTheDocument();
  });

  it("never fabricates a $0 partial-spend line when zero provider attempts occurred", async () => {
    mockRunFetch(
      baseRun({
        status: "FAILED",
        majorityVerdict: null,
        failureCode: "RUN_STATE_UNEXPECTED",
        failureMessage: "The run could not complete.",
        partialSpend: null,
        admission: null,
        attempts: [],
        protocol: null
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByText(/The Tribunal could not complete/i);

    expect(screen.queryByText(/Partial model cost/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Known partial model cost/)).not.toBeInTheDocument();
    expect(screen.queryByText("$0")).not.toBeInTheDocument();
  });

  it("offers the Economics / Audit details Accordion on a FAILED run with attempts, but never a verdict", async () => {
    mockRunFetch(
      baseRun({
        status: "FAILED",
        majorityVerdict: null,
        failureCode: "ADVOCATE_TERMINAL_FAILURE",
        failureMessage: "Advocate advocate-pro-1 did not produce a valid speech after the permitted retry.",
        partialSpend: { knownCostUsd: "0.0003", hasUnknownCost: false },
        admission: null,
        protocol: null
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByText(/The Tribunal could not complete/i);

    expect(screen.getByRole("button", { name: /Economics \/ Audit details/ })).toBeInTheDocument();
    expect(screen.queryByText("GUILTY")).not.toBeInTheDocument();
    expect(screen.queryByText("NOT_GUILTY")).not.toBeInTheDocument();
  });
});

describe("RunPage BLOCKED_BUDGET stays distinct from FAILED-with-spend (Milestone 10, Issue #23)", () => {
  it("shows no cost line, no Economics/Audit Accordion, and no verdict", async () => {
    mockRunFetch(
      baseRun({
        status: "BLOCKED_BUDGET",
        majorityVerdict: null,
        failureMessage: "Conservative preflight exceeded the $5.00 policy limit.",
        totalCostUsd: null,
        partialSpend: null,
        admission: null,
        attempts: [],
        protocol: null,
        participants: []
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText(/this run cannot be executed/i)).toBeVisible();
    expect(screen.queryByText(/Partial model cost/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Economics \/ Audit details/ })).not.toBeInTheDocument();
    expect(screen.queryByText("GUILTY")).not.toBeInTheDocument();
    expect(screen.queryByText("NOT_GUILTY")).not.toBeInTheDocument();
  });
});

describe("RunPage public-demo retention notice (Milestone 11, Issue #27)", () => {
  const RETENTION_TEXT = /shared, single-tenant public course\/demo application/i;

  it("is visible on a direct /runs/:runId reload of a COMPLETED run", async () => {
    mockRunFetch(baseRun());

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByRole("heading", { name: "GUILTY" });
    expect(screen.getByText(RETENTION_TEXT)).toBeVisible();
  });

  it("is visible on a FAILED run", async () => {
    mockRunFetch(
      baseRun({
        status: "FAILED",
        majorityVerdict: null,
        failureMessage: "The Tribunal could not complete.",
        totalCostUsd: null
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByRole("heading", { name: /the tribunal could not complete/i });
    expect(screen.getByText(RETENTION_TEXT)).toBeVisible();
  });

  it("is visible on a BLOCKED_BUDGET run", async () => {
    mockRunFetch(
      baseRun({
        status: "BLOCKED_BUDGET",
        majorityVerdict: null,
        failureMessage: "Conservative preflight exceeded the $5.00 policy limit.",
        totalCostUsd: null,
        partialSpend: null,
        admission: null,
        attempts: [],
        protocol: null,
        participants: []
      })
    );

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByText(/this run cannot be executed/i);
    expect(screen.getByText(RETENTION_TEXT)).toBeVisible();
  });

  it("does not bypass or duplicate the existing result-integrity error branch", async () => {
    const run = baseRun();

    run.participants = run.participants.map((entry) =>
      entry.participantId === "judge-3" ? { ...entry, verdict: null, reasoning: null } : entry
    );
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByText(/result cannot be safely displayed/i);
    expect(screen.getByText(RETENTION_TEXT)).toBeVisible();
    expect(screen.queryByText("GUILTY")).not.toBeInTheDocument();
  });
});

describe("RunPage historical Advocate side meaning (PRO/CON semantic correction, Issue #30)", () => {
  // All four Advocate participants are set to the SAME promptVersion per
  // scenario, and assertions check the resulting count across all four
  // -- this both avoids any ambiguity between individual advocates and
  // proves the fail-closed/legacy/current policy applies consistently,
  // not merely to one participant.
  function runWithAllAdvocatesPromptVersion(promptVersion: string): StoredRun {
    const run = baseRun();

    run.participants = run.participants.map((entry) =>
      entry.role === "ADVOCATE" ? { ...entry, promptVersion } : entry
    );

    return run;
  }

  it("advocate-v1 (the true historical value) shows the legacy caption -- PRO argued for the charge (GUILTY), CON argued against it (NOT_GUILTY)", async () => {
    mockRunFetch(runWithAllAdvocatesPromptVersion("advocate-v1"));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByRole("heading", { name: "GUILTY" });
    expect(screen.getAllByText("PRO — Legacy semantics (advocate-v1)")).toHaveLength(2);
    expect(screen.getAllByText("CON — Legacy semantics (advocate-v1)")).toHaveLength(2);
    expect(
      screen.getAllByText("Historical: assigned to argue for the charge (GUILTY)")
    ).toHaveLength(2);
    expect(
      screen.getAllByText("Historical: assigned to argue against the charge (NOT_GUILTY)")
    ).toHaveLength(2);
    expect(screen.queryByText("PRO — Defense")).not.toBeInTheDocument();
    expect(screen.queryByText("CON — Opposition")).not.toBeInTheDocument();
  });

  it("advocate-v2 shows the corrected caption -- PRO is Defense/NOT_GUILTY, CON is Opposition/GUILTY", async () => {
    mockRunFetch(runWithAllAdvocatesPromptVersion("advocate-v2"));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByRole("heading", { name: "GUILTY" });
    expect(screen.getAllByText("PRO — Defense")).toHaveLength(2);
    expect(screen.getAllByText("CON — Opposition")).toHaveLength(2);
    expect(screen.getAllByText("Supports the defendant · argues NOT_GUILTY")).toHaveLength(2);
    expect(screen.getAllByText("Argues against the defendant · argues GUILTY")).toHaveLength(2);
    expect(screen.queryByText(/Legacy semantics/)).not.toBeInTheDocument();
  });

  it("the true pre-M7 placeholder never fabricates a legacy or corrected claim -- fails closed", async () => {
    mockRunFetch(runWithAllAdvocatesPromptVersion("unassigned-pre-m7"));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByRole("heading", { name: "GUILTY" });
    expect(
      screen.getAllByText('Semantic mapping unavailable for prompt version "unassigned-pre-m7".')
    ).toHaveLength(4);
    expect(screen.queryByText("PRO — Defense")).not.toBeInTheDocument();
    expect(screen.queryByText(/Legacy semantics/)).not.toBeInTheDocument();
  });

  it("an arbitrary unrecognized version never defaults to the current (advocate-v2) meaning -- fails closed identically to the placeholder", async () => {
    mockRunFetch(runWithAllAdvocatesPromptVersion("advocate-v99-totally-unknown"));

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByRole("heading", { name: "GUILTY" });
    expect(
      screen.getAllByText(
        'Semantic mapping unavailable for prompt version "advocate-v99-totally-unknown".'
      )
    ).toHaveLength(4);
    expect(screen.queryByText("PRO — Defense")).not.toBeInTheDocument();
    expect(screen.queryByText(/Legacy semantics/)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------
// Human product decision (PR #34) -- product-wide participant-identity
// correction: prompted by observing the M12 Jon Snow live gate, but NOT
// Jon-Snow-specific. Every fixture below uses generic, non-Jon-Snow
// names (David Cohen, Sarah Levi, Justice Green) to prove the rule is
// a global product invariant, not a Jon Snow special case (Sec 12
// item J). PRIMARY: persisted profileName when meaningfully set.
// SECONDARY: structural seat. FALLBACK: generic seat alone.
// ---------------------------------------------------------------------

function participantWithProfile(
  participantId: string,
  role: "ADVOCATE" | "JUDGE",
  side: "PRO" | "CON" | null,
  profileName: string | null,
  overrides: { speech?: string; verdict?: "GUILTY" | "NOT_GUILTY" | null; reasoning?: string | null } = {}
): StoredRun["participants"][number] {
  // Pinned to the CURRENT prompt version (advocate-v2/judge-v2) --
  // participant()'s own default is the legacy advocate-v1/judge-v1, and
  // these identity tests are not about the version-aware side-meaning
  // policy itself (covered exhaustively elsewhere in this file); they
  // only need to prove name/seat display is correct without disturbing
  // whichever side meaning is already in effect.
  return {
    ...participant(participantId, role, side, overrides),
    profileName,
    promptVersion: role === "ADVOCATE" ? "advocate-v2" : "judge-v2"
  };
}

describe("RunPage participant identity (product-wide, PR #34)", () => {
  it("A: a live PRO advocate with a persisted profileName shows the name as primary and PRO I as secondary seat context", async () => {
    const run = baseRun({
      status: "ADVOCATES_RUNNING",
      majorityVerdict: null,
      participants: [
        participantWithProfile("advocate-pro-1", "ADVOCATE", "PRO", "David Cohen"),
        participantWithProfile("advocate-pro-2", "ADVOCATE", "PRO", null),
        participantWithProfile("advocate-con-1", "ADVOCATE", "CON", null),
        participantWithProfile("advocate-con-2", "ADVOCATE", "CON", null),
        participantWithProfile("judge-1", "JUDGE", null, null),
        participantWithProfile("judge-2", "JUDGE", null, null),
        participantWithProfile("judge-3", "JUDGE", null, null)
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByText("David Cohen");
    // Scoped to this participant's own card -- "PRO I" is this card's
    // own secondary seat label (David Cohen's PRO I, not PRO II's own,
    // unlabeled card), and "PRO — Defense" legitimately also appears on
    // the OTHER PRO advocate's card, so an unscoped query would be
    // ambiguous.
    const card = screen.getByText("David Cohen").closest(".MuiStack-root") as HTMLElement;

    expect(within(card).getByText("PRO I")).toBeVisible();
    // The existing prompt-version-aware side meaning remains authoritative
    // and untouched -- never replaced by a new hard-coded interpretation.
    expect(within(card).getByText("PRO — Defense")).toBeVisible();
  });

  it("B: a live CON advocate with a persisted profileName preserves the existing Opposition/GUILTY side meaning", async () => {
    const run = baseRun({
      status: "ADVOCATES_RUNNING",
      majorityVerdict: null,
      participants: [
        participantWithProfile("advocate-pro-1", "ADVOCATE", "PRO", null),
        participantWithProfile("advocate-pro-2", "ADVOCATE", "PRO", null),
        participantWithProfile("advocate-con-1", "ADVOCATE", "CON", "Sarah Levi"),
        participantWithProfile("advocate-con-2", "ADVOCATE", "CON", null),
        participantWithProfile("judge-1", "JUDGE", null, null),
        participantWithProfile("judge-2", "JUDGE", null, null),
        participantWithProfile("judge-3", "JUDGE", null, null)
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    await screen.findByText("Sarah Levi");
    // Scoped to this participant's own card -- CON II's card also
    // legitimately renders "CON — Opposition", so an unscoped query
    // would be ambiguous.
    const card = screen.getByText("Sarah Levi").closest(".MuiStack-root") as HTMLElement;

    expect(within(card).getByText("CON I")).toBeVisible();
    expect(within(card).getByText("CON — Opposition")).toBeVisible();
  });

  it("C: a live judge with a persisted profileName shows the name as primary and Judge I as secondary seat context", async () => {
    const run = baseRun({
      status: "JUDGES_RUNNING",
      majorityVerdict: null,
      participants: [
        participantWithProfile("advocate-pro-1", "ADVOCATE", "PRO", null, { speech: "PRO I speech." }),
        participantWithProfile("advocate-pro-2", "ADVOCATE", "PRO", null, { speech: "PRO II speech." }),
        participantWithProfile("advocate-con-1", "ADVOCATE", "CON", null, { speech: "CON I speech." }),
        participantWithProfile("advocate-con-2", "ADVOCATE", "CON", null, { speech: "CON II speech." }),
        participantWithProfile("judge-1", "JUDGE", null, "Justice Green"),
        participantWithProfile("judge-2", "JUDGE", null, null),
        participantWithProfile("judge-3", "JUDGE", null, null)
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);

    expect(await screen.findByText("Justice Green")).toBeVisible();
    expect(screen.getByText("Judge I")).toBeVisible();
  });

  it("D: a completed advocate's argument is attributed to the persisted profileName, with seat/side as secondary context", async () => {
    const run = baseRun({
      participants: [
        participantWithProfile("advocate-pro-1", "ADVOCATE", "PRO", "David Cohen", { speech: "PRO I speech." }),
        participantWithProfile("advocate-pro-2", "ADVOCATE", "PRO", null, { speech: "PRO II speech." }),
        participantWithProfile("advocate-con-1", "ADVOCATE", "CON", null, { speech: "CON I speech." }),
        participantWithProfile("advocate-con-2", "ADVOCATE", "CON", null, { speech: "CON II speech." }),
        participantWithProfile("judge-1", "JUDGE", null, null, { verdict: "GUILTY", reasoning: "Judge I reasoning." }),
        participantWithProfile("judge-2", "JUDGE", null, null, { verdict: "GUILTY", reasoning: "Judge II reasoning." }),
        participantWithProfile("judge-3", "JUDGE", null, null, { verdict: "NOT_GUILTY", reasoning: "Judge III reasoning." })
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    expect(screen.getByRole("button", { expanded: false, name: /^David Cohen\b/ })).toBeVisible();
    expect(screen.getByText(/PRO I -- PRO/)).toBeVisible();
  });

  it("E: the judge vote summary shows the persisted profileName with the judge seat as secondary context", async () => {
    const run = baseRun({
      participants: [
        participantWithProfile("advocate-pro-1", "ADVOCATE", "PRO", null, { speech: "PRO I speech." }),
        participantWithProfile("advocate-pro-2", "ADVOCATE", "PRO", null, { speech: "PRO II speech." }),
        participantWithProfile("advocate-con-1", "ADVOCATE", "CON", null, { speech: "CON I speech." }),
        participantWithProfile("advocate-con-2", "ADVOCATE", "CON", null, { speech: "CON II speech." }),
        participantWithProfile("judge-1", "JUDGE", null, "Justice Green", { verdict: "GUILTY", reasoning: "Judge I reasoning." }),
        participantWithProfile("judge-2", "JUDGE", null, null, { verdict: "GUILTY", reasoning: "Judge II reasoning." }),
        participantWithProfile("judge-3", "JUDGE", null, null, { verdict: "NOT_GUILTY", reasoning: "Judge III reasoning." })
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const voteGroup = screen.getByTestId("judge-vote-group");

    expect(within(voteGroup).getByText("Justice Green")).toBeVisible();
    expect(within(voteGroup).getByText("Judge I")).toBeVisible();
  });

  it("F: the judge reasoning accordion uses the same persisted profileName as the vote summary, not the bare seat label alone", async () => {
    const run = baseRun({
      participants: [
        participantWithProfile("advocate-pro-1", "ADVOCATE", "PRO", null, { speech: "PRO I speech." }),
        participantWithProfile("advocate-pro-2", "ADVOCATE", "PRO", null, { speech: "PRO II speech." }),
        participantWithProfile("advocate-con-1", "ADVOCATE", "CON", null, { speech: "CON I speech." }),
        participantWithProfile("advocate-con-2", "ADVOCATE", "CON", null, { speech: "CON II speech." }),
        participantWithProfile("judge-1", "JUDGE", null, "Justice Green", { verdict: "GUILTY", reasoning: "Judge I reasoning." }),
        participantWithProfile("judge-2", "JUDGE", null, null, { verdict: "GUILTY", reasoning: "Judge II reasoning." }),
        participantWithProfile("judge-3", "JUDGE", null, null, { verdict: "NOT_GUILTY", reasoning: "Judge III reasoning." })
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    const reasoningButton = screen.getByRole("button", { expanded: false, name: /^Justice Green\b/ });

    expect(reasoningButton).toBeVisible();
    expect(within(reasoningButton).getByText("Judge I")).toBeVisible();
  });

  it("G: a null profileName falls back to the generic seat label, never a blank/duplicated heading", async () => {
    mockRunFetch(baseRun()); // baseRun()'s default participant() always sets profileName: null

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    expect(screen.getByRole("button", { expanded: false, name: /^PRO I\b/ })).toBeVisible();
    expect(screen.getByRole("button", { expanded: false, name: /^Judge I\b/ })).toBeVisible();
    // No secondary seat line duplicating the primary ("PRO I" / "PRO I").
    expect(screen.getAllByText("PRO I")).toHaveLength(1);
  });

  it("H: an empty-string or whitespace-only profileName falls back to the generic seat label, exactly like null", async () => {
    const run = baseRun({
      participants: [
        participantWithProfile("advocate-pro-1", "ADVOCATE", "PRO", "", { speech: "PRO I speech." }),
        participantWithProfile("advocate-pro-2", "ADVOCATE", "PRO", "   ", { speech: "PRO II speech." }),
        participantWithProfile("advocate-con-1", "ADVOCATE", "CON", null, { speech: "CON I speech." }),
        participantWithProfile("advocate-con-2", "ADVOCATE", "CON", null, { speech: "CON II speech." }),
        participantWithProfile("judge-1", "JUDGE", null, null, { verdict: "GUILTY", reasoning: "Judge I reasoning." }),
        participantWithProfile("judge-2", "JUDGE", null, null, { verdict: "GUILTY", reasoning: "Judge II reasoning." }),
        participantWithProfile("judge-3", "JUDGE", null, null, { verdict: "NOT_GUILTY", reasoning: "Judge III reasoning." })
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });

    expect(screen.getByRole("button", { expanded: false, name: /^PRO I\b/ })).toBeVisible();
    expect(screen.getByRole("button", { expanded: false, name: /^PRO II\b/ })).toBeVisible();
  });

  it("I: the attempt audit shows the persisted profileName alongside the structural participantId, never replacing it", async () => {
    const user = userEvent.setup();
    const run = baseRun({
      participants: [
        participantWithProfile("advocate-pro-1", "ADVOCATE", "PRO", "David Cohen", { speech: "PRO I speech." }),
        participantWithProfile("advocate-pro-2", "ADVOCATE", "PRO", null, { speech: "PRO II speech." }),
        participantWithProfile("advocate-con-1", "ADVOCATE", "CON", null, { speech: "CON I speech." }),
        participantWithProfile("advocate-con-2", "ADVOCATE", "CON", null, { speech: "CON II speech." }),
        participantWithProfile("judge-1", "JUDGE", null, null, { verdict: "GUILTY", reasoning: "Judge I reasoning." }),
        participantWithProfile("judge-2", "JUDGE", null, null, { verdict: "GUILTY", reasoning: "Judge II reasoning." }),
        participantWithProfile("judge-3", "JUDGE", null, null, { verdict: "NOT_GUILTY", reasoning: "Judge III reasoning." })
      ]
    });
    mockRunFetch(run);

    renderWithAppProviders(<AppRoutes />, `/runs/${RUN_ID}`);
    await screen.findByRole("heading", { name: "GUILTY" });
    await user.click(screen.getByRole("button", { expanded: false, name: /Economics \/ Audit details/ }));

    // Scoped to the audit table itself -- "David Cohen" also legitimately
    // appears in the (separate) advocate speech accordion above, so an
    // unscoped query would be ambiguous.
    const table = screen.getByRole("table", { name: /Model call attempt audit/i });

    expect(within(table).getByText("David Cohen")).toBeVisible();
    expect(within(table).getByText("advocate-pro-1")).toBeVisible();
    // A participant with no profileName still shows its bare
    // participantId, exactly as before this correction.
    expect(within(table).getByText("advocate-pro-2")).toBeVisible();
  });

  // J: no test in this describe block imports or references any Jon
  // Snow fixture, preset, or name -- every scenario above uses generic
  // names (David Cohen, Sarah Levi, Justice Green) or the plain seat
  // fallback, proving the rule is a global product invariant.
});
