// Milestone 12 (human product override, PR #34 Sec 29) -- server
// security tests for the dedicated, operator-funded, canonical-only Jon
// Snow demo endpoint. Every test uses fakes only (FakeOpenRouterProvider,
// FakeTribunalExecutionRepository, in-memory case/run repositories) --
// no real network, no real database, no real model call.
import type { HandlerEvent } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IdempotencyConflictError,
  type CreateCaseInput,
  type IdempotentCaseRepository,
  type PersistedCase
} from "../../server/cases";
import { readJonSnowDemoServerConfig, ServerConfigError } from "../../server/env";
import { FakeOpenRouterProvider } from "../../server/openrouter/fakeProvider";
import { RunPersistenceError, type FreezeRunInput, type PersistedRun, type RunRepository, type RunSummary } from "../../server/runs";
import { FakeTribunalExecutionRepository } from "../../server/tribunal/repository";
import { JON_SNOW_DEMO_ACCESS_HEADER } from "../../server/tribunal/demoAccess";
import { handleDemoJonSnowRunsRequest, type HandleDemoJonSnowRunsDeps } from "../demo-jon-snow-runs";
import { handleRunsRequest } from "../runs";
import { FakeAdmissionControl } from "../../server/admissionControl";
import { JON_SNOW_DEMO_RUN_START_RATE_LIMIT } from "../../server/tribunal/rateLimitPolicy";

// >= 32 chars (netlify/server/env.ts's JON_SNOW_DEMO_ACCESS_TOKEN
// minimum) -- deliberately well over the boundary, not merely at it.
const DEMO_ACCESS_TOKEN = "fake-demo-access-token-for-tests-well-over-the-minimum-length";
const DEMO_OPENROUTER_KEY = "sk-or-v1-fake-demo-operator-key-for-tests";

function cheapModel(overrides: Partial<import("../../server/openrouter/schemas").RawOpenRouterModel> = {}) {
  return {
    id: "openai/gpt-4o-mini",
    canonical_slug: "openai/gpt-4o-mini",
    name: "GPT-4o mini",
    ...overrides
  };
}

function cheapEndpoint(overrides: Record<string, unknown> = {}) {
  return {
    tag: "openai",
    provider_name: "OpenAI",
    name: "OpenAI | GPT-4o mini",
    context_length: 128_000,
    max_prompt_tokens: 100_000,
    max_completion_tokens: 4000,
    supported_parameters: ["response_format", "max_completion_tokens"],
    quantization: null,
    status: 0,
    // Deliberately tiny per-token pricing -- well under the $0.13 demo
    // ceiling once discovery's worst-case token estimate is applied.
    pricing: { prompt: "0.0000001", completion: "0.0000002" },
    ...overrides
  };
}

function expensiveEndpoint() {
  // Priced so the conservative full-Tribunal estimate lands comfortably
  // above $0.13 -- proves the server-side estimate re-check, not merely
  // catalog membership.
  return cheapEndpoint({ pricing: { prompt: "0.01", completion: "0.02" } });
}

class FakeIdempotentCaseRepository implements IdempotentCaseRepository {
  private readonly byConveneRequestId = new Map<string, PersistedCase>();
  private readonly byId = new Map<string, PersistedCase>();

  async create(): Promise<PersistedCase> {
    throw new Error("not used in these tests");
  }

  async list(): Promise<PersistedCase[]> {
    return [];
  }

  async getById(id: string): Promise<PersistedCase | null> {
    return this.byId.get(id) ?? null;
  }

  async createIdempotent(input: CreateCaseInput, conveneRequestId: string): Promise<PersistedCase> {
    const existing = this.byConveneRequestId.get(conveneRequestId);

    if (existing) {
      const matches =
        existing.defendant === input.defendant &&
        existing.act === input.act &&
        existing.exactQuestion === input.exactQuestion &&
        existing.sourceType === input.sourceType;

      if (matches) {
        return existing;
      }

      throw new IdempotencyConflictError();
    }

    const created: PersistedCase = {
      id: randomUUID(),
      defendant: input.defendant,
      act: input.act,
      exactQuestion: input.exactQuestion,
      sourceType: input.sourceType,
      sourceFilename: input.sourceType === "MANUAL" ? null : input.sourceFilename,
      createdAt: "2026-09-03T10:00:00.000Z"
    };

    this.byConveneRequestId.set(conveneRequestId, created);
    this.byId.set(created.id, created);

    return created;
  }
}

// Mirrors netlify/functions/__tests__/runs.test.ts's own FakeRunRepository
// exactly (participant role/side derivation, idempotent freeze-by-
// clientRequestId) -- an independent in-memory simulation, not a shared
// import, so this file's expectations are self-contained.
class FakeRunRepository implements RunRepository {
  private readonly byClientRequestId = new Map<string, { run: PersistedRun; fingerprint: string }>();
  freezeCallCount = 0;
  lastFreezeInput: FreezeRunInput | null = null;

  async freeze(input: FreezeRunInput): Promise<PersistedRun> {
    this.freezeCallCount += 1;
    this.lastFreezeInput = input;

    const existing = this.byClientRequestId.get(input.clientRequestId);

    if (existing) {
      if (existing.fingerprint === input.requestFingerprint) {
        return existing.run;
      }

      throw new IdempotencyConflictError();
    }

    if (input.participants.length !== 7) {
      throw new RunPersistenceError("exactly seven participant configs required");
    }

    const run: PersistedRun = {
      id: randomUUID(),
      caseId: input.caseId,
      clientRequestId: input.clientRequestId,
      executionMode: input.executionMode === "SHARED" ? "shared" : "separate",
      status: "READY",
      createdAt: "2026-09-03T10:05:00.000Z",
      startedAt: null,
      completedAt: null,
      majorityVerdict: null,
      failureCode: null,
      failureMessage: null,
      totalCostUsd: null,
      advocateCostUsd: null,
      judgeCostUsd: null,
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
      participants: input.participants.map((entry) => ({
        id: randomUUID(),
        participantId: entry.participantId,
        role: entry.participantId.startsWith("advocate") ? "ADVOCATE" : "JUDGE",
        side: entry.participantId.includes("pro") ? "PRO" : entry.participantId.includes("con") ? "CON" : null,
        profileName: entry.profileName,
        personality: entry.personality,
        personalitySource: entry.personalitySource,
        personalitySourceFilename: entry.personalitySourceFilename,
        modelId: entry.modelId,
        promptVersion: entry.participantId.startsWith("advocate") ? "advocate-v2" : "judge-v2",
        attemptStatus: "PENDING",
        speech: null,
        verdict: null,
        reasoning: null
      }))
    };

    this.byClientRequestId.set(input.clientRequestId, { run, fingerprint: input.requestFingerprint });

    return run;
  }

  async getById(id: string): Promise<PersistedRun | null> {
    for (const { run } of this.byClientRequestId.values()) {
      if (run.id === id) {
        return run;
      }
    }

    return null;
  }

  async listByCaseId(): Promise<RunSummary[]> {
    return [];
  }
}

function validAccessHeaders(): Record<string, string> {
  return { [JON_SNOW_DEMO_ACCESS_HEADER]: DEMO_ACCESS_TOKEN };
}

function baseDeps(overrides: Partial<HandleDemoJonSnowRunsDeps> = {}): HandleDemoJonSnowRunsDeps {
  const provider = new FakeOpenRouterProvider();

  provider.listModelsResult = [cheapModel()];
  provider.listEndpointsResult["openai/gpt-4o-mini"] = [cheapEndpoint()];

  return {
    caseRepository: new FakeIdempotentCaseRepository(),
    runRepository: new FakeRunRepository(),
    tribunalRepository: new FakeTribunalExecutionRepository(),
    modelDiscovery: { provider },
    readDemoConfig: () => ({
      JON_SNOW_DEMO_OPENROUTER_API_KEY: DEMO_OPENROUTER_KEY,
      JON_SNOW_DEMO_ACCESS_TOKEN: DEMO_ACCESS_TOKEN
    }),
    ...overrides
  };
}

// triggerExecutionIfEligible's own preflight re-check constructs a REAL
// RealOpenRouterProvider from the operator's demo credential string
// (buildUserScopedProviders) -- global fetch, not the injected
// `fetchImpl` (which only covers the final worker-invocation call), must
// be stubbed for any test that expects the freeze to succeed and reach
// that step.
function stubEligibleExecutionFetch() {
  vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      const openRouterResponse = eligibleOpenRouterResponse(url);

      return Promise.resolve(openRouterResponse ?? new Response("{}", { status: 202 }));
    })
  );
}

// Final independent-review correction (scenario A): the AUTHORITATIVE
// preflight re-check triggerExecutionIfEligible performs with the real
// demo credential -- deliberately priced so its conservativeMaxCostUsd
// lands above $0.13, simulating a price change that happened after the
// earlier (possibly-cached) listEligibleModels() discovery check already
// passed.
function stubExpensiveExecutionFetch() {
  vi.stubEnv("INTERNAL_FUNCTION_SECRET", "test-internal-secret");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/models")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: [{ id: "openai/gpt-4o-mini", canonical_slug: "openai/gpt-4o-mini", name: "Model", context_length: 200_000 }]
            }),
            { status: 200 }
          )
        );
      }

      if (url.includes("/endpoints")) {
        return Promise.resolve(
          new Response(
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
                    // Empirically verified against the real canonical
                    // Jon Snow participants: conservativeMaxCostUsd
                    // ~= $1.39 -- comfortably above $0.13, comfortably
                    // below the $5.00 generic ceiling (eligible=true),
                    // so this scenario actually exercises the new demo
                    // gate rather than accidentally tripping the
                    // existing $5 one.
                    pricing: { prompt: "0.0000135", completion: "0.000027" }
                  }
                ]
              }
            }),
            { status: 200 }
          )
        );
      }

      // The worker-invocation call must never be reached in this
      // scenario -- fail loudly if it is.
      throw new Error(`Unexpected fetch to ${url}: worker must not be invoked when authoritative pricing exceeds the demo ceiling.`);
    })
  );
}

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    clientRequestId: randomUUID(),
    modelId: "openai/gpt-4o-mini",
    ...overrides
  });
}

// Real RealOpenRouterProvider HTTP response shape (matches
// triggerExecution.test.ts's own eligibleOpenRouterResponse fixture) --
// triggerExecutionIfEligible's preflight re-check constructs a REAL
// provider from the operator's demo credential string, so intercepting
// global fetch (not merely the injected fetchImpl, which only covers the
// final worker-invocation call) is required to keep this deterministic
// and network-free.
function eligibleOpenRouterResponse(url: string): Response | null {
  if (url.endsWith("/models")) {
    return new Response(
      JSON.stringify({
        data: [{ id: "openai/gpt-4o-mini", canonical_slug: "openai/gpt-4o-mini", name: "Model", context_length: 200_000 }]
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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/demo/jon-snow/runs -- access capability", () => {
  it("A: missing demo access token is rejected with zero case/run creation and zero provider execution", async () => {
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: {}, body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(401);
    expect((deps.runRepository as FakeRunRepository).freezeCallCount).toBe(0);
    expect((deps.tribunalRepository as FakeTribunalExecutionRepository).runStatus.size).toBe(0);
  });

  it("B: an invalid demo access token is rejected identically to a missing one -- zero provider execution", async () => {
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      {
        httpMethod: "POST",
        headers: { [JON_SNOW_DEMO_ACCESS_HEADER]: "not-the-real-token" },
        body: validBody()
      } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(401);
    expect((deps.runRepository as FakeRunRepository).freezeCallCount).toBe(0);
  });

  it("C: a missing/invalid JON_SNOW_DEMO_OPENROUTER_API_KEY fails safely with zero provider execution", async () => {
    const deps = baseDeps({
      readDemoConfig: () => {
        throw new Error("Missing or invalid Jon Snow demo server configuration.");
      }
    });

    const response = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(503);
    expect((deps.runRepository as FakeRunRepository).freezeCallCount).toBe(0);
  });
});

describe("POST /api/demo/jon-snow/runs -- canonical-only contract", () => {
  it("D: an arbitrary case payload cannot be used -- the endpoint rejects unknown fields and always uses the canonical case", async () => {
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      {
        httpMethod: "POST",
        headers: validAccessHeaders(),
        body: validBody({
          case: { kind: "new", case: { defendant: "Attacker-Controlled", act: "x", exactQuestion: "x?", sourceType: "MANUAL" } }
        })
      } as unknown as HandlerEvent,
      deps
    );

    // The strict input schema rejects the extra `case` field outright --
    // it never silently ignores it and falls back to canonical data.
    expect(response.statusCode).toBe(400);
  });

  it("E: an arbitrary participant personality/profile payload cannot be used", async () => {
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      {
        httpMethod: "POST",
        headers: validAccessHeaders(),
        body: validBody({
          participants: [{ participantId: "advocate-pro-1", personality: "Attacker text", personalitySource: "manual", modelId: "openai/gpt-4o-mini" }]
        })
      } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(400);
  });

  it("F: Separate Mode cannot be selected -- the endpoint accepts no executionMode field at all", async () => {
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      {
        httpMethod: "POST",
        headers: validAccessHeaders(),
        body: validBody({ executionMode: "separate" })
      } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(400);
  });

  it("uses the exact canonical Charge Sheet and all seven fixed participants regardless of any payload noise rejected above", async () => {
    stubEligibleExecutionFetch();
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(201);
    const freezeInput = (deps.runRepository as FakeRunRepository).lastFreezeInput!;

    expect(freezeInput.participants).toHaveLength(7);
    expect(freezeInput.executionMode).toBe("SHARED");
  });
});

describe("POST /api/demo/jon-snow/runs -- cost policy", () => {
  it("G: a selected model whose current conservative estimate exceeds $0.13 is blocked server-side with zero completion", async () => {
    const provider = new FakeOpenRouterProvider();

    provider.listModelsResult = [cheapModel()];
    provider.listEndpointsResult["openai/gpt-4o-mini"] = [expensiveEndpoint()];

    const deps = baseDeps({ modelDiscovery: { provider } });

    const response = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(400);
    expect((deps.runRepository as FakeRunRepository).freezeCallCount).toBe(0);
    expect((deps.tribunalRepository as FakeTribunalExecutionRepository).runStatus.size).toBe(0);
  });

  it("rejects a modelId that is not in the current eligible catalog at all, regardless of client-supplied price claims", async () => {
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      {
        httpMethod: "POST",
        headers: validAccessHeaders(),
        body: validBody({ modelId: "not/a-real-model" })
      } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(400);
    expect((deps.runRepository as FakeRunRepository).freezeCallCount).toBe(0);
  });

  // A: final independent-review correction. The early listEligibleModels()
  // check (FakeOpenRouterProvider, baseDeps' cheap fixture) says the
  // model is within $0.13 -- but the AUTHORITATIVE preflight re-check
  // inside triggerExecutionIfEligible (stubExpensiveExecutionFetch,
  // simulating a price change during the metadata cache's TTL) reports a
  // fresh conservative cost above $0.13. The run must freeze (the early
  // check passed, so acceptRun proceeds) but execution must be blocked
  // before the worker is ever invoked -- zero completion.
  it("A: blocks execution when the authoritative final preflight reports a fresh cost above $0.13, even though the earlier discovery check passed", async () => {
    stubExpensiveExecutionFetch();
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.body ?? "{}");

    // The run WAS frozen (the early, possibly-stale check passed)...
    expect((deps.runRepository as FakeRunRepository).freezeCallCount).toBe(1);
    // ...but execution was blocked by the authoritative, fresh re-check,
    // before the worker was ever invoked -- zero completion. Proven by
    // exactly two fetch calls (GET .../models, GET .../endpoints) and no
    // third call to the background worker at all -- stubExpensiveExecutionFetch
    // throws if any other URL is requested, which would have failed this
    // test with an uncaught error had the gate not fired first.
    expect(payload.executionTriggered).toBe(false);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/demo/jon-snow/runs -- happy path reuses the existing engine", () => {
  it("H: a valid canonical demo request with an allowed cheap model and a valid capability reaches the same trigger/execution path", async () => {
    stubEligibleExecutionFetch();
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.body ?? "{}");

    // The SAME triggerExecutionIfEligible every other Tribunal run uses
    // -- a real (fake-network) worker invocation was accepted, proving
    // this reused the existing path rather than a parallel engine.
    expect(payload.executionTriggered).toBe(true);
    expect(payload.run.status).toBe("READY");
  });
});

describe("generic /api/runs boundary", () => {
  it("I: the generic endpoint never reads or accepts the operator demo key as a fallback -- an unconnected generic request stays READY with zero execution", async () => {
    const caseRepository = new FakeIdempotentCaseRepository();
    const runRepository = new FakeRunRepository();

    const response = await handleRunsRequest(
      {
        httpMethod: "POST",
        headers: {}, // no X-User-OpenRouter-Key, and no demo access header either
        body: JSON.stringify({
          clientRequestId: randomUUID(),
          case: { kind: "new", case: { defendant: "Alex", act: "Act.", exactQuestion: "Q?", sourceType: "MANUAL" } },
          executionMode: "shared",
          participants: [
            "advocate-pro-1",
            "advocate-pro-2",
            "advocate-con-1",
            "advocate-con-2",
            "judge-1",
            "judge-2",
            "judge-3"
          ].map((participantId) => ({
            participantId,
            personality: `Personality for ${participantId}.`,
            personalitySource: "manual",
            modelId: "openai/gpt-4o-mini"
          }))
        })
      } as unknown as HandlerEvent,
      { caseRepository, runRepository, tribunalRepository: new FakeTribunalExecutionRepository() }
    );

    expect(response.statusCode).toBe(201);
    const payload = JSON.parse(response.body ?? "{}");

    expect(payload.executionTriggered).toBe(false);
    expect(payload.run.status).toBe("READY");
    // Never fell back to a demo/operator credential -- the generic
    // handler has no code path that even reads
    // JON_SNOW_DEMO_OPENROUTER_API_KEY; this asserts the observable
    // consequence (zero execution without a user-supplied credential).
  });
});

// Final independent-review correction: the demo access token protects an
// operator-funded spend endpoint, so a short/weak value must never be
// configurable at all.
describe("JON_SNOW_DEMO_ACCESS_TOKEN minimum length", () => {
  const validKey = { JON_SNOW_DEMO_OPENROUTER_API_KEY: DEMO_OPENROUTER_KEY };

  it("rejects a token shorter than 32 characters", () => {
    expect(() =>
      readJonSnowDemoServerConfig({
        ...validKey,
        JON_SNOW_DEMO_ACCESS_TOKEN: "short-token"
      })
    ).toThrow(ServerConfigError);
  });

  it("rejects a token exactly one character short of the minimum (31 chars)", () => {
    expect(() =>
      readJonSnowDemoServerConfig({
        ...validKey,
        JON_SNOW_DEMO_ACCESS_TOKEN: "a".repeat(31)
      })
    ).toThrow(ServerConfigError);
  });

  it("accepts a token at exactly the 32-character minimum", () => {
    expect(() =>
      readJonSnowDemoServerConfig({
        ...validKey,
        JON_SNOW_DEMO_ACCESS_TOKEN: "a".repeat(32)
      })
    ).not.toThrow();
  });

  it("accepts the >= 32-char fake token this file's own tests use", () => {
    expect(DEMO_ACCESS_TOKEN.length).toBeGreaterThanOrEqual(32);
    expect(() =>
      readJonSnowDemoServerConfig({ ...validKey, JON_SNOW_DEMO_ACCESS_TOKEN: DEMO_ACCESS_TOKEN })
    ).not.toThrow();
  });
});

// Milestone 13 (Issue #36 G3) -- admission-control rate limiting for the
// operator-funded demo endpoint. Zero real network/database anywhere
// below; `stubEligibleExecutionFetch()` is the same fake-network stub
// every accepted-request test in this file already uses.
describe("POST /api/demo/jon-snow/runs -- admission-control rate limiting (Issue #36 G3)", () => {
  it(`only reached AFTER the access-capability gate -- an invalid token never consumes an admission slot`, async () => {
    const admissionControl = new FakeAdmissionControl();
    const deps = baseDeps({ admissionControl, sourceIp: "203.0.113.1" });

    for (let i = 0; i < 10; i += 1) {
      const response = await handleDemoJonSnowRunsRequest(
        { httpMethod: "POST", headers: { [JON_SNOW_DEMO_ACCESS_HEADER]: "wrong-token" }, body: validBody() } as unknown as HandlerEvent,
        deps
      );

      expect(response.statusCode).toBe(401);
    }

    // The window is still completely empty -- none of the above counted.
    stubEligibleExecutionFetch();
    const response = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(201);
  });

  it(`allows exactly ${JON_SNOW_DEMO_RUN_START_RATE_LIMIT.maxAcceptedRequests} accepted new demo run starts per window per source IP, rejects the next with 429`, async () => {
    stubEligibleExecutionFetch();
    const admissionControl = new FakeAdmissionControl();
    const deps = baseDeps({ admissionControl, sourceIp: "203.0.113.1" });

    for (let i = 0; i < JON_SNOW_DEMO_RUN_START_RATE_LIMIT.maxAcceptedRequests; i += 1) {
      const response = await handleDemoJonSnowRunsRequest(
        { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
        deps
      );

      expect(response.statusCode).toBe(201);
    }

    const rejected = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(rejected.statusCode).toBe(429);
    expect(JSON.parse(rejected.body ?? "")).toEqual({ error: "rate_limited" });
  });

  it("an idempotent replay of the SAME clientRequestId never consumes a new admission slot", async () => {
    stubEligibleExecutionFetch();
    const admissionControl = new FakeAdmissionControl();
    const deps = baseDeps({ admissionControl, sourceIp: "203.0.113.1" });
    const firstClientRequestId = randomUUID();

    const first = await handleDemoJonSnowRunsRequest(
      {
        httpMethod: "POST",
        headers: validAccessHeaders(),
        body: validBody({ clientRequestId: firstClientRequestId })
      } as unknown as HandlerEvent,
      deps
    );

    expect(first.statusCode).toBe(201);

    // Fill the rest of the window with distinct new starts.
    for (let i = 1; i < JON_SNOW_DEMO_RUN_START_RATE_LIMIT.maxAcceptedRequests; i += 1) {
      const response = await handleDemoJonSnowRunsRequest(
        { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
        deps
      );

      expect(response.statusCode).toBe(201);
    }

    // The window is now full for a brand-new id.
    const rejected = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(rejected.statusCode).toBe(429);

    // But replaying the FIRST clientRequestId is still admitted.
    const replay = await handleDemoJonSnowRunsRequest(
      {
        httpMethod: "POST",
        headers: validAccessHeaders(),
        body: validBody({ clientRequestId: firstClientRequestId })
      } as unknown as HandlerEvent,
      deps
    );

    expect(replay.statusCode).toBe(201);
  });

  it("the demo endpoint's own bucket is independent from generic /api/runs' bucket -- exhausting one never blocks the other", async () => {
    const admissionControl = new FakeAdmissionControl();

    stubEligibleExecutionFetch();
    const demoDeps = baseDeps({ admissionControl, sourceIp: "203.0.113.1" });

    for (let i = 0; i < JON_SNOW_DEMO_RUN_START_RATE_LIMIT.maxAcceptedRequests; i += 1) {
      const response = await handleDemoJonSnowRunsRequest(
        { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
        demoDeps
      );

      expect(response.statusCode).toBe(201);
    }

    const demoRejected = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      demoDeps
    );

    expect(demoRejected.statusCode).toBe(429);

    // The SAME admissionControl instance, SAME source IP -- but the
    // generic /api/runs endpoint's own "run-start" bucket is untouched.
    const genericResponse = await handleRunsRequest(
      {
        httpMethod: "POST",
        body: JSON.stringify({
          clientRequestId: randomUUID(),
          case: { kind: "existing", caseId: "11111111-1111-4111-8111-111111111111" },
          executionMode: "shared",
          participants: [
            "advocate-pro-1",
            "advocate-pro-2",
            "advocate-con-1",
            "advocate-con-2",
            "judge-1",
            "judge-2",
            "judge-3"
          ].map((participantId) => ({
            participantId,
            personality: `Personality for ${participantId}.`,
            personalitySource: "manual",
            modelId: "mock/free-deliberator"
          }))
        })
      } as HandlerEvent,
      {
        caseRepository: new FakeIdempotentCaseRepository(),
        runRepository: new FakeRunRepository(),
        admissionControl,
        sourceIp: "203.0.113.1"
      }
    );

    // Not 429 -- rejected for an unrelated reason (unknown case id in
    // this minimal fixture) is fine; the point is it is NOT rate-limited
    // by the demo bucket's exhaustion.
    expect(genericResponse.statusCode).not.toBe(429);
  });

  it("a request with no admissionControl injected (pre-M13 test/caller shape) is completely unaffected", async () => {
    stubEligibleExecutionFetch();
    const deps = baseDeps();

    const response = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(201);
  });

  // Corrected (independent review, PR #37) -- identical regression to
  // netlify/functions/__tests__/runs.test.ts's own: a `null` requestId
  // passed to checkAndRecordAdmission does NOT skip rate limiting by
  // itself; malformed requests must never reach admission control at
  // all, or repeated ones could exhaust the bucket for a legitimate
  // source IP.
  it("repeated malformed/missing clientRequestId requests never consume admission slots -- a subsequent valid request from the same source IP is still accepted, not 429", async () => {
    const admissionControl = new FakeAdmissionControl();
    const deps = baseDeps({ admissionControl, sourceIp: "203.0.113.1" });

    for (let i = 0; i < JON_SNOW_DEMO_RUN_START_RATE_LIMIT.maxAcceptedRequests + 5; i += 1) {
      const response = await handleDemoJonSnowRunsRequest(
        {
          httpMethod: "POST",
          headers: validAccessHeaders(),
          body: validBody({ clientRequestId: "not-a-uuid" })
        } as unknown as HandlerEvent,
        deps
      );

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body ?? "{}").error).toBe("invalid_run");
    }

    stubEligibleExecutionFetch();
    const valid = await handleDemoJonSnowRunsRequest(
      { httpMethod: "POST", headers: validAccessHeaders(), body: validBody() } as unknown as HandlerEvent,
      deps
    );

    expect(valid.statusCode).toBe(201);
  });
});
