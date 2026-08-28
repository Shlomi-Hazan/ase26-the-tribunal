// Discovery-scale correction regression tests (live integration gate).
//
// The M7 live gate found the real OpenRouter catalog has ~387 models,
// and the previous fully-sequential one-endpoint-fetch-per-model sweep
// took ~45.7s cold, then ~47.1s again on a supposedly-warm second call
// (the 200-entry default endpoint cache evicted early entries before a
// single sweep even finished). These tests prove, with a deterministic
// fake provider and NO real network, that:
//   - discovery uses bounded (<=8, >1) concurrency, not fully sequential
//     or fully unbounded;
//   - a 387-model sweep's endpoint-metadata working set survives a full
//     5-minute TTL window when backed by ENDPOINT_METADATA_CACHE_MAX_ENTRIES
//     (a second call inside the TTL makes zero additional endpoint
//     fetches and returns identical pricingObservedAt values);
//   - result ordering is deterministic (matches model input order)
//     regardless of real network completion order;
//   - one endpoint-fetch failure skips only that model, never the pool.
import { describe, expect, it } from "vitest";
import {
  listEligibleModels,
  MODEL_DISCOVERY_ENDPOINT_CONCURRENCY,
  type EligibleModel
} from "./modelDiscovery";
import { ENDPOINT_METADATA_CACHE_MAX_ENTRIES, ModelMetadataCache } from "./cache";
import { ProviderError } from "./errors";
import { FakeOpenRouterProvider } from "./fakeProvider";
import { runPreflight, type PreflightRun, type PreflightRunLoader } from "./preflight";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "../../../src/prompts/versions";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";
import type { OpenRouterProvider, ProviderChatResult } from "./provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

const REAL_CATALOG_SIZE_OBSERVED_LIVE = 387;

function eligibleEndpoint(tag: string): RawOpenRouterEndpoint {
  return {
    tag,
    provider_name: "Synthetic",
    name: `Synthetic | ${tag}`,
    context_length: 100_000,
    max_prompt_tokens: 90_000,
    max_completion_tokens: 4000,
    supported_parameters: ["response_format", "max_completion_tokens"],
    quantization: null,
    status: 0,
    pricing: { prompt: "0.000001", completion: "0.000002" }
  };
}

function syntheticModels(count: number): RawOpenRouterModel[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `synthetic/model-${index}`,
    canonical_slug: `synthetic/model-${index}`,
    name: `Synthetic Model ${index}`
  }));
}

// A fake provider that never resolves listEndpoints on its own -- the
// test manually releases pending calls, so concurrency/order can be
// observed and controlled deterministically without any real timer or
// wall-clock sleep (Section 12F).
class ManuallyReleasedProvider implements OpenRouterProvider {
  listModelsResult: RawOpenRouterModel[] = [];
  listEndpointsCallCount = 0;
  listEndpointsCallOrder: string[] = [];
  inFlight = 0;
  maxInFlight = 0;
  private readonly endpointsByModelId = new Map<string, RawOpenRouterEndpoint[]>();
  private readonly failingModelIds = new Set<string>();
  private readonly pending = new Map<string, { resolve: () => void }>();

  setEndpoints(modelId: string, endpoints: RawOpenRouterEndpoint[]): void {
    this.endpointsByModelId.set(modelId, endpoints);
  }

  setFailing(modelId: string): void {
    this.failingModelIds.add(modelId);
  }

  pendingModelIds(): string[] {
    return [...this.pending.keys()];
  }

  async listModels(): Promise<RawOpenRouterModel[]> {
    return this.listModelsResult;
  }

  async listEndpoints(author: string, slug: string): Promise<RawOpenRouterEndpoint[]> {
    const modelId = slug ? `${author}/${slug}` : author;

    this.listEndpointsCallCount += 1;
    this.listEndpointsCallOrder.push(modelId);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);

    await new Promise<void>((resolve) => {
      this.pending.set(modelId, { resolve });
    });

    this.inFlight -= 1;
    this.pending.delete(modelId);

    if (this.failingModelIds.has(modelId)) {
      throw new ProviderError("UNKNOWN", "synthetic endpoint fetch failure");
    }

    return this.endpointsByModelId.get(modelId) ?? [];
  }

  async createChatCompletion(): Promise<ProviderChatResult> {
    throw new Error("never called by this test");
  }

  // Releases every call pending at this exact moment, in a caller-chosen
  // order (default: reverse of request order, deliberately mismatching
  // request order to prove result ordering does not depend on release/
  // completion order).
  releasePending(order?: string[]): void {
    const ids = order ?? [...this.pending.keys()].reverse();

    for (const id of ids) {
      const entry = this.pending.get(id);
      entry?.resolve();
    }
  }
}

// Pure microtask draining -- no setTimeout/real timer, no wall-clock
// wait (Section 12F). Repeated `await Promise.resolve()` cycles let
// every already-scheduled synchronous continuation run without
// advancing real time.
async function flushMicrotasks(cycles = 20): Promise<void> {
  for (let i = 0; i < cycles; i += 1) {
    await Promise.resolve();
  }
}

// Drains a ManuallyReleasedProvider-backed listEligibleModels() call to
// completion by repeatedly: flushing microtasks, observing whatever is
// currently pending, and releasing it -- used by tests that only care
// about the final result, not the concurrency shape itself.
async function drainToCompletion(
  provider: ManuallyReleasedProvider,
  resultPromise: Promise<EligibleModel[]>
): Promise<EligibleModel[]> {
  for (let round = 0; round < 200; round += 1) {
    await flushMicrotasks();

    if (provider.pendingModelIds().length === 0) {
      break;
    }

    provider.releasePending();
  }

  return resultPromise;
}

describe("listEligibleModels -- discovery-scale correction (Sections 5-10, 12)", () => {
  it("A: bounds simultaneous listEndpoints calls to MODEL_DISCOVERY_ENDPOINT_CONCURRENCY (<=8) and B: is genuinely concurrent (>1)", async () => {
    const models = syntheticModels(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    const provider = new ManuallyReleasedProvider();
    provider.listModelsResult = models;

    for (const model of models) {
      provider.setEndpoints(model.id, [eligibleEndpoint("synthetic")]);
    }

    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(
      undefined,
      undefined,
      ENDPOINT_METADATA_CACHE_MAX_ENTRIES
    );
    const resultPromise = listEligibleModels({
      provider,
      endpointCache
    });

    await flushMicrotasks();

    expect(provider.pendingModelIds().length).toBe(MODEL_DISCOVERY_ENDPOINT_CONCURRENCY);
    expect(provider.inFlight).toBe(MODEL_DISCOVERY_ENDPOINT_CONCURRENCY);

    await drainToCompletion(provider, resultPromise);

    expect(provider.maxInFlight).toBeLessThanOrEqual(MODEL_DISCOVERY_ENDPOINT_CONCURRENCY);
    expect(provider.maxInFlight).toBeGreaterThan(1);
  });

  it("C: processes all 387 candidates exactly once each", async () => {
    const models = syntheticModels(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    const provider = new ManuallyReleasedProvider();
    provider.listModelsResult = models;

    for (const model of models) {
      provider.setEndpoints(model.id, [eligibleEndpoint("synthetic")]);
    }

    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(
      undefined,
      undefined,
      ENDPOINT_METADATA_CACHE_MAX_ENTRIES
    );
    const results = await drainToCompletion(
      provider,
      listEligibleModels({ provider, endpointCache })
    );

    expect(provider.listEndpointsCallCount).toBe(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    expect(new Set(provider.listEndpointsCallOrder).size).toBe(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    expect(results).toHaveLength(REAL_CATALOG_SIZE_OBSERVED_LIVE);
  });

  it("D: result ordering matches model input order regardless of provider completion order", async () => {
    const models = syntheticModels(20);
    const provider = new ManuallyReleasedProvider();
    provider.listModelsResult = models;

    for (const model of models) {
      provider.setEndpoints(model.id, [eligibleEndpoint("synthetic")]);
    }

    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(
      undefined,
      undefined,
      ENDPOINT_METADATA_CACHE_MAX_ENTRIES
    );
    const resultPromise = listEligibleModels({ provider, endpointCache });

    // Deliberately release every round in REVERSE request order --
    // completion order is shuffled relative to request/input order.
    for (let round = 0; round < 30; round += 1) {
      await flushMicrotasks();

      const pending = provider.pendingModelIds();

      if (pending.length === 0) {
        break;
      }

      provider.releasePending([...pending].reverse());
    }

    const results = await resultPromise;

    expect(results.map((r) => r.id)).toEqual(models.map((m) => m.id));
  });

  it("E: one endpoint request failure skips only that model, never the pool", async () => {
    const models = syntheticModels(15);
    const provider = new ManuallyReleasedProvider();
    provider.listModelsResult = models;

    for (const model of models) {
      provider.setEndpoints(model.id, [eligibleEndpoint("synthetic")]);
    }

    provider.setFailing("synthetic/model-7");

    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(
      undefined,
      undefined,
      ENDPOINT_METADATA_CACHE_MAX_ENTRIES
    );
    const results = await drainToCompletion(
      provider,
      listEligibleModels({ provider, endpointCache })
    );

    expect(provider.listEndpointsCallCount).toBe(15);
    expect(results).toHaveLength(14);
    expect(results.find((r) => r.id === "synthetic/model-7")).toBeUndefined();
    expect(results.map((r) => r.id)).toEqual(
      models.filter((m) => m.id !== "synthetic/model-7").map((m) => m.id)
    );
  });

  // F: this whole file uses only Promise-based manual release + microtask
  // draining -- no setTimeout, no real sleep, no wall-clock assertion
  // anywhere (confirmed by inspection; every test above awaits either a
  // manually-resolved Promise or Promise.resolve()).

  it("Section 11 / 10: a 387-model sweep is fully retained by ENDPOINT_METADATA_CACHE_MAX_ENTRIES -- a second call inside the TTL makes zero additional endpoint fetches and returns identical results/observedAt (warm-cache invariant)", async () => {
    const models = syntheticModels(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    const provider = new ManuallyReleasedProvider();
    provider.listModelsResult = models;

    for (const model of models) {
      provider.setEndpoints(model.id, [eligibleEndpoint("synthetic")]);
    }

    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(
      undefined,
      clock,
      ENDPOINT_METADATA_CACHE_MAX_ENTRIES
    );

    const firstResults = await drainToCompletion(
      provider,
      listEligibleModels({ provider, modelCache, endpointCache, clock })
    );

    expect(firstResults).toHaveLength(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    expect(provider.listEndpointsCallCount).toBe(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    // The endpoint cache is never larger than the real working set it
    // needs to hold, and (unlike the old 200-entry default) is not
    // forced to evict any of the 387 entries this sweep just set.
    expect(endpointCache.size()).toBe(REAL_CATALOG_SIZE_OBSERVED_LIVE);

    const callCountAfterFirstSweep = provider.listEndpointsCallCount;

    // Still well within the 5-minute TTL.
    now += 60_000;

    const secondResults = await drainToCompletion(
      provider,
      listEligibleModels({ provider, modelCache, endpointCache, clock })
    );

    // The defining regression: zero additional endpoint fetches for
    // already-cached, still-fresh models -- this is exactly what failed
    // under the old 200-entry cap (a second call re-fetched almost the
    // entire catalog).
    expect(provider.listEndpointsCallCount).toBe(callCountAfterFirstSweep);
    expect(secondResults).toEqual(firstResults);
    expect(secondResults.map((r) => r.pricingObservedAt)).toEqual(
      firstResults.map((r) => r.pricingObservedAt)
    );
  });

  it("would fail under the old 200-entry default cache (regression proof the new bound is load-bearing)", async () => {
    const models = syntheticModels(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    const provider = new ManuallyReleasedProvider();
    provider.listModelsResult = models;

    for (const model of models) {
      provider.setEndpoints(model.id, [eligibleEndpoint("synthetic")]);
    }

    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    // Deliberately the OLD, too-small production default (200) -- proves
    // this test suite genuinely distinguishes the fixed from the broken
    // configuration, not merely asserting something trivially true.
    const oldDefaultEndpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(
      undefined,
      clock
    );

    await drainToCompletion(
      provider,
      listEligibleModels({
        provider,
        modelCache,
        endpointCache: oldDefaultEndpointCache,
        clock
      })
    );

    // 387 models were requested, but the 200-entry cap could not retain
    // all of them -- eviction happened mid-sweep.
    expect(oldDefaultEndpointCache.size()).toBeLessThan(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    expect(oldDefaultEndpointCache.size()).toBeLessThanOrEqual(200);

    const callCountAfterFirstSweep = provider.listEndpointsCallCount;

    now += 60_000;

    await drainToCompletion(
      provider,
      listEligibleModels({
        provider,
        modelCache,
        endpointCache: oldDefaultEndpointCache,
        clock
      })
    );

    // Unlike the fixed configuration above, the old cap forces
    // additional endpoint fetches on the very next call, still inside
    // the TTL -- this is the thrashing the live gate observed.
    expect(provider.listEndpointsCallCount).toBeGreaterThan(callCountAfterFirstSweep);
  });

  it("Section 13: TTL boundary semantics hold at scale -- fresh at TTL-1ms (no refetch), stale at exactly TTL (refetch, still bounded-concurrency, never stale-as-current)", async () => {
    const models = syntheticModels(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    const provider = new ManuallyReleasedProvider();
    provider.listModelsResult = models;

    for (const model of models) {
      provider.setEndpoints(model.id, [eligibleEndpoint("synthetic")]);
    }

    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(
      undefined,
      clock,
      ENDPOINT_METADATA_CACHE_MAX_ENTRIES
    );
    const ttlMs = 300_000;

    await drainToCompletion(
      provider,
      listEligibleModels({ provider, modelCache, endpointCache, clock })
    );

    const callCountAfterFirstSweep = provider.listEndpointsCallCount;

    // TTL - 1ms: every entry is still fresh -- zero refetches.
    now += ttlMs - 1;

    await drainToCompletion(
      provider,
      listEligibleModels({ provider, modelCache, endpointCache, clock })
    );

    expect(provider.listEndpointsCallCount).toBe(callCountAfterFirstSweep);

    // Exactly TTL: every entry is now stale -- a full refetch is
    // required (never served as current without refreshing), and it
    // still goes through the same bounded-concurrency pool, never more
    // than MODEL_DISCOVERY_ENDPOINT_CONCURRENCY in flight.
    now += 1;
    provider.maxInFlight = 0;

    const thirdResultPromise = listEligibleModels({
      provider,
      modelCache,
      endpointCache,
      clock
    });

    await flushMicrotasks();
    expect(provider.inFlight).toBe(MODEL_DISCOVERY_ENDPOINT_CONCURRENCY);

    const thirdResults = await drainToCompletion(provider, thirdResultPromise);

    expect(provider.listEndpointsCallCount).toBe(
      callCountAfterFirstSweep + REAL_CATALOG_SIZE_OBSERVED_LIVE
    );
    expect(provider.maxInFlight).toBeLessThanOrEqual(MODEL_DISCOVERY_ENDPOINT_CONCURRENCY);
    expect(thirdResults).toHaveLength(REAL_CATALOG_SIZE_OBSERVED_LIVE);
  });
});

// Section 14: a model's endpoint metadata cached fresh by a discovery
// sweep (listEligibleModels/GET /api/models) must be reused by preflight
// (runPreflight/POST /api/preflight) when the SAME cache instance is
// intentionally provided -- exactly the interaction the live gate found
// broken under the old 200-entry cache (a model freshly cached during
// discovery had already been evicted by the time preflight ran moments
// later on the same warm caches). This is still an explicitly SHARED,
// intentionally-injected cache instance in this test -- not a claim
// about cross-Function runtime sharing, which remains unnecessary and
// unrelied-upon (sharedMetadataCache.ts).
describe("discovery -> preflight cache handoff (Section 14, same shared cache instance)", () => {
  it("a model cached fresh by a full 387-model discovery sweep produces zero additional listEndpoints calls when preflight resolves a run configured with that exact model", async () => {
    const targetModelId = "synthetic/model-200";
    const models = syntheticModels(REAL_CATALOG_SIZE_OBSERVED_LIVE);
    const provider = new FakeOpenRouterProvider();
    provider.listModelsResult = models;

    for (const model of models) {
      provider.listEndpointsResult[model.id] = [eligibleEndpoint("synthetic")];
    }

    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(
      undefined,
      clock,
      ENDPOINT_METADATA_CACHE_MAX_ENTRIES
    );

    const discoveryResults = await listEligibleModels({
      provider,
      modelCache,
      endpointCache,
      clock
    });

    expect(discoveryResults.some((r) => r.id === targetModelId)).toBe(true);
    const listEndpointsCallCountAfterDiscovery = provider.listEndpointsCallCount;

    now += 60_000; // 1 minute later, still well within the 5-minute TTL

    function participant(id: ParticipantId) {
      const isAdvocate = id.startsWith("advocate");

      return {
        participantId: id,
        modelId: targetModelId,
        personality: "A measured, professional demeanor.",
        promptVersion: isAdvocate ? ADVOCATE_PROMPT_VERSION : JUDGE_PROMPT_VERSION
      };
    }

    const preflightRun: PreflightRun = {
      id: "11111111-1111-4111-8111-111111111111",
      caseId: "22222222-2222-4222-8222-222222222222",
      participants: participantIds.map((id: ParticipantId) => participant(id))
    };

    class SingleRunLoader implements PreflightRunLoader {
      async getRun() {
        return preflightRun;
      }

      async getCase() {
        return {
          defendant: "Synthetic Defendant",
          act: "Synthetic act.",
          exactQuestion: "Synthetic question?"
        };
      }
    }

    const preflightResult = await runPreflight(preflightRun.id, {
      runLoader: new SingleRunLoader(),
      provider,
      modelCache,
      endpointCache,
      clock
    });

    expect(preflightResult.eligible).toBe(true);
    // The defining assertion: preflight resolved all seven participants'
    // (identical, Shared-model) routes using the cache discovery already
    // warmed -- zero additional real listEndpoints calls.
    expect(provider.listEndpointsCallCount).toBe(listEndpointsCallCountAfterDiscovery);
    expect(preflightResult.participants[0].pricing?.observedAt).toBe(
      new Date(1_000_000).toISOString()
    );
  });
});
