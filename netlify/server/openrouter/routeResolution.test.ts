import { describe, expect, it } from "vitest";
import {
  checkAliasOrDynamicModel,
  isUniquelyPinnable,
  evaluateEndpoint,
  resolveModelRoute,
  computeCandidateAttemptCostUsd
} from "./routeResolution";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

function endpoint(overrides: Partial<RawOpenRouterEndpoint> = {}): RawOpenRouterEndpoint {
  return {
    tag: "openai",
    provider_name: "OpenAI",
    name: "OpenAI | GPT-5",
    context_length: 200_000,
    max_prompt_tokens: 190_000,
    max_completion_tokens: 4000,
    supported_parameters: ["response_format", "max_completion_tokens"],
    quantization: null,
    status: 0,
    pricing: { prompt: "0.000003", completion: "0.000006" },
    ...overrides
  };
}

function model(overrides: Partial<RawOpenRouterModel> = {}): RawOpenRouterModel {
  return {
    id: "openai/gpt-5",
    canonical_slug: "openai/gpt-5",
    name: "GPT-5",
    context_length: 200_000,
    ...overrides
  };
}

describe("checkAliasOrDynamicModel (ADR Decision 8)", () => {
  it("blocks openrouter/auto with DYNAMIC_MODEL_UNSUPPORTED", () => {
    expect(checkAliasOrDynamicModel("openrouter/auto")).toEqual({
      blocked: true,
      reasonCode: "DYNAMIC_MODEL_UNSUPPORTED"
    });
  });

  it("blocks a tilde-alias model ID with MODEL_ALIAS_NOT_PINNED", () => {
    expect(checkAliasOrDynamicModel("openai/gpt-5~latest")).toEqual({
      blocked: true,
      reasonCode: "MODEL_ALIAS_NOT_PINNED"
    });
  });

  it("never mutates the configured model ID -- the check is read-only", () => {
    const modelId = "openai/gpt-5~latest";
    checkAliasOrDynamicModel(modelId);

    expect(modelId).toBe("openai/gpt-5~latest");
  });

  it("does not block an ordinary stable model ID", () => {
    expect(checkAliasOrDynamicModel("openai/gpt-5")).toEqual({ blocked: false });
  });
});

describe("isUniquelyPinnable (ADR Decision 4A)", () => {
  it("A: a full variant/region slug with no sibling is uniquely pinnable", () => {
    expect(isUniquelyPinnable("deepinfra/turbo", ["deepinfra/turbo"])).toBe(true);
  });

  it("B: a base slug with a sibling full-variant slug is NOT uniquely pinnable", () => {
    expect(
      isUniquelyPinnable("deepinfra", ["deepinfra", "deepinfra/turbo"])
    ).toBe(false);
  });

  it("B: the sibling full-variant slug itself remains uniquely pinnable", () => {
    expect(
      isUniquelyPinnable("deepinfra/turbo", ["deepinfra", "deepinfra/turbo"])
    ).toBe(true);
  });

  it("C: a bare base slug with no current sibling is uniquely pinnable today", () => {
    expect(isUniquelyPinnable("deepinfra", ["deepinfra"])).toBe(true);
  });

  it("blocks a duplicate exact full-variant tag as malformed metadata", () => {
    expect(
      isUniquelyPinnable("deepinfra/turbo", ["deepinfra/turbo", "deepinfra/turbo"])
    ).toBe(false);
  });
});

describe("evaluateEndpoint eligibility (ADR Decision 4)", () => {
  const shared = {
    modelId: "openai/gpt-5",
    estimatedInputTokens: 500,
    outputCapTokens: 1000,
    allTagsForModel: ["openai"] as string[],
    observedAt: "2026-08-26T00:00:00.000Z"
  };

  it("accepts a fully eligible advocate endpoint", () => {
    const result = evaluateEndpoint({ ...shared, endpoint: endpoint(), role: "ADVOCATE" });

    expect(result.eligible).toBe(true);
  });

  it("blocks structured-output-unsupported endpoints", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ supported_parameters: ["max_completion_tokens"] }),
      role: "ADVOCATE"
    });

    expect(result).toEqual({ eligible: false, reasonCode: "STRUCTURED_OUTPUT_UNSUPPORTED" });
  });

  it("blocks bounded-output-unsupported endpoints (missing supported_parameters entry)", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ supported_parameters: ["response_format"] }),
      role: "ADVOCATE"
    });

    expect(result).toEqual({ eligible: false, reasonCode: "BOUNDED_OUTPUT_UNSUPPORTED" });
  });

  it("blocks an advocate endpoint whose max_completion_tokens is 999", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ max_completion_tokens: 999 }),
      role: "ADVOCATE"
    });

    expect(result).toEqual({ eligible: false, reasonCode: "BOUNDED_OUTPUT_UNSUPPORTED" });
  });

  it("accepts an advocate endpoint whose max_completion_tokens is exactly 1000", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ max_completion_tokens: 1000 }),
      role: "ADVOCATE"
    });

    expect(result.eligible).toBe(true);
  });

  it("blocks a judge endpoint whose max_completion_tokens is 1199", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ max_completion_tokens: 1199 }),
      role: "JUDGE",
      outputCapTokens: 1200
    });

    expect(result).toEqual({ eligible: false, reasonCode: "BOUNDED_OUTPUT_UNSUPPORTED" });
  });

  it("accepts a judge endpoint whose max_completion_tokens is exactly 1200", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ max_completion_tokens: 1200 }),
      role: "JUDGE",
      outputCapTokens: 1200
    });

    expect(result.eligible).toBe(true);
  });

  it("blocks when max_completion_tokens is unknown (null)", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ max_completion_tokens: null }),
      role: "ADVOCATE"
    });

    expect(result).toEqual({ eligible: false, reasonCode: "BOUNDED_OUTPUT_UNSUPPORTED" });
  });

  it("blocks context-too-small endpoints", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ context_length: 1000 }),
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000
    });

    expect(result).toEqual({ eligible: false, reasonCode: "CONTEXT_TOO_SMALL" });
  });

  it("blocks when max_prompt_tokens is smaller than the estimated input", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ max_prompt_tokens: 100 }),
      role: "ADVOCATE",
      estimatedInputTokens: 500
    });

    expect(result).toEqual({ eligible: false, reasonCode: "CONTEXT_TOO_SMALL" });
  });

  it("does not block when max_prompt_tokens is absent (not available)", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ max_prompt_tokens: null }),
      role: "ADVOCATE"
    });

    expect(result.eligible).toBe(true);
  });

  it("blocks an unavailable endpoint (non-zero numeric status)", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ status: -1 }),
      role: "ADVOCATE"
    });

    expect(result).toEqual({ eligible: false, reasonCode: "ENDPOINT_UNAVAILABLE" });
  });

  it("blocks a not-uniquely-pinnable endpoint with ENDPOINT_NOT_PINNABLE", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({ tag: "deepinfra" }),
      role: "ADVOCATE",
      allTagsForModel: ["deepinfra", "deepinfra/turbo"]
    });

    expect(result).toEqual({ eligible: false, reasonCode: "ENDPOINT_NOT_PINNABLE" });
  });

  it("propagates a pricing block (non-empty overrides) as PRICING_UNREPRESENTABLE", () => {
    const result = evaluateEndpoint({
      ...shared,
      endpoint: endpoint({
        pricing: {
          prompt: "0.000003",
          completion: "0.000006",
          overrides: [{ min_prompt_tokens: 1000 }]
        }
      }),
      role: "ADVOCATE"
    });

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });
});

describe("resolveModelRoute (ADR Decisions 2, 5)", () => {
  it("resolves MODEL_NOT_FOUND for an unknown model id", () => {
    const result = resolveModelRoute({
      configuredModelId: "unknown/model",
      models: [model()],
      endpoints: [endpoint()],
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(result).toEqual({ eligible: false, reasonCodes: ["MODEL_NOT_FOUND"] });
  });

  it("resolves ENDPOINT_UNAVAILABLE when there are no endpoints at all", () => {
    const result = resolveModelRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [],
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(result).toEqual({ eligible: false, reasonCodes: ["ENDPOINT_UNAVAILABLE"] });
  });

  it("blocks a base slug matching multiple variants with ENDPOINT_NOT_PINNABLE, keeps the full-variant slug eligible", () => {
    const result = resolveModelRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({ tag: "deepinfra", pricing: { prompt: "0.000001", completion: "0.000002" } }),
        endpoint({
          tag: "deepinfra/turbo",
          pricing: { prompt: "0.000005", completion: "0.000006" }
        })
      ],
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    // The base-slug endpoint is cheaper but not pinnable -- it must never
    // be selected merely because it is cheapest.
    expect(result.route.providerEndpointTag).toBe("deepinfra/turbo");
  });

  it("D: resolves ENDPOINT_NOT_PINNABLE when no candidate is uniquely pinnable", () => {
    const result = resolveModelRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      // Two endpoints sharing the identical duplicate tag "deepinfra" --
      // malformed/ambiguous metadata: neither is uniquely pinnable.
      endpoints: [endpoint({ tag: "deepinfra" }), endpoint({ tag: "deepinfra" })],
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(result.eligible).toBe(false);
    if (result.eligible) return;
    expect(result.reasonCodes).toContain("ENDPOINT_NOT_PINNABLE");
  });

  it("selects the lowest-cost ELIGIBLE endpoint, skipping a cheaper-but-incapable one", () => {
    const result = resolveModelRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({
          tag: "cheap-incapable",
          pricing: { prompt: "0.0000001", completion: "0.0000002" },
          supported_parameters: ["max_completion_tokens"] // no response_format
        }),
        endpoint({
          tag: "eligible",
          pricing: { prompt: "0.000005", completion: "0.000006" }
        })
      ],
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.route.providerEndpointTag).toBe("eligible");
  });

  it("ties break deterministically by providerEndpointTag lexical order", () => {
    const result = resolveModelRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({ tag: "zzz-provider" }),
        endpoint({ tag: "aaa-provider" })
      ],
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.route.providerEndpointTag).toBe("aaa-provider");
  });

  it("blocks the whole model with DYNAMIC_MODEL_UNSUPPORTED for openrouter/auto, never resolving endpoints", () => {
    const result = resolveModelRoute({
      configuredModelId: "openrouter/auto",
      models: [model({ id: "openrouter/auto" })],
      endpoints: [endpoint()],
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(result).toEqual({ eligible: false, reasonCodes: ["DYNAMIC_MODEL_UNSUPPORTED"] });
  });

  it("resolved route's pricing and identity remain coupled to the accepted endpoint", () => {
    const result = resolveModelRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [endpoint({ tag: "openai" })],
      role: "ADVOCATE",
      estimatedInputTokens: 500,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.route.pricing.providerEndpointTag).toBe(result.route.providerEndpointTag);
    expect(result.route.isUniquelyPinnable).toBe(true);
  });
});

describe("computeCandidateAttemptCostUsd", () => {
  it("includes effective input price, completion price, and request fee", () => {
    const resolved = resolveModelRoute({
      configuredModelId: "openai/gpt-5",
      models: [model()],
      endpoints: [
        endpoint({ pricing: { prompt: "0.000003", completion: "0.000006", request: "0.001" } })
      ],
      role: "ADVOCATE",
      estimatedInputTokens: 1000,
      outputCapTokens: 1000,
      observedAt: "2026-08-26T00:00:00.000Z"
    });

    expect(resolved.eligible).toBe(true);
    if (!resolved.eligible) return;
    const cost = computeCandidateAttemptCostUsd(resolved.route.pricing, 1000, 1000);

    // 1000 * 0.000003 + 1000 * 0.000006 + 0.001 = 0.003 + 0.006 + 0.001 = 0.01
    expect(cost.toString()).toBe("0.01");
  });
});
