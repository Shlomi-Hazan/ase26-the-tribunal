import { describe, expect, it } from "vitest";
import { listEligibleModels, resolveSharedTribunalRoute } from "./modelDiscovery";
import { ModelMetadataCache } from "./cache";
import { FakeOpenRouterProvider } from "./fakeProvider";
import {
  worstCaseAdvocateInputTokens,
  worstCaseJudgeInputTokens,
  ADVOCATE_OUTPUT_CAP_TOKENS,
  JUDGE_OUTPUT_CAP_TOKENS
} from "./tokenEstimation";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

const OBSERVED_AT = "2026-08-26T00:00:00.000Z";

function model(overrides: Partial<RawOpenRouterModel> = {}): RawOpenRouterModel {
  return {
    id: "openai/gpt-5",
    canonical_slug: "openai/gpt-5",
    name: "GPT-5",
    ...overrides
  };
}

// Ample context for both roles by default -- individual tests narrow
// context_length/max_completion_tokens to exercise the boundary being
// tested.
function endpoint(overrides: Partial<RawOpenRouterEndpoint> = {}): RawOpenRouterEndpoint {
  return {
    tag: "openai",
    provider_name: "OpenAI",
    name: "OpenAI | GPT-5",
    context_length: 100_000,
    max_prompt_tokens: 90_000,
    max_completion_tokens: 4000,
    supported_parameters: ["response_format", "max_completion_tokens"],
    quantization: null,
    status: 0,
    pricing: { prompt: "0.000003", completion: "0.000006" },
    ...overrides
  };
}

describe("resolveSharedTribunalRoute -- dual-role eligibility (Sections 3-6)", () => {
  it("A: max_completion_tokens = 1000 is advocate-capable but judge-incapable -- NOT eligible", () => {
    const result = resolveSharedTribunalRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [endpoint({ max_completion_tokens: 1000 })],
      observedAt: OBSERVED_AT
    });

    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.reasonCodes).toContain("BOUNDED_OUTPUT_UNSUPPORTED");
  });

  it("B: max_completion_tokens = 1199 is NOT eligible (one below the judge minimum)", () => {
    const result = resolveSharedTribunalRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [endpoint({ max_completion_tokens: 1199 })],
      observedAt: OBSERVED_AT
    });

    expect(result.eligible).toBe(false);
  });

  it("C: max_completion_tokens = 1200 with sufficient judge context passes the capacity check", () => {
    const judgeNeed = worstCaseJudgeInputTokens() + JUDGE_OUTPUT_CAP_TOKENS;
    const result = resolveSharedTribunalRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({
          max_completion_tokens: 1200,
          context_length: judgeNeed + 1000,
          max_prompt_tokens: judgeNeed
        })
      ],
      observedAt: OBSERVED_AT
    });

    expect(result.eligible).toBe(true);
  });

  it("D: context sufficient for advocate but insufficient for worst-case judge -- NOT eligible", () => {
    const advocateNeed = worstCaseAdvocateInputTokens() + ADVOCATE_OUTPUT_CAP_TOKENS;
    const judgeNeed = worstCaseJudgeInputTokens() + JUDGE_OUTPUT_CAP_TOKENS;
    // Sanity: judge genuinely needs materially more context than advocate
    // (the 4x1000-token speech reserve alone guarantees this).
    expect(judgeNeed).toBeGreaterThan(advocateNeed);

    const contextBetween = Math.floor((advocateNeed + judgeNeed) / 2);
    const result = resolveSharedTribunalRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({
          max_completion_tokens: 1200,
          context_length: contextBetween,
          max_prompt_tokens: contextBetween
        })
      ],
      observedAt: OBSERVED_AT
    });

    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.reasonCodes).toContain("CONTEXT_TOO_SMALL");
  });

  it("E: a cheap advocate-only endpoint loses to a more expensive complete-Tribunal-capable endpoint", () => {
    const result = resolveSharedTribunalRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({
          tag: "cheap-advocate-only",
          max_completion_tokens: 1000, // fails judge minimum
          pricing: { prompt: "0.0000001", completion: "0.0000002" }
        }),
        endpoint({
          tag: "capable-but-pricier",
          max_completion_tokens: 1200,
          pricing: { prompt: "0.000005", completion: "0.000006" }
        })
      ],
      observedAt: OBSERVED_AT
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.route.providerEndpointTag).toBe("capable-but-pricier");
  });

  it("F: all candidates are advocate-only -- the model is absent from eligible discovery", () => {
    const result = resolveSharedTribunalRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({ tag: "a", max_completion_tokens: 1000 }),
        endpoint({ tag: "b", max_completion_tokens: 1100 })
      ],
      observedAt: OBSERVED_AT
    });

    expect(result.eligible).toBe(false);
  });

  it("G: the returned route's pricing/identity is the exact endpoint that passed BOTH role contracts", () => {
    const result = resolveSharedTribunalRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [endpoint({ tag: "dual-capable", max_completion_tokens: 1200 })],
      observedAt: OBSERVED_AT
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.route.providerEndpointTag).toBe("dual-capable");
    expect(result.route.pricing.providerEndpointTag).toBe("dual-capable");
    expect(result.route.isUniquelyPinnable).toBe(true);
  });

  it("never resolves two different endpoints for advocate vs. judge and calls it one route", () => {
    // A model where the cheapest endpoint can advocate but not judge, and
    // a different endpoint can judge but is pricier -- neither alone
    // satisfies both roles, so the model must be entirely absent, never
    // silently described as "the" resolved route via either endpoint.
    const result = resolveSharedTribunalRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({
          tag: "advocate-only",
          max_completion_tokens: 1000,
          pricing: { prompt: "0.0000001", completion: "0.0000002" }
        }),
        endpoint({
          tag: "judge-incapable-context",
          max_completion_tokens: 1200,
          context_length: worstCaseAdvocateInputTokens() + ADVOCATE_OUTPUT_CAP_TOKENS + 10,
          max_prompt_tokens: worstCaseAdvocateInputTokens() + 10
        })
      ],
      observedAt: OBSERVED_AT
    });

    expect(result.eligible).toBe(false);
  });
});

describe("listEligibleModels -- pricingObservedAt reflects the actual endpoint fetch timestamp (Section 15E)", () => {
  function providerFixture() {
    const provider = new FakeOpenRouterProvider();
    provider.listModelsResult = [model()];
    provider.listEndpointsResult["openai/gpt-5"] = [
      endpoint({ max_completion_tokens: 1200 })
    ];

    return provider;
  }

  it("E: GET /api/models reports the same endpoint-fetch-timestamp semantics as preflight -- unchanged while the cache stays fresh, updated only on a real refetch", async () => {
    const provider = providerFixture();
    let now = 1_000_000;
    const clock = () => now;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>(undefined, clock);

    const first = await listEligibleModels({ provider, modelCache, endpointCache, clock });
    expect(first[0].pricingObservedAt).toBe(new Date(now).toISOString());

    now += 4 * 60 * 1000; // still fresh
    const second = await listEligibleModels({ provider, modelCache, endpointCache, clock });
    expect(second[0].pricingObservedAt).toBe(first[0].pricingObservedAt);

    now += 60 * 1000; // now exactly 5 minutes since the first fetch -- stale
    const third = await listEligibleModels({ provider, modelCache, endpointCache, clock });
    expect(third[0].pricingObservedAt).toBe(new Date(now).toISOString());
    expect(third[0].pricingObservedAt).not.toBe(first[0].pricingObservedAt);
  });
});

// Missing-cache-timestamp fail-closed regression test (independent
// review, pre-live micro-correction, Section 12B) -- a narrow test-only
// cache subclass simulates a metadata value being returned successfully
// while its observation timestamp is unexpectedly unavailable.
class ObservedAtBlindCache<T> extends ModelMetadataCache<T> {
  observedAt(): string | null {
    return null;
  }
}

describe("listEligibleModels -- fails closed (skips the model) when the cache's observation timestamp is unavailable", () => {
  it("B: never returns a model with a fabricated pricingObservedAt", async () => {
    const provider = new FakeOpenRouterProvider();
    provider.listModelsResult = [model()];
    provider.listEndpointsResult["openai/gpt-5"] = [endpoint({ max_completion_tokens: 1200 })];
    const invocationTime = 5_000_000;
    const clock = () => invocationTime;
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>(undefined, clock);
    const endpointCache = new ObservedAtBlindCache<RawOpenRouterEndpoint[]>(undefined, clock);

    const results = await listEligibleModels({ provider, modelCache, endpointCache, clock });

    expect(results).toHaveLength(0);
  });
});
