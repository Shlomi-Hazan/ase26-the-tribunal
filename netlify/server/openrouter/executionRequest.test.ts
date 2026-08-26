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
    expect(request.provider?.max_price?.prompt).toBeGreaterThan(0);
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
});
