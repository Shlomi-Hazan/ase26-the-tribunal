import { describe, expect, it } from "vitest";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "../../../src/prompts/versions";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";
import { FakeOpenRouterProvider } from "./fakeProvider";
import { MODEL_METADATA_TTL_MS, ModelMetadataCache } from "./cache";
import { ProviderError } from "./errors";
import {
  PreflightPersistenceError,
  PreflightRunNotFoundError,
  runPreflight,
  type PreflightRun,
  type PreflightRunLoader
} from "./preflight";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

const CASE = {
  defendant: "Alex Rowan",
  act: "Entered the restricted lab.",
  exactQuestion: "Did Alex knowingly violate the lab protocol?"
};

function participant(
  id: ParticipantId,
  overrides: { modelId?: string; promptVersion?: string } = {}
) {
  const isAdvocate = id.startsWith("advocate");

  return {
    participantId: id,
    modelId: overrides.modelId ?? "openai/gpt-5",
    personality: "A measured, professional demeanor.",
    promptVersion:
      overrides.promptVersion ??
      (isAdvocate ? ADVOCATE_PROMPT_VERSION : JUDGE_PROMPT_VERSION)
  };
}

function run(overrides: Partial<PreflightRun> = {}, participantOverrides: Record<string, { modelId?: string; promptVersion?: string }> = {}): PreflightRun {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    caseId: "22222222-2222-4222-8222-222222222222",
    participants: participantIds.map((id: ParticipantId) =>
      participant(id, participantOverrides[id] ?? {})
    ),
    ...overrides
  };
}

class FakeRunLoader implements PreflightRunLoader {
  constructor(
    private readonly runsById: Record<string, PreflightRun> = {},
    private readonly caseExists = true
  ) {}

  async getRun(runId: string) {
    return this.runsById[runId] ?? null;
  }

  async getCase() {
    return this.caseExists ? CASE : null;
  }
}

function cheapModel(id = "openai/gpt-5"): {
  models: RawOpenRouterModel[];
  endpoints: RawOpenRouterEndpoint[];
} {
  return {
    models: [{ id, canonical_slug: id, name: "Cheap Model", context_length: 200_000 }],
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

function expensiveModel(id = "openai/gpt-5-max"): {
  models: RawOpenRouterModel[];
  endpoints: RawOpenRouterEndpoint[];
} {
  return {
    models: [{ id, canonical_slug: id, name: "Expensive Model", context_length: 200_000 }],
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
        // Deliberately extreme rate so the seven-participant, ×2-retry,
        // ×1.10-safety-factor sum comfortably exceeds $5.00.
        pricing: { prompt: "0.01", completion: "0.02" }
      }
    ]
  };
}

function providerFor(fixture: { models: RawOpenRouterModel[]; endpoints: RawOpenRouterEndpoint[] }) {
  const provider = new FakeOpenRouterProvider();
  provider.listModelsResult = fixture.models;

  for (const model of fixture.models) {
    provider.listEndpointsResult[model.id] = fixture.endpoints;
  }

  return provider;
}

describe("runPreflight -- run/case loading", () => {
  it("throws PreflightRunNotFoundError for an unknown run", async () => {
    const loader = new FakeRunLoader({});
    const provider = providerFor(cheapModel());

    await expect(
      runPreflight("99999999-9999-4999-8999-999999999999", { runLoader: loader, provider })
    ).rejects.toBeInstanceOf(PreflightRunNotFoundError);
  });

  it("throws PreflightPersistenceError when the run does not have exactly seven participants", async () => {
    const testRun = run();
    testRun.participants = testRun.participants.slice(0, 6);
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    await expect(
      runPreflight(testRun.id, { runLoader: loader, provider })
    ).rejects.toBeInstanceOf(PreflightPersistenceError);
  });

  it("throws PreflightPersistenceError when the run's case cannot be loaded", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun }, false);
    const provider = providerFor(cheapModel());

    await expect(
      runPreflight(testRun.id, { runLoader: loader, provider })
    ).rejects.toBeInstanceOf(PreflightPersistenceError);
  });
});

describe("runPreflight -- prompt version gate (SPEC.md MODEL-006)", () => {
  it("blocks a participant frozen with the pre-M7 placeholder prompt_version", async () => {
    const testRun = run({}, { "advocate-pro-1": { promptVersion: "unassigned-pre-m7" } });
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.eligible).toBe(false);
    expect(result.blockedReasonCodes).toContain("PROMPT_VERSION_UNASSIGNED");
    const advocate = result.participants.find((p) => p.participantId === "advocate-pro-1");
    expect(advocate?.modelEligible).toBe(false);
  });

  it("accepts the correct role-specific prompt version for every participant", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.blockedReasonCodes).not.toContain("PROMPT_VERSION_UNASSIGNED");
  });

  it("blocks a mismatched (wrong-role) prompt version", async () => {
    const testRun = run({}, { "judge-1": { promptVersion: ADVOCATE_PROMPT_VERSION } });
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.blockedReasonCodes).toContain("PROMPT_VERSION_UNASSIGNED");
  });
});

describe("runPreflight -- eligibility outcomes", () => {
  it("returns an eligible result for a Shared-mode-style run using one cheap model for all seven", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.eligible).toBe(true);
    expect(result.participants).toHaveLength(7);
    expect(result.participants.every((p) => p.modelEligible)).toBe(true);
  });

  it("returns an eligible result for a Separate-mode-style run using independent models per participant", async () => {
    const testRun = run(
      {},
      {
        "advocate-pro-1": { modelId: "openai/gpt-5" },
        "advocate-pro-2": { modelId: "openai/gpt-5-b" },
        "advocate-con-1": { modelId: "openai/gpt-5-c" },
        "advocate-con-2": { modelId: "openai/gpt-5-d" },
        "judge-1": { modelId: "openai/gpt-5-e" },
        "judge-2": { modelId: "openai/gpt-5-f" },
        "judge-3": { modelId: "openai/gpt-5-g" }
      }
    );
    const provider = new FakeOpenRouterProvider();

    for (const p of testRun.participants) {
      const fixture = cheapModel(p.modelId);
      provider.listModelsResult = [...provider.listModelsResult, ...fixture.models];
      provider.listEndpointsResult[p.modelId] = fixture.endpoints;
    }

    const loader = new FakeRunLoader({ [testRun.id]: testRun });

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.eligible).toBe(true);
    expect(new Set(result.participants.map((p) => p.configuredModelId)).size).toBe(7);
  });

  it("blocks with MODEL_NOT_FOUND for an unresolvable configured model", async () => {
    const testRun = run({}, { "advocate-pro-1": { modelId: "unknown/model" } });
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.eligible).toBe(false);
    expect(result.blockedReasonCodes).toContain("MODEL_NOT_FOUND");
  });

  it("blocks with PRICING_UNAVAILABLE when the provider fails to list metadata", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    provider.listModelsError = new ProviderError("PROVIDER_5XX", "provider down");

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.eligible).toBe(false);
    expect(result.blockedReasonCodes).toContain("PRICING_UNAVAILABLE");
  });

  it("blocks with BUDGET_EXCEEDED when the conservative bound exceeds $5.00", async () => {
    const testRun = run({}, Object.fromEntries(
      participantIds.map((id: ParticipantId) => [id, { modelId: "openai/gpt-5-max" }])
    ));
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(expensiveModel("openai/gpt-5-max"));

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.eligible).toBe(false);
    expect(result.blockedReasonCodes).toContain("BUDGET_EXCEEDED");
    expect(Number(result.conservativeMaxCostUsd)).toBeGreaterThan(5);
  });
});

describe("runPreflight -- response contract", () => {
  it("serializes every monetary field as a decimal string, never a JS number", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(typeof result.hardBudgetUsd).toBe("string");
    expect(typeof result.conservativeMaxCostUsd).toBe("string");
    expect(typeof result.remainingBudgetUsd).toBe("string");
    for (const p of result.participants) {
      if (p.conservativeParticipantCostUsd !== null) {
        expect(typeof p.conservativeParticipantCostUsd).toBe("string");
      }
      if (p.pricing) {
        expect(typeof p.pricing.promptPricePerToken).toBe("string");
        expect(typeof p.pricing.effectiveInputPricePerToken).toBe("string");
      }
    }
  });

  it("hardBudgetUsd is always exactly the locked $5.00 ceiling", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.hardBudgetUsd).toBe("5");
  });

  it("preserves canonical participant order in the response", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    const result = await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(result.participants.map((p) => p.participantId)).toEqual([...participantIds]);
  });
});

describe("runPreflight -- zero side effects", () => {
  it("never invokes createChatCompletion", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    await runPreflight(testRun.id, { runLoader: loader, provider });

    expect(provider.createChatCompletionCallCount).toBe(0);
  });

  it("makes no fetch call at all when using the fake provider", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      return originalFetch(...args);
    }) as typeof fetch;

    try {
      const testRun = run();
      const loader = new FakeRunLoader({ [testRun.id]: testRun });
      const provider = providerFor(cheapModel());

      await runPreflight(testRun.id, { runLoader: loader, provider });

      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("runPreflight -- deterministic repeat with a fresh cache", () => {
  it("returns the same result and does not re-fetch metadata while the cache stays fresh", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    const first = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });
    const callCountAfterFirst = provider.listModelsCallCount;

    now += 1000; // still well within the 5-minute TTL
    const second = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });

    expect(provider.listModelsCallCount).toBe(callCountAfterFirst);
    expect(second.eligible).toBe(first.eligible);
    expect(second.participants.map((p) => p.pricing?.effectiveInputPricePerToken)).toEqual(
      first.participants.map((p) => p.pricing?.effectiveInputPricePerToken)
    );
  });

  // Cache production-wiring tests (independent review, pre-live gate,
  // Section 18). These exercise the actual runPreflight/service dependency
  // boundary, not cache.ts in isolation (already covered by cache.test.ts).

  it("A: the first invocation calls the provider for metadata", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>();
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>();

    await runPreflight(testRun.id, { runLoader: loader, provider, modelCache, endpointCache });

    expect(provider.listModelsCallCount).toBeGreaterThan(0);
  });

  it("C: a second invocation at exactly the TTL boundary refetches (stale, not fresh)", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });
    const callCountAfterFirst = provider.listModelsCallCount;

    now += MODEL_METADATA_TTL_MS; // exactly at the TTL boundary -- stale
    await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });

    expect(provider.listModelsCallCount).toBe(callCountAfterFirst + 1);
  });

  it("D: stale cache + provider failure on refetch blocks with a safe reason code, never serves stale metadata as fresh", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });

    now += MODEL_METADATA_TTL_MS; // stale
    provider.listModelsError = new ProviderError("PROVIDER_5XX", "provider down");

    const result = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });

    expect(result.eligible).toBe(false);
    expect(result.blockedReasonCodes).toContain("PRICING_UNAVAILABLE");
  });

  it("runPreflight defaults to a fresh per-call cache when none is injected (never shares state across unrelated calls)", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());

    await runPreflight(testRun.id, { runLoader: loader, provider });
    const callCountAfterFirst = provider.listModelsCallCount;

    await runPreflight(testRun.id, { runLoader: loader, provider });

    // No cache injected on either call -> each call gets its own fresh
    // cache internally, so the provider is called again the second time.
    expect(provider.listModelsCallCount).toBeGreaterThan(callCountAfterFirst);
  });
});

// PricingSnapshot.observedAt fetch-timestamp regression tests
// (independent review, pre-live gate, second pass; ADR Decision 9,
// Section 15 of the correction task). observedAt must always be the
// actual endpoint metadata cache fetch time, never the current
// invocation time.
describe("runPreflight -- pricing.observedAt reflects the actual endpoint fetch timestamp", () => {
  it("A: the first fetch's observedAt equals the clock reading at that fetch", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    const t0 = 1_000_000;
    const clock = () => t0;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    const result = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });

    const observedAt = result.participants[0].pricing?.observedAt;
    expect(observedAt).toBe(new Date(t0).toISOString());
  });

  it("B: a second invocation 4 minutes later reusing the fresh cache reports the SAME (original) observedAt, not the new invocation time", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    const first = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });
    const firstObservedAt = first.participants[0].pricing?.observedAt;

    now += 4 * 60 * 1000; // 4 minutes later, still within the 5-minute TTL
    const second = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });
    const secondObservedAt = second.participants[0].pricing?.observedAt;

    expect(secondObservedAt).toBe(firstObservedAt);
    expect(secondObservedAt).not.toBe(new Date(now).toISOString());
  });

  it("C: exactly 5 minutes later (stale) with a successful refetch, observedAt becomes the new fetch time", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    const first = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });
    const firstObservedAt = first.participants[0].pricing?.observedAt;

    now += MODEL_METADATA_TTL_MS; // exactly at the TTL boundary -- stale
    const second = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });
    const secondObservedAt = second.participants[0].pricing?.observedAt;

    expect(secondObservedAt).toBe(new Date(now).toISOString());
    expect(secondObservedAt).not.toBe(firstObservedAt);
  });

  it("D: stale + failed refetch blocks -- no fabricated observedAt is ever produced for that participant", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });

    now += MODEL_METADATA_TTL_MS;
    provider.listModelsError = new ProviderError("PROVIDER_5XX", "provider down");

    const result = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });

    expect(result.eligible).toBe(false);
    expect(result.participants[0].pricing).toBeNull();
  });

  it("F: POST /api/preflight's response reports this exact endpoint-fetch-timestamp semantics via pricingObservedAt", async () => {
    const testRun = run();
    const loader = new FakeRunLoader({ [testRun.id]: testRun });
    const provider = providerFor(cheapModel());
    const t0 = 1_000_000;
    const clock = () => t0;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    const result = await runPreflight(testRun.id, {
      runLoader: loader,
      provider,
      modelCache,
      endpointCache,
      clock
    });

    expect(result.pricingObservedAt).toBe(new Date(t0).toISOString());
  });
});
