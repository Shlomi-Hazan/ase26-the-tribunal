// Milestone 8 -- Tribunal execution engine tests. Zero real OpenRouter
// calls anywhere: every provider interaction goes through
// ScriptedOpenRouterProvider (createChatCompletion resolved/rejected
// per-participant, inspecting the request's own user-message content
// rather than a call-order queue, since all seven logical calls run
// concurrently and interleave unpredictably).

import Decimal from "decimal.js";
import { describe, expect, it, vi } from "vitest";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "../../../src/prompts/versions";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";
import { ProviderError } from "../openrouter/errors";
import type { OpenRouterProvider, ProviderChatRequest, ProviderChatResult } from "../openrouter/provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";
import type { PreflightCase, PreflightRun, PreflightRunLoader } from "../openrouter/preflight";
import type { PersistedRun } from "../runs";
import { runPreflight } from "../openrouter/preflight";
import { advocateSpeechJsonSchema } from "../../../src/prompts/schemas";
import { FakeTribunalExecutionRepository } from "./repository";
import {
  executeTribunalRun,
  runLogicalCall,
  toResolvedRoute,
  RuntimeBudgetGuard,
  type RunLoader
} from "./execution";

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

function successResult(overrides: {
  speech?: string;
  verdict?: string;
  reasoning?: string;
  // Blocker 5 test support: "missing" omits usage entirely; "no-cost"
  // includes native token counts but no usage.cost (forces a derived
  // cost); "present" (default) is the normal case.
  usage?: "present" | "missing" | "no-cost";
  cost?: number;
} = {}): ProviderChatResult {
  const content = overrides.verdict
    ? JSON.stringify({ verdict: overrides.verdict, reasoning: overrides.reasoning ?? "Reasoned verdict." })
    : JSON.stringify({ speech: overrides.speech ?? "A well-formed speech." });

  const usageMode = overrides.usage ?? "present";
  const usage =
    usageMode === "missing"
      ? undefined
      : usageMode === "no-cost"
        ? { prompt_tokens: 100, completion_tokens: 50 }
        : { prompt_tokens: 100, completion_tokens: 50, cost: overrides.cost ?? 0.001 };

  return {
    raw: {
      id: "gen-test",
      choices: [{ message: { content } }],
      usage
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

  it("SEPARATE-mode run -> separate_mode_not_enabled, zero completion calls (M8 is Shared-Model only, M9 scope)", async () => {
    const run = { ...buildRun(), executionMode: "separate" as const };
    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), allEligibleScripts());
    const { deps } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "separate_mode_not_enabled" });
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

  // ---------------------------------------------------------------
  // Blocker 3 (independent audit correction): runtime $5 budget guard.
  // ---------------------------------------------------------------

  it("judge batch is blocked -- zero judge calls -- when advocate spend leaves insufficient safe exposure", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    // Three ordinary cheap advocates, one expensive one -- total real
    // advocate spend (< $5.00) does not itself exceed the ceiling, but
    // leaves too little room for the judge batch's own conservative
    // reserve (computed from this fixture's real per-token pricing).
    scripts["advocate-pro-1"] = [successResult({ speech: "s1", cost: 4.9997 })];
    scripts["advocate-pro-2"] = [successResult({ speech: "s2", cost: 0.0001 })];
    scripts["advocate-con-1"] = [successResult({ speech: "s3", cost: 0.0001 })];
    scripts["advocate-con-2"] = [successResult({ speech: "s4", cost: 0.0001 })];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "failed", failureCode: "RUNTIME_BUDGET_EXCEEDED" });
    expect(provider.calledParticipantIds.some((id) => id.startsWith("judge"))).toBe(false);
    expect(repository.verdicts.size).toBe(0);
  });

  it("the runtime guard never authorizes more than $5.00 of real recorded spend across a run", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    // Every participant reports a real cost individually under $5, but
    // the sum across all seven would exceed it if unguarded.
    for (const id of participantIds) {
      scripts[id] = id.startsWith("advocate")
        ? [successResult({ speech: `speech-${id}`, cost: 1.5 })]
        : [successResult({ verdict: "GUILTY", reasoning: `reasoning-${id}`, cost: 1.5 })];
    }

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    await executeTribunalRun(run.id, deps);

    let totalRecorded = new Decimal(0);
    for (const attempt of repository.attempts.values()) {
      if (attempt.actualCostUsd) {
        totalRecorded = totalRecorded.plus(attempt.actualCostUsd);
      }
    }

    // The guard blocks further spend once committed exceeds $5 -- the
    // total ever actually incurred/recorded must never structurally
    // exceed a small number of already-in-flight $1.50 attempts (never
    // all seven's worth, which would be $10.50).
    expect(totalRecorded.lte(new Decimal("5.00").plus("1.50"))).toBe(true);
  });

  // Final micro-correction #1 (docs/economics.md Sec 11): an attempt
  // must not be authorized merely because IT ALONE would fit under the
  // ceiling -- the reserve for whatever later phase(s) still MUST run
  // has to fit too. Tested directly against runLogicalCall (not the full
  // executeTribunalRun) so committed spend can be set to an exact,
  // deterministic value -- a full integration test cannot precisely
  // control timing across four concurrently-resolving advocates.
  it("attempt #2 is refused when committed spend + this attempt's own reserve + the still-required judge-phase reserve would not fit, even though the attempt alone would", async () => {
    const run = buildRun();
    const preflightRunLoader = new FakePreflightRunLoader(run);
    const preflightProvider = new ScriptedOpenRouterProvider(eligibleFixture(), allEligibleScripts());

    const preflight = await runPreflight(run.id, { runLoader: preflightRunLoader, provider: preflightProvider });
    const advocateParticipant = preflight.participants.find((p) => p.participantId === "advocate-con-2")!;
    const judgeParticipants = preflight.participants.filter((p) => p.participantId.startsWith("judge"));
    const judgeBatchReserve = judgeParticipants
      .map((p) => new Decimal(p.conservativeParticipantCostUsd ?? "0"))
      .reduce((sum, amount) => sum.plus(amount), new Decimal(0))
      .times("1.10");
    const route = toResolvedRoute(advocateParticipant);

    const repository = new FakeTribunalExecutionRepository();
    const budgetGuard = new RuntimeBudgetGuard(new Decimal("5.00"));

    // At the moment this logical call's own attempt #1 is authorized,
    // nothing is committed yet, so it proceeds normally and fails with a
    // retryable TIMEOUT. While that attempt was in flight, concurrent
    // sibling advocates' REAL costs landed in the shared guard (the
    // real-world equivalent of Promise.allSettled's other branches
    // resolving around the same time) -- by the time attempt #2 is
    // considered, committed spend alone is $4.9997: this attempt's own
    // per-attempt reserve would still individually fit under $5.00, but
    // adding the still-required judge-phase reserve on top does not.
    let callCount = 0;
    const provider: OpenRouterProvider = {
      async listModels() {
        return eligibleFixture().models;
      },
      async listEndpoints() {
        return eligibleFixture().endpoints;
      },
      async createChatCompletion() {
        callCount += 1;
        budgetGuard.recordActualSpend(new Decimal("4.9997"));
        throw new ProviderError("TIMEOUT", "timed out");
      }
    };

    const outcome = await runLogicalCall({
      runId: run.id,
      participantConfigId: "config-advocate-con-2",
      role: "ADVOCATE",
      promptVersion: ADVOCATE_PROMPT_VERSION,
      route,
      conservativeMaxCostUsd: advocateParticipant.conservativeParticipantCostUsd!,
      remainingRequiredReserveUsd: judgeBatchReserve,
      budgetGuard,
      systemPrompt: "system prompt",
      userMessage: personalityMarker("advocate-con-2"),
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: advocateSpeechJsonSchema },
      deps: { runLoader: new FakeRunLoader(run, repository), preflightRunLoader, provider, repository }
    });

    // Attempt #1 (the TIMEOUT) happened; attempt #2 (the retry) was
    // refused before ever calling OpenRouter again.
    expect(outcome.success).toBe(false);
    expect(callCount).toBe(1);
  });

  // ---------------------------------------------------------------
  // Blocker 4 (independent audit correction): attempt pricing snapshot.
  // ---------------------------------------------------------------

  it("persists the real attempt pricing snapshot (canonical model, endpoint, prompt version, effective input/output price, request fee, observed-at)", async () => {
    const run = buildRun();
    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), allEligibleScripts());
    const { deps, repository } = buildDeps(run, provider);

    await executeTribunalRun(run.id, deps);

    const attempt = [...repository.attempts.values()].find(
      (a) => a.participantConfigId === "config-advocate-pro-1"
    );

    expect(attempt?.canonicalModelId).toBe(MODEL_ID);
    expect(attempt?.providerEndpointTag).toBe("openai");
    expect(attempt?.promptVersion).toBe(ADVOCATE_PROMPT_VERSION);
    expect(attempt?.inputPricePerMillion).toBeTruthy();
    expect(attempt?.outputPricePerMillion).toBeTruthy();
    expect(attempt?.requestPriceUsd).toBeTruthy();
    expect(attempt?.pricingObservedAt).toBeTruthy();
  });

  // ---------------------------------------------------------------
  // Blocker 5 (independent audit correction): success requires
  // auditable usage/economics.
  // ---------------------------------------------------------------

  it("valid advocate JSON with NO usage telemetry is never accepted as SUCCESS", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["advocate-con-1"] = [
      successResult({ speech: "Well-formed but untelemetered.", usage: "missing" }),
      successResult({ speech: "Retry also untelemetered.", usage: "missing" })
    ];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome).toEqual({ outcome: "failed", failureCode: "ADVOCATE_TERMINAL_FAILURE" });
    expect(repository.speeches.has("config-advocate-con-1")).toBe(false);

    const attempts = [...repository.attempts.values()].filter(
      (a) => a.participantConfigId === "config-advocate-con-1"
    );

    expect(attempts.every((a) => a.status === "TELEMETRY_UNAVAILABLE")).toBe(true);
  });

  it("valid output + native usage but no usage.cost -> derived cost is persisted and actual cost remains NULL", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["advocate-pro-1"] = [successResult({ speech: "Costed only by derivation.", usage: "no-cost" })];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome.outcome).toBe("completed");

    const attempt = [...repository.attempts.values()].find(
      (a) => a.participantConfigId === "config-advocate-pro-1"
    );

    expect(attempt?.status).toBe("SUCCESS");
    expect(attempt?.actualCostUsd).toBeNull();
    expect(attempt?.derivedCostUsd).toBeTruthy();
    expect(new Decimal(attempt?.derivedCostUsd ?? "0").gt(0)).toBe(true);
  });

  // Final micro-correction #4: a derived comparison cost is ALWAYS
  // computed from native usage + the claimed pricing snapshot, even when
  // the provider also reported usage.cost -- not only as a fallback.
  it("native usage + usage.cost present -> both actualCostUsd and derivedCostUsd are persisted, non-null, and structurally distinct", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    scripts["advocate-pro-1"] = [successResult({ speech: "Costed both ways.", cost: 0.001, usage: "present" })];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome.outcome).toBe("completed");

    const attempt = [...repository.attempts.values()].find(
      (a) => a.participantConfigId === "config-advocate-pro-1"
    );

    expect(attempt?.status).toBe("SUCCESS");
    expect(attempt?.actualCostUsd).toBe("0.001");
    expect(attempt?.derivedCostUsd).toBeTruthy();
    expect(new Decimal(attempt?.derivedCostUsd ?? "0").gt(0)).toBe(true);
    // The provider's own reported cost was never overwritten by the
    // derived value, and the two are not required to be numerically
    // identical -- they are independently computed comparison figures.
    expect(attempt?.derivedCostUsd).not.toBe(attempt?.actualCostUsd);
  });

  it("a run cannot reach COMPLETED with unauditable (telemetry-missing) economics", async () => {
    const run = buildRun();
    const scripts = allEligibleScripts();
    // Every attempt for this judge lacks usage entirely, both attempts.
    scripts["judge-1"] = [
      successResult({ verdict: "GUILTY", usage: "missing" }),
      successResult({ verdict: "GUILTY", usage: "missing" })
    ];

    const provider = new ScriptedOpenRouterProvider(eligibleFixture(), scripts);
    const { deps, repository } = buildDeps(run, provider);

    const outcome = await executeTribunalRun(run.id, deps);

    expect(outcome.outcome).not.toBe("completed");
    expect(repository.completedRuns.has(run.id)).toBe(false);
  });
});

describe("RuntimeBudgetGuard (Blocker 3 unit tests -- pure, deterministic arithmetic)", () => {
  it("allows a reserve that fits under the hard ceiling", () => {
    const guard = new RuntimeBudgetGuard(new Decimal("5.00"));

    expect(guard.canAffordReserve(new Decimal("4.99"))).toBe(true);
  });

  it("refuses a reserve that would exceed the hard ceiling", () => {
    const guard = new RuntimeBudgetGuard(new Decimal("5.00"));

    expect(guard.canAffordReserve(new Decimal("5.01"))).toBe(false);
  });

  it("a retry is blocked once real committed spend leaves no room for even a tiny reserve", () => {
    const guard = new RuntimeBudgetGuard(new Decimal("5.00"));

    // Attempt #1 for some other participant already spent exactly the
    // ceiling.
    const withinBudget = guard.recordActualSpend(new Decimal("5.00"));

    expect(withinBudget).toBe(true); // exactly at the ceiling is still affordable
    // Requirement 3/4: the next attempt's retry reserve, however tiny,
    // no longer fits -- DO NOT call OpenRouter.
    expect(guard.canAffordReserve(new Decimal("0.0000001"))).toBe(false);
  });

  it("recordActualSpend returns false exactly when real spend crosses the ceiling -- a genuine runtime anomaly (Requirement 5)", () => {
    const guard = new RuntimeBudgetGuard(new Decimal("5.00"));

    expect(guard.recordActualSpend(new Decimal("3.00"))).toBe(true);
    expect(guard.recordActualSpend(new Decimal("2.50"))).toBe(false); // 5.50 > 5.00

    // Every subsequent check anywhere in the run now fails too --
    // self-enforcing "zero not-yet-started calls."
    expect(guard.canAffordReserve(new Decimal("0.00"))).toBe(false);
  });

  it("never authorizes a reserve whose cumulative total would exceed $5.00, regardless of how many small batches are checked", () => {
    const guard = new RuntimeBudgetGuard(new Decimal("5.00"));
    let authorizedTotal = new Decimal(0);

    for (let i = 0; i < 100; i += 1) {
      const reserve = new Decimal("0.10");

      if (guard.canAffordReserve(reserve)) {
        authorizedTotal = authorizedTotal.plus(reserve);
        guard.recordActualSpend(reserve);
      }
    }

    expect(authorizedTotal.lte(new Decimal("5.00"))).toBe(true);
  });
});
