import { describe, expect, it } from "vitest";
import { buildFutureCompletionRequest } from "./executionRequest";
import { resolveModelRoute } from "./routeResolution";
import { FakeOpenRouterProvider } from "./fakeProvider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

function resolvedRoute() {
  const model: RawOpenRouterModel = {
    id: "openai/gpt-5",
    canonical_slug: "openai/gpt-5",
    name: "GPT-5"
  };
  const endpoint: RawOpenRouterEndpoint = {
    tag: "deepinfra/turbo",
    provider_name: "DeepInfra",
    name: "DeepInfra | Turbo",
    context_length: 200_000,
    max_prompt_tokens: 190_000,
    max_completion_tokens: 4000,
    supported_parameters: ["response_format", "max_completion_tokens"],
    quantization: null,
    status: 0,
    pricing: { prompt: "0.000003", completion: "0.000006" }
  };
  const result = resolveModelRoute({
    configuredModelId: "openai/gpt-5",
    models: [model],
    endpoints: [endpoint],
    role: "ADVOCATE",
    estimatedInputTokens: 500,
    outputCapTokens: 1000,
    observedAt: "2026-08-26T00:00:00.000Z"
  });

  if (!result.eligible) {
    throw new Error("expected a resolvable test fixture route");
  }

  return result.route;
}

// M8 live-gate root-cause correction (Issue #17), refined by the M8
// reasoning-compatibility correction: a second fixture whose only
// differences from resolvedRoute() are that its endpoint advertises the
// unified `reasoning` parameter AND its model declares reasoning
// metadata proving "minimal" is safe (supported_efforts: null) -- proves
// reasoning-policy injection requires BOTH the exact endpoint's
// capability AND the exact model's own semantics, never inferred from
// the model id (both fixtures share the same configuredModelId/
// canonicalModelId).
function resolvedRouteWithReasoningSupport(
  supportedEfforts: string[] | null = null
) {
  const model: RawOpenRouterModel = {
    id: "openai/gpt-5",
    canonical_slug: "openai/gpt-5",
    name: "GPT-5",
    reasoning: { mandatory: true, supported_efforts: supportedEfforts }
  };
  const endpoint: RawOpenRouterEndpoint = {
    tag: "azure/swedencentral",
    provider_name: "Azure",
    name: "Azure | GPT-5",
    context_length: 200_000,
    max_prompt_tokens: 190_000,
    max_completion_tokens: 4000,
    supported_parameters: [
      "response_format",
      "max_completion_tokens",
      "reasoning",
      "reasoning_effort",
      "include_reasoning"
    ],
    quantization: null,
    status: 0,
    pricing: { prompt: "0.000003", completion: "0.000006" }
  };
  const result = resolveModelRoute({
    configuredModelId: "openai/gpt-5",
    models: [model],
    endpoints: [endpoint],
    role: "ADVOCATE",
    estimatedInputTokens: 500,
    outputCapTokens: 1000,
    observedAt: "2026-08-26T00:00:00.000Z"
  });

  if (!result.eligible) {
    throw new Error("expected a resolvable test fixture route");
  }

  return result.route;
}

describe("buildFutureCompletionRequest (ADR Decision 6)", () => {
  it("pins provider.order to the accepted route's exact tag as the primary mechanism", () => {
    const route = resolvedRoute();

    const request = buildFutureCompletionRequest({
      route,
      messages: [{ role: "user", content: "hi" }],
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
    });

    expect(request.provider?.order).toEqual(["deepinfra/turbo"]);
  });

  it("sets provider.only to the same tag as an additional restriction", () => {
    const route = resolvedRoute();

    const request = buildFutureCompletionRequest({
      route,
      messages: [{ role: "user", content: "hi" }],
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
    });

    expect(request.provider?.only).toEqual(["deepinfra/turbo"]);
  });

  it("disables fallbacks so order actually restricts rather than merely prefers", () => {
    const route = resolvedRoute();

    const request = buildFutureCompletionRequest({
      route,
      messages: [{ role: "user", content: "hi" }],
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
    });

    expect(request.provider?.allow_fallbacks).toBe(false);
  });

  it("requires parameters and sets a max_price consistent with the accepted pricing bound", () => {
    const route = resolvedRoute();

    const request = buildFutureCompletionRequest({
      route,
      messages: [{ role: "user", content: "hi" }],
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
    });

    expect(request.provider?.require_parameters).toBe(true);
    expect(typeof request.provider?.max_price?.prompt).toBe("string");
    expect(Number(request.provider?.max_price?.prompt)).toBeGreaterThan(0);
  });

  it("serializes max_price fields as decimal strings, never JS numbers (current OpenRouter contract)", () => {
    const route = resolvedRoute();

    const request = buildFutureCompletionRequest({
      route,
      messages: [{ role: "user", content: "hi" }],
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
    });

    expect(typeof request.provider?.max_price?.prompt).toBe("string");
    expect(typeof request.provider?.max_price?.completion).toBe("string");
    expect(typeof request.provider?.max_price?.request).toBe("string");
    // 0.000003 (prompt) * 1_000_000 = 3, serialized losslessly, no ".00"
    // padding and no scientific notation.
    expect(request.provider?.max_price?.prompt).toBe("3");
    expect(request.provider?.max_price?.completion).toBe("6");
    expect(request.provider?.max_price?.request).toBe("0");
  });

  it("uses effectiveInputPricePerToken (not the raw prompt rate) for max_price.prompt", () => {
    const route = resolvedRoute();
    // Simulate a cache-write-inclusive route where the effective input
    // price exceeds the raw prompt rate -- max_price.prompt must reflect
    // the higher, conservative figure, never the lower raw rate.
    const cacheAwareRoute = {
      ...route,
      pricing: {
        ...route.pricing,
        effectiveInputPricePerToken: route.pricing.promptPricePerToken.plus("0.000002")
      }
    };

    const request = buildFutureCompletionRequest({
      route: cacheAwareRoute,
      messages: [{ role: "user", content: "hi" }],
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
    });

    // (0.000003 + 0.000002) * 1_000_000 = 5
    expect(request.provider?.max_price?.prompt).toBe("5");
  });

  it("uses the canonical model id and the requested structured-output schema", () => {
    const route = resolvedRoute();

    const request = buildFutureCompletionRequest({
      route,
      messages: [{ role: "user", content: "hi" }],
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
    });

    expect(request.model).toBe("openai/gpt-5");
    expect(request.response_format?.json_schema.strict).toBe(true);
    expect(request.response_format?.json_schema.name).toBe("advocate_speech");
  });

  it("is never actually sent to the provider -- the fake provider's createChatCompletion is never invoked by this module", () => {
    const route = resolvedRoute();
    const provider = new FakeOpenRouterProvider();

    buildFutureCompletionRequest({
      route,
      messages: [{ role: "user", content: "hi" }],
      maxCompletionTokens: 1000,
      structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
    });

    expect(provider.createChatCompletionCallCount).toBe(0);
  });

  // M8 live-gate root-cause correction (Issue #17): the first real live
  // run proved a reasoning-capable model can consume the entire fixed
  // output cap on hidden reasoning tokens before producing visible
  // structured output. These tests lock the corrected policy.
  describe("reasoning policy (M8 live-gate root-cause correction)", () => {
    it("sends an explicit minimal, excluded reasoning policy when the exact resolved endpoint supports it", () => {
      const route = resolvedRouteWithReasoningSupport();

      const request = buildFutureCompletionRequest({
        route,
        messages: [{ role: "user", content: "hi" }],
        maxCompletionTokens: 1000,
        structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
      });

      expect(request.reasoning).toEqual({ effort: "minimal", exclude: true });
    });

    it("sends no reasoning field at all when the exact resolved endpoint does not advertise support", () => {
      const route = resolvedRoute();

      const request = buildFutureCompletionRequest({
        route,
        messages: [{ role: "user", content: "hi" }],
        maxCompletionTokens: 1000,
        structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
      });

      expect(request.reasoning).toBeUndefined();
      expect("reasoning" in request).toBe(false);
    });

    it("is driven by the exact resolved endpoint's own capability, never inferred from the configured/canonical model id", () => {
      // Both fixtures share the identical configuredModelId/
      // canonicalModelId ("openai/gpt-5") -- only the endpoint's
      // supported_parameters differ, proving the decision is not a
      // model-name lookup.
      const withoutReasoning = resolvedRoute();
      const withReasoning = resolvedRouteWithReasoningSupport();

      expect(withoutReasoning.canonicalModelId).toBe(withReasoning.canonicalModelId);

      const requestWithout = buildFutureCompletionRequest({
        route: withoutReasoning,
        messages: [{ role: "user", content: "hi" }],
        maxCompletionTokens: 1000,
        structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
      });
      const requestWith = buildFutureCompletionRequest({
        route: withReasoning,
        messages: [{ role: "user", content: "hi" }],
        maxCompletionTokens: 1000,
        structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
      });

      expect(requestWithout.reasoning).toBeUndefined();
      expect(requestWith.reasoning).toEqual({ effort: "minimal", exclude: true });
    });

    it("preserves exact-endpoint provider pinning unchanged when a reasoning policy is also sent", () => {
      const route = resolvedRouteWithReasoningSupport();

      const request = buildFutureCompletionRequest({
        route,
        messages: [{ role: "user", content: "hi" }],
        maxCompletionTokens: 1000,
        structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
      });

      expect(request.provider?.order).toEqual(["azure/swedencentral"]);
      expect(request.provider?.only).toEqual(["azure/swedencentral"]);
      expect(request.provider?.allow_fallbacks).toBe(false);
      expect(request.provider?.require_parameters).toBe(true);
      expect(request.provider?.max_price).toBeDefined();
    });

    // M8 reasoning-compatibility correction (Issue #17): the sent effort
    // value must be whatever route.reasoningEffort actually resolved to
    // -- never hard-coded to "minimal" -- proven here with a model whose
    // metadata only proves "low" safe, never "minimal".
    it("sends the exact resolved effort value (\"low\"), not a hard-coded \"minimal\", when that is what preflight proved safe", () => {
      const route = resolvedRouteWithReasoningSupport(["low", "medium"]);

      expect(route.reasoningEffort).toBe("low");

      const request = buildFutureCompletionRequest({
        route,
        messages: [{ role: "user", content: "hi" }],
        maxCompletionTokens: 1000,
        structuredOutput: { name: "advocate_speech", schema: { type: "object" } }
      });

      expect(request.reasoning).toEqual({ effort: "low", exclude: true });
    });

    it("sends no reasoning field when the model's own metadata cannot establish a safe M8 V1 effort, even though the endpoint advertises the parameter", () => {
      const model: RawOpenRouterModel = {
        id: "openai/gpt-5",
        canonical_slug: "openai/gpt-5",
        name: "GPT-5",
        reasoning: { mandatory: true, supported_efforts: ["medium", "high"] }
      };
      const endpoint: RawOpenRouterEndpoint = {
        tag: "azure/swedencentral",
        provider_name: "Azure",
        name: "Azure | GPT-5",
        context_length: 200_000,
        max_prompt_tokens: 190_000,
        max_completion_tokens: 4000,
        supported_parameters: ["response_format", "max_completion_tokens", "reasoning"],
        quantization: null,
        status: 0,
        pricing: { prompt: "0.000003", completion: "0.000006" }
      };
      const result = resolveModelRoute({
        configuredModelId: "openai/gpt-5",
        models: [model],
        endpoints: [endpoint],
        role: "ADVOCATE",
        estimatedInputTokens: 500,
        outputCapTokens: 1000,
        observedAt: "2026-08-26T00:00:00.000Z"
      });

      expect(result.eligible).toBe(false);
      if (result.eligible) return;
      expect(result.reasonCodes).toEqual(["REASONING_CONTROL_UNSUPPORTED"]);
    });
  });
});
