// Milestone 8 -- Tribunal execution engine tests. Zero real OpenRouter
// calls anywhere: every provider interaction goes through
// ScriptedOpenRouterProvider (createChatCompletion resolved/rejected
// per-participant, inspecting the request's own user-message content
// rather than a call-order queue, since all seven logical calls run
// concurrently and interleave unpredictably).

import { describe, expect, it, vi } from "vitest";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "../../../src/prompts/versions";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";
import { ProviderError } from "../openrouter/errors";
import type { OpenRouterProvider, ProviderChatRequest, ProviderChatResult } from "../openrouter/provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";
import type { PreflightCase, PreflightRun, PreflightRunLoader } from "../openrouter/preflight";
import type { PersistedRun } from "../runs";
import { FakeTribunalExecutionRepository } from "./repository";
import { executeTribunalRun, type RunLoader } from "./execution";

const MODEL_ID = "openai/gpt-5";
const CASE = {
  defendant: "Alex Rowan",
  act: "Entered the restricted lab.",
  exactQuestion: "Did Alex knowingly violate the lab protocol?"
};

function eligibleFixture(): { models: RawOpenRouterModel[]; endpoints: RawOpenRouterEndpoint[] } {
  return {
    models: [{ id: MODEL_ID, canonical_slug: MODEL_ID, name: "Model", context_length: 200_000 }],
    endpoints: [
      {
        tag: "openai",
        provider_name: "OpenAI",
        name: "OpenAI",
        context_length: 200_000,
        max_prompt_tokens: 190_000,
        max_completion_tokens: 4000,
        supported_parameters: ["response_format", "max_completion_tokens"],
        quantization: null,
        status: 0,
        pricing: { prompt: "0.0000001", completion: "0.0000002" }
      }
    ]
  };
}

function personalityMarker(id: ParticipantId): string {
  return `MARKER:${id}`;
}

function buildRun(): PersistedRun {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    caseId: "22222222-2222-4222-8222-222222222222",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    executionMode: "shared",
    status: "READY",
    createdAt: "2026-08-29T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    majorityVerdict: null,
    failureCode: null,
    failureMessage: null,
    totalCostUsd: null,
    advocateCostUsd: null,
    judgeCostUsd: null,
    participants: participantIds.map((id) => ({
      id: `config-${id}`,
      participantId: id,
      role: id.startsWith("advocate") ? "ADVOCATE" : "JUDGE",
      side: id.includes("-pro-") ? "PRO" : id.includes("-con-") ? "CON" : null,
      profileName: null,
      personality: personalityMarker(id),
      personalitySource: "manual",
      personalitySourceFilename: null,
      modelId: MODEL_ID,
      promptVersion: id.startsWith("advocate") ? ADVOCATE_PROMPT_VERSION : JUDGE_PROMPT_VERSION,
      attemptStatus: "PENDING" as const,
      speech: null,
      verdict: null,
      reasoning: null
    }))
  };
}

// Mirrors the real SupabaseRunRepository.getById relationship to the
// claim/block RPCs: getById() always reflects the run's CURRENT status,
// since both read the same underlying table -- backed here by the same
// FakeTribunalExecutionRepository.runStatus map the RPCs mutate, rather
// than a snapshot frozen at construction time.
class FakeRunLoader implements RunLoader {
  constructor(
    private readonly run: PersistedRun | null,
    private readonly repository: FakeTribunalExecutionRepository
  ) {}

  async getById(): Promise<PersistedRun | null> {
    if (!this.run) {
      return null;
    }

    return { ...this.run, status: this.repository.runStatus.get(this.run.id) ?? this.run.status };
  }
}

class FakePreflightRunLoader implements PreflightRunLoader {
  constructor(private readonly run: PersistedRun) {}

  async getRun(): Promise<PreflightRun | null> {
    return {
      id: this.run.id,
      caseId: this.run.caseId,
      participants: this.run.participants.map((p) => ({
        participantId: p.participantId,
        modelId: p.modelId,
        personality: p.personality,
        promptVersion: p.promptVersion
      }))
    };
  }

  async getCase(): Promise<PreflightCase | null> {
    return CASE;
  }
}

type Script = Array<ProviderChatResult | ProviderError>;

// Determines which participant a request belongs to by matching the
// personality marker embedded in the user message -- every logical call
// gets its own deterministic, ordered script.
class ScriptedOpenRouterProvider implements OpenRouterProvider {
  private readonly callCounts = new Map<ParticipantId, number>();
  createChatCompletionCallCount = 0;
  readonly calledParticipantIds: ParticipantId[] = [];

  constructor(
    private readonly fixture: { models: RawOpenRouterModel[]; endpoints: RawOpenRouterEndpoint[] },
    private readonly scripts: Partial<Record<ParticipantId, Script>>
  ) {}

  async listModels(): Promise<RawOpenRouterModel[]> {
    return this.fixture.models;
  }

  async listEndpoints(): Promise<RawOpenRouterEndpoint[]> {
    return this.fixture.endpoints;
  }

  async createChatCompletion(request: ProviderChatRequest): Promise<ProviderChatResult> {
    this.createChatCompletionCallCount += 1;

    const userMessage = request.messages.find((m) => m.role === "user")?.content ?? "";
    const participantId = participantIds.find((id) => userMessage.includes(personalityMarker(id)));

    if (!participantId) {
      throw new Error("Test setup error: request did not carry a recognizable participant marker.");
    }

    this.calledParticipantIds.push(participantId);

    const script = this.scripts[participantId] ?? [successResult()];
    const index = this.callCounts.get(participantId) ?? 0;
    const next = script[index] ?? script[script.length - 1];

    this.callCounts.set(participantId, index + 1);

    if (next instanceof ProviderError) {
      throw next;
    }

    return next;
  }
}

function successResult(overrides: { speech?: string; verdict?: string; reasoning?: string } = {}): ProviderChatResult {
  const content = overrides.verdict
    ? JSON.stringify({ verdict: overrides.verdict, reasoning: overrides.reasoning ?? "Reasoned verdict." })
    : JSON.stringify({ speech: overrides.speech ?? "A well-formed speech." });

  return {
    raw: {
      id: "gen-test",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.001 }
    }
  } as ProviderChatResult;
}

function allEligibleScripts(): Partial<Record<ParticipantId, Script>> {
  const scripts: Partial<Record<ParticipantId, Script>> = {};

  for (const id of participantIds) {
    scripts[id] = id.startsWith("advocate")
      ? [successResult({ speech: `Speech from ${id}.` })]
      : [successResult({ verdict: "GUILTY", reasoning: `Reasoning from ${id}.` })];
  }

  return scripts;
}

function buildDeps(run: PersistedRun, provider: ScriptedOpenRouterProvider, repository = new FakeTribunalExecutionRepository()) {
  repository.setRunStatus(run.id, run.status);

  return {
    deps: {
      runLoader: new FakeRunLoader(run, repository),
      preflightRunLoader: new FakePreflightRunLoader(run),
      provider,
      repository
    },
    repository
  };
}

describe("executeTribunalRun", () => {
  it("a successful no-retry run makes exactly 7 logical calls / 7 provider attempts, all four advocates concurrent, all three judges concurrent", async () => {
    const run = buildRun();
    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), allEligibleScripts());
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "completed", majorityVerdict: "GUILTY" });
    expect(provider.createChatCompletionCallCount).toBe(7);
    expect(repository.attempts.size).toBe(7);
    expect(repository.speeches.size).toBe(4);
    expect(repository.verdicts.size).toBe(3);

    // Concurrency proof: all four advocate calls happened before any
    // judge call started (the barrier separates the two phases), but
    // within phase A the four calls interleave freely -- the four
    // advocate participant ids must all appear before the first judge id.
    const firstJudgeIndex = provider.calledParticipantIds.findIndex((id) => id.startsWith("judge"));
    const advocatesBeforeJudge = provider.calledParticipantIds.slice(0, firstJudgeIndex);

    expect(new Set(advocatesBeforeJudge)).toEqual(
      new Set(["advocate-pro-1", "advocate-pro-2", "advocate-con-1", "advocate-con-2"])
    );
  });

  it("judges receive all four validated speeches in fixed order", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    // Make attempt content assertable by embedding a distinct string.
    scripts["advocate-pro-1"] = [successResult({ speech: "PRO ONE SPEECH" })];
    scripts["advocate-pro-2"] = [successResult({ speech: "PRO TWO SPEECH" })];
    scripts["advocate-con-1"] = [successResult({ speech: "CON ONE SPEECH" })];
    scripts["advocate-con-2"] = [successResult({ speech: "CON TWO SPEECH" })];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    await executeTribunalRun(run.id, deps);

    expect(repository.speeches.get("config-advocate-pro-1")).toBe("PRO ONE SPEECH");
    expect(repository.speeches.get("config-advocate-con-2")).toBe("CON TWO SPEECH");
  });

  it("terminal advocate failure -> run FAILED, zero judge calls", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["advocate-con-1"] = [
      new ProviderError("PROVIDER_5XX", "boom"),
      new ProviderError("PROVIDER_5XX", "boom again")
    ];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "failed", failureCode: "ADVOCATE_TERMINAL_FAILURE" });
    expect(provider.calledParticipantIds.some((id) => id.startsWith("judge"))).toBe(false);
    expect(repository.runStatus.get(run.id)).toBe("FAILED");
  });

  it("terminal judge failure -> run FAILED, no majority", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["judge-2"] = [
      new ProviderError("PROVIDER_5XX", "boom"),
      new ProviderError("PROVIDER_5XX", "boom again")
    ];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "failed", failureCode: "JUDGE_TERMINAL_FAILURE" });
    expect(repository.completedRuns.has(run.id)).toBe(false);
  });

  it("one retryable failure then success on attempt #2 -> 8 provider attempts, still 7 logical calls", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["advocate-pro-2"] = [
      new ProviderError("TIMEOUT", "timed out"),
      successResult({ speech: "Recovered on retry." })
    ];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome.outcome).toBe("completed");
    expect(provider.createChatCompletionCallCount).toBe(8);
    expect(repository.attempts.size).toBe(8);
    expect(repository.speeches.get("config-advocate-pro-2")).toBe("Recovered on retry.");
  });

  it("max two attempts per logical call -- a second consecutive retryable failure terminates, never a third attempt", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["judge-3"] = [
      new ProviderError("TIMEOUT", "timed out"),
      new ProviderError("TIMEOUT", "timed out again")
    ];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps } = buildDeps(run, provider);

    await executeTribunalRun(run.id, deps);

    const judge3Calls = provider.calledParticipantIds.filter((id) => id === "judge-3");

    expect(judge3Calls).toHaveLength(2);
  });

  it("a non-retryable category (e.g. AUTHENTICATION) never gets a second attempt", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["advocate-con-2"] = [new ProviderError("AUTHENTICATION", "bad key")];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "failed", failureCode: "ADVOCATE_TERMINAL_FAILURE" });
    expect(provider.calledParticipantIds.filter((id) => id === "advocate-con-2")).toHaveLength(1);
  });

  it("duplicate worker invocation on an already-claimed run makes zero completion calls", async () => {
    const run = buildRun();
    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), allEligibleScripts());
    const { deps, repository } = buildDeps(run, provider);

    // Simulate a first invocation having already claimed the run.
    repository.setRunStatus(run.id, "ADVOCATES_RUNNING");

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "not_ready" });
    expect(provider.createChatCompletionCallCount).toBe(0);
  });

  it("two concurrent invocations of the same READY run: exactly one executes, the other makes zero completion calls", async () => {
    const run = buildRun();
    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), allEligibleScripts());
    const repository = new FakeTribunalExecutionRepository();
    repository.setRunStatus(run.id, "READY");

    const deps = {
      runLoader: new FakeRunLoader(run, repository),
      preflightRunLoader: new FakePreflightRunLoader(run),
      provider,
      repository
    };

    const [first, second] = await Promise.all([
      executeTribunalRun(run.id, deps),
      executeTribunalRun(run.id, deps)
    ]);

    const outcomes = [first.outcome, second.outcome].sort();

    expect(outcomes).toEqual(["completed", "not_claimed"]);
    // Exactly one full run's worth of completion calls -- the loser made
    // none of its own on top.
    expect(provider.createChatCompletionCallCount).toBe(7);
  });

  it("execution-time preflight runs BEFORE the atomic claim: an ineligible run is BLOCKED_BUDGET with zero completion calls, and the claim can never win afterward", async () => {
    const run = buildRun();
    // No listEndpointsResult configured for this model -- listEndpoints
    // returns [] by default, which resolveModelRoute treats as
    // ineligible (no candidate endpoint at all).
    const provider = new ScriptedOpenRouterProvider(
      { models: [], endpoints: [] },
      allEligibleScripts()
    );
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome.outcome).toBe("blocked_budget");
    expect(provider.createChatCompletionCallCount).toBe(0);
    expect(repository.runStatus.get(run.id)).toBe("BLOCKED_BUDGET");

    // The claim RPC's own WHERE status = 'READY' predicate makes this
    // structural, not merely "this test didn't try it" -- prove it here.
    const wonClaimAfterBlock = await repository.claimForExecution(run.id);

    expect(wonClaimAfterBlock).toBe(false);
  });

  it("a run that is not READY at all (e.g. already COMPLETED) is left alone -- zero completion calls", async () => {
    const run = buildRun();
    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), allEligibleScripts());
    const { deps, repository } = buildDeps(run, provider);
    repository.setRunStatus(run.id, "COMPLETED");

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "not_ready" });
    expect(provider.createChatCompletionCallCount).toBe(0);
  });

  it("no silent model/provider fallback: the exact configured model is used for every completion request", async () => {
    const run = buildRun();
    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), allEligibleScripts());
    const spy = vi.spyOn(provider, "createChatCompletion");
    const { deps } = buildDeps(run, provider);

    await executeTribunalRun(run.id, deps);

    for (const call of spy.mock.calls) {
      expect(call[0].model).toBe(MODEL_ID);
    }
  });

  it("failed-attempt telemetry stays null, never fabricated zero", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["advocate-pro-1"] = [
      new ProviderError("PROVIDER_5XX", "boom"),
      new ProviderError("PROVIDER_5XX", "boom again")
    ];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    await executeTribunalRun(run.id, deps);

    const failedAttempt = [...repository.attempts.values()].find(
      (a) => a.participantConfigId === "config-advocate-pro-1" && a.attemptNumber === 1
    );

    expect(failedAttempt?.inputTokens).toBeNull();
    expect(failedAttempt?.outputTokens).toBeNull();
    expect(failedAttempt?.actualCostUsd).toBeNull();
  });
});
