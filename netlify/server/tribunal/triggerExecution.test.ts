// Milestone 8 -- the synchronous POST /api/runs execution-trigger gate.
// buildUserScopedProviders constructs a REAL RealOpenRouterProvider when
// a key is supplied (the same M7A factory, not reimplemented), so these
// tests mock global fetch itself -- distinguishing OpenRouter metadata
// calls (openrouter.ai) from the one server-to-server Background
// Function invocation (this deployment's own trusted origin) by URL,
// exactly like the real two different destinations.

import { afterEach, describe, expect, it, vi } from "vitest";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "../../../src/prompts/versions";
import { participantIds } from "../../../src/schemas/tribunalSetup";
import type { CaseRepository } from "../cases";
import type { PersistedRun, RunRepository } from "../runs";
import { FakeTribunalExecutionRepository } from "./repository";
import { triggerExecutionIfEligible } from "./triggerExecution";
import { INTERNAL_FUNCTION_SECRET_HEADER } from "./internalSecret";
import { USER_OPENROUTER_KEY_HEADER } from "../extraction/userOpenRouterKey";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";
const MODEL_ID = "openai/gpt-5";
const TRUSTED_BASE_URL = "https://the-tribunal-real-deployment.netlify.app";

function baseRun(): PersistedRun {
  return {
    id: RUN_ID,
    caseId: CASE_ID,
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
    // Milestone 10 -- read-path-only derived/exposed fields, never read
    // by triggerExecution.ts itself; neutral defaults.
    totalInputTokens: null,
    totalOutputTokens: null,
    totalTokens: null,
    logicalCallCount: 0,
    providerAttemptCount: 0,
    wallClockMs: null,
    partialSpend: null,
    admission: null,
    attempts: [],
    protocol: null,
    participants: []
  };
}

function readyRun(): PersistedRun {
  return baseRun();
}

// A run whose seven participants resolve to an eligible route under the
// eligible-model fetch mock below.
function eligibleRun(): PersistedRun {
  return {
    ...baseRun(),
    participants: participantIds.map((id) => ({
      id: `config-${id}`,
      participantId: id,
      role: id.startsWith("advocate") ? "ADVOCATE" : "JUDGE",
      side: id.includes("-pro-") ? "PRO" : id.includes("-con-") ? "CON" : null,
      profileName: null,
      personality: "A measured, professional demeanor.",
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

function eligibleOpenRouterResponse(url: string): Response | null {
  if (url.endsWith("/models")) {
    return new Response(
      JSON.stringify({
        data: [{ id: MODEL_ID, canonical_slug: MODEL_ID, name: "Model", context_length: 200_000 }]
      }),
      { status: 200 }
    );
  }

  if (url.includes("/endpoints")) {
    return new Response(
      JSON.stringify({
        data: {
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
        }
      }),
      { status: 200 }
    );
  }

  return null;
}

function fakeRunRepository(run: PersistedRun): RunRepository {
  return {
    async freeze() {
      throw new Error("not used in these tests");
    },
    async getById() {
      return run;
    },
    // Milestone 11 -- not exercised by these execution-trigger tests;
    // present only to satisfy the RunRepository contract.
    async listByCaseId() {
      return [];
    }
  };
}

function fakeCaseRepository(): CaseRepository {
  return {
    async create() {
      throw new Error("not used in these tests");
    },
    async list() {
      return [];
    },
    async getById() {
      return {
        id: CASE_ID,
        defendant: "Alex Rowan",
        act: "Entered the restricted lab.",
        exactQuestion: "Did Alex knowingly violate the lab protocol?",
        sourceType: "MANUAL",
        sourceFilename: null,
        createdAt: "2026-08-29T00:00:00.000Z"
      };
    }
  };
}

// Empty model catalog -> resolveModelRoute finds zero candidate
// endpoints for the run's participants -> ineligible. Used for the
// blocked_budget case since a real run here has zero participants (the
// fixture keeps it minimal); an empty candidate set is exactly as
// ineligible as an expensive one for this gate's purposes.
function mockFetchIneligible() {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("openrouter.ai")) {
      return Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    }

    return Promise.resolve(new Response("{}", { status: 202 }));
  });
}

describe("triggerExecutionIfEligible", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no user credential -> not_connected, zero preflight/fetch calls", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await triggerExecutionIfEligible(readyRun(), null, {
      runRepository: fakeRunRepository(readyRun()),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: new FakeTribunalExecutionRepository()
    });

    expect(result).toEqual({ invoked: false, reason: "not_connected" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("run not READY -> not_connected (never re-triggers a run whose execution already started)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const run = { ...readyRun(), status: "ADVOCATES_RUNNING" };

    const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: new FakeTribunalExecutionRepository()
    });

    expect(result.invoked).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // M9 (Separate-Model Tribunal, Issue #20), Test Plan item P: the M8-
  // only "reject every SEPARATE run outright" gate is gone -- a SEPARATE
  // run with an eligible preflight reaches the worker exactly like a
  // SHARED run does. (Whether the seven seats share one model or use
  // several is irrelevant here -- this module never inspects individual
  // participant model IDs, only run.status and the preflight/credential
  // gates; the mixed-model case is covered end-to-end in
  // execution.test.ts.)
  it("SEPARATE mode + eligible preflight + valid credential -> invoked, identically to SHARED mode", async () => {
    vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const openRouterResponse = eligibleOpenRouterResponse(url);

      if (openRouterResponse) {
        return Promise.resolve(openRouterResponse);
      }

      return Promise.resolve(new Response("{}", { status: 202 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = { ...eligibleRun(), executionMode: "separate" as const };
    const repository = new FakeTribunalExecutionRepository();
    repository.setRunStatus(RUN_ID, "READY");

    const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: repository,
      backgroundFunctionBaseUrl: TRUSTED_BASE_URL
    });

    expect(result).toEqual({ invoked: true });
  });

  it("ineligible preflight -> blocked_budget, zero worker invocation, blockBudget RPC called", async () => {
    vi.stubGlobal("fetch", mockFetchIneligible());

    // Seven real participants, but the mocked catalog/endpoints are
    // empty, so the configured model resolves to nothing -- ineligible,
    // not a participant-count/shape error (which would throw instead of
    // returning a graceful ineligible result).
    const run = eligibleRun();
    const repository = new FakeTribunalExecutionRepository();
    repository.setRunStatus(RUN_ID, "READY");

    const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: repository
    });

    expect(result.invoked).toBe(false);
    expect(repository.runStatus.get(RUN_ID)).toBe("BLOCKED_BUDGET");
  });

  it("eligible run -> invoked, and the worker invocation carries the internal secret + the user's own key (never the operator's) as headers, runId in the body, destination from trusted config", async () => {
    vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const openRouterResponse = eligibleOpenRouterResponse(url);

      if (openRouterResponse) {
        return Promise.resolve(openRouterResponse);
      }

      return Promise.resolve(new Response("{}", { status: 202 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = eligibleRun();
    const repository = new FakeTribunalExecutionRepository();
    repository.setRunStatus(RUN_ID, "READY");

    const result = await triggerExecutionIfEligible(run, "sk-or-v1-the-users-own-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: repository,
      backgroundFunctionBaseUrl: TRUSTED_BASE_URL
    });

    expect(result).toEqual({ invoked: true });

    const workerCall = fetchMock.mock.calls.find(
      (call) => !(call[0] as string).includes("openrouter.ai")
    );

    expect(workerCall).toBeDefined();
    const [url, init] = workerCall as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(url).toBe(`${TRUSTED_BASE_URL}/.netlify/functions/tribunal-execute-background`);
    expect(headers[INTERNAL_FUNCTION_SECRET_HEADER]).toBe("test-internal-secret");
    expect(headers[USER_OPENROUTER_KEY_HEADER]).toBe("sk-or-v1-the-users-own-key");
    expect(JSON.parse(init.body as string)).toEqual({ runId: RUN_ID });
  });

  // Blocker 7 regression: the destination must come from trusted
  // server-side config (process.env.URL / the injected override), never
  // from any caller-supplied request data. There is no code path in
  // triggerExecutionIfEligible's signature that even accepts a Host or
  // X-Forwarded-Proto value anymore -- this test proves the resolved
  // destination is controlled entirely by server config, by showing an
  // "attacker" value has no way to reach the URL: the function accepts
  // no request/event parameter at all, only the explicit trusted
  // deps.backgroundFunctionBaseUrl override (or, when omitted, the real
  // readBackgroundFunctionBaseUrl() env accessor).
  it("attacker-controlled request data cannot influence the worker destination -- only trusted server config can", async () => {
    vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
    vi.stubEnv("URL", "https://attacker-cannot-set-this-env-var.example");

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const openRouterResponse = eligibleOpenRouterResponse(url);

      return Promise.resolve(openRouterResponse ?? new Response("{}", { status: 202 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = eligibleRun();
    const repository = new FakeTribunalExecutionRepository();
    repository.setRunStatus(RUN_ID, "READY");

    // No event/Host/X-Forwarded-Proto parameter exists in this call at
    // all -- the destination can only ever come from deps or real env.
    await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: repository
    });

    const workerCall = fetchMock.mock.calls.find(
      (call) => !(call[0] as string).includes("openrouter.ai")
    );
    const [url] = workerCall as [string, RequestInit];

    expect(url).toBe(
      "https://attacker-cannot-set-this-env-var.example/.netlify/functions/tribunal-execute-background"
    );
  });

  it("missing INTERNAL_FUNCTION_SECRET server config -> invocation_failed, no worker call attempted", async () => {
    vi.stubEnv("INTERNAL_FUNCTION_SECRET", "");

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const openRouterResponse = eligibleOpenRouterResponse(url);

      return Promise.resolve(openRouterResponse ?? new Response("{}", { status: 202 }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = eligibleRun();
    const repository = new FakeTribunalExecutionRepository();
    repository.setRunStatus(RUN_ID, "READY");

    const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: repository
    });

    expect(result).toEqual({ invoked: false, reason: "invocation_failed" });
    expect(
      fetchMock.mock.calls.every((call) => (call[0] as string).includes("openrouter.ai"))
    ).toBe(true);
  });

  // Final micro-correction #2: a resolved fetch is not proof of
  // acceptance -- only an actual HTTP 202 (Netlify's own documented
  // Background Function acceptance status) may report invoked: true.
  // OpenRouter metadata responses are unrelated to this check and stay
  // eligible throughout every case below.
  describe("worker invocation HTTP acceptance (final micro-correction #2)", () => {
    function fetchMockReturning(workerStatus: number) {
      return vi.fn().mockImplementation((url: string) => {
        const openRouterResponse = eligibleOpenRouterResponse(url);

        if (openRouterResponse) {
          return Promise.resolve(openRouterResponse);
        }

        return Promise.resolve(new Response("{}", { status: workerStatus }));
      });
    }

    it("202 -> invoked: true", async () => {
      vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
      vi.stubGlobal("fetch", fetchMockReturning(202));

      const run = eligibleRun();
      const repository = new FakeTribunalExecutionRepository();
      repository.setRunStatus(RUN_ID, "READY");

      const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
        runRepository: fakeRunRepository(run),
        caseRepository: fakeCaseRepository(),
        tribunalRepository: repository,
        backgroundFunctionBaseUrl: TRUSTED_BASE_URL
      });

      expect(result).toEqual({ invoked: true });
    });

    it("404 -> invocation_failed, run stays READY", async () => {
      vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
      vi.stubGlobal("fetch", fetchMockReturning(404));

      const run = eligibleRun();
      const repository = new FakeTribunalExecutionRepository();
      repository.setRunStatus(RUN_ID, "READY");

      const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
        runRepository: fakeRunRepository(run),
        caseRepository: fakeCaseRepository(),
        tribunalRepository: repository,
        backgroundFunctionBaseUrl: TRUSTED_BASE_URL
      });

      expect(result).toEqual({ invoked: false, reason: "invocation_failed" });
      expect(repository.runStatus.get(RUN_ID)).toBe("READY");
    });

    it("500 -> invocation_failed, run stays READY", async () => {
      vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
      vi.stubGlobal("fetch", fetchMockReturning(500));

      const run = eligibleRun();
      const repository = new FakeTribunalExecutionRepository();
      repository.setRunStatus(RUN_ID, "READY");

      const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
        runRepository: fakeRunRepository(run),
        caseRepository: fakeCaseRepository(),
        tribunalRepository: repository,
        backgroundFunctionBaseUrl: TRUSTED_BASE_URL
      });

      expect(result).toEqual({ invoked: false, reason: "invocation_failed" });
      expect(repository.runStatus.get(RUN_ID)).toBe("READY");
    });

    it("network rejection calling the worker -> invocation_failed, run stays READY", async () => {
      vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation((url: string) => {
          const openRouterResponse = eligibleOpenRouterResponse(url);

          if (openRouterResponse) {
            return Promise.resolve(openRouterResponse);
          }

          return Promise.reject(new TypeError("Failed to fetch"));
        })
      );

      const run = eligibleRun();
      const repository = new FakeTribunalExecutionRepository();
      repository.setRunStatus(RUN_ID, "READY");

      const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
        runRepository: fakeRunRepository(run),
        caseRepository: fakeCaseRepository(),
        tribunalRepository: repository,
        backgroundFunctionBaseUrl: TRUSTED_BASE_URL
      });

      expect(result).toEqual({ invoked: false, reason: "invocation_failed" });
      expect(repository.runStatus.get(RUN_ID)).toBe("READY");
    });
  });
});

// Milestone 12 (human product override, PR #34 final correction) --
// the OPTIONAL additionalMaxCostUsd gate. Priced deliberately above the
// Jon Snow demo's $0.13 ceiling but comfortably under the generic
// $5.00 ceiling, so these tests prove the two gates are genuinely
// independent, not merely that a cheap run passes both.
function moderatelyExpensiveOpenRouterResponse(url: string): Response | null {
  if (url.endsWith("/models")) {
    return new Response(
      JSON.stringify({
        data: [{ id: MODEL_ID, canonical_slug: MODEL_ID, name: "Model", context_length: 200_000 }]
      }),
      { status: 200 }
    );
  }

  if (url.includes("/endpoints")) {
    return new Response(
      JSON.stringify({
        data: {
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
              // Empirically verified against this exact fixture:
              // conservativeMaxCostUsd ~= $1.00 -- comfortably above
              // $0.13, comfortably below the $5.00 generic ceiling
              // (eligible=true), so these tests actually exercise the
              // new gate rather than accidentally tripping the existing
              // $5 one.
              pricing: { prompt: "0.0000135", completion: "0.000027" }
            }
          ]
        }
      }),
      { status: 200 }
    );
  }

  return null;
}

describe("triggerExecutionIfEligible -- additionalMaxCostUsd (Milestone 12, PR #34 final correction)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // B: a generic caller (no additionalMaxCostUsd set -- exactly like
  // every /api/runs call today) must be completely unaffected by this
  // gate's existence, even for a run priced well above the Jon Snow
  // demo's own $0.13 ceiling -- proving the new parameter is an opt-in
  // no-op, not a behavior change for existing callers.
  it("B: a generic caller without additionalMaxCostUsd is invoked normally even when cost exceeds the (unset) demo ceiling, following only the existing $5 ceiling", async () => {
    vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        const openRouterResponse = moderatelyExpensiveOpenRouterResponse(url);

        return Promise.resolve(openRouterResponse ?? new Response("{}", { status: 202 }));
      })
    );

    const run = eligibleRun();
    const repository = new FakeTribunalExecutionRepository();
    repository.setRunStatus(RUN_ID, "READY");

    const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: repository,
      backgroundFunctionBaseUrl: TRUSTED_BASE_URL
      // additionalMaxCostUsd deliberately omitted.
    });

    expect(result).toEqual({ invoked: true });
    expect(repository.runStatus.get(RUN_ID)).not.toBe("BLOCKED_BUDGET");
  });

  // The demo-cap counterpart of B, at this primitive's own level (the
  // functions/__tests__/demo-jon-snow-runs.test.ts file proves the same
  // thing through the real endpoint) -- the identically-priced run IS
  // blocked, with zero worker invocation, once a caller opts in.
  it("a caller that DOES set additionalMaxCostUsd is blocked before worker invocation for the same moderately-priced run that B leaves unaffected", async () => {
    vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      const openRouterResponse = moderatelyExpensiveOpenRouterResponse(url);

      if (openRouterResponse) {
        return Promise.resolve(openRouterResponse);
      }

      throw new Error(`Unexpected fetch to ${url}: worker must not be invoked once the demo cap blocks execution.`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const run = eligibleRun();
    const repository = new FakeTribunalExecutionRepository();
    repository.setRunStatus(RUN_ID, "READY");

    const result = await triggerExecutionIfEligible(run, "sk-or-v1-demo-operator-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: repository,
      backgroundFunctionBaseUrl: TRUSTED_BASE_URL,
      additionalMaxCostUsd: "0.13"
    });

    expect(result.invoked).toBe(false);
    if (!result.invoked) {
      expect(result.reason).toBe("blocked_budget");
      if (result.reason === "blocked_budget") {
        expect(result.blockedReasonCodes).toEqual(["DEMO_BUDGET_EXCEEDED"]);
      }
    }
    expect(repository.runStatus.get(RUN_ID)).toBe("BLOCKED_BUDGET");
    // Only the two metadata calls -- the worker was never invoked.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
