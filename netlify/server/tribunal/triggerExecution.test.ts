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

  // Blocker 2: M8 is Shared-Model only. A SEPARATE run must never reach
  // the worker or make any provider call, even with a valid connected
  // credential.
  it("SEPARATE mode + valid credential -> zero worker invocation, zero OpenRouter call of any kind", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const run = { ...eligibleRun(), executionMode: "separate" as const };

    const result = await triggerExecutionIfEligible(run, "sk-or-v1-user-key", {
      runRepository: fakeRunRepository(run),
      caseRepository: fakeCaseRepository(),
      tribunalRepository: new FakeTribunalExecutionRepository()
    });

    expect(result).toEqual({ invoked: false, reason: "separate_mode_not_enabled" });
    expect(fetchMock).not.toHaveBeenCalled();
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
