import type { HandlerEvent } from "@netlify/functions";
import { describe, expect, it } from "vitest";
import { FakeOpenRouterProvider } from "../../server/openrouter/fakeProvider";
import { ModelMetadataCache } from "../../server/openrouter/cache";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../../server/openrouter/schemas";
import { handleModelsRequest } from "../models";

function providerWithModels() {
  const provider = new FakeOpenRouterProvider();
  provider.listModelsResult = [
    { id: "openai/gpt-5-free", canonical_slug: "openai/gpt-5-free", name: "Free", context_length: 200_000 },
    { id: "openai/gpt-5-paid", canonical_slug: "openai/gpt-5-paid", name: "Paid", context_length: 200_000 },
    { id: "openai/gpt-5-incapable", canonical_slug: "openai/gpt-5-incapable", name: "Incapable", context_length: 200_000 }
  ];
  provider.listEndpointsResult["openai/gpt-5-free"] = [
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
      pricing: { prompt: "0", completion: "0" }
    }
  ];
  provider.listEndpointsResult["openai/gpt-5-paid"] = [
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
      pricing: { prompt: "0.000003", completion: "0.000006" }
    }
  ];
  provider.listEndpointsResult["openai/gpt-5-incapable"] = [
    {
      tag: "openai",
      provider_name: "OpenAI",
      name: "OpenAI",
      context_length: 200_000,
      max_prompt_tokens: 190_000,
      max_completion_tokens: 4000,
      supported_parameters: ["max_completion_tokens"], // no response_format
      quantization: null,
      status: 0,
      pricing: { prompt: "0.000001", completion: "0.000002" }
    }
  ];

  return provider;
}

describe("GET /api/models", () => {
  it("returns only eligible, sanitized models -- never the raw catalog shape", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET" } as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    const ids = payload.models.map((m: { id: string }) => m.id);
    expect(ids).toContain("openai/gpt-5-free");
    expect(ids).toContain("openai/gpt-5-paid");
    expect(ids).not.toContain("openai/gpt-5-incapable");
  });

  it("marks the zero-priced model as FREE and the paid one as a paid tier", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET" } as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");
    const byId = Object.fromEntries(
      payload.models.map((m: { id: string; priceTier: string }) => [m.id, m])
    );

    expect(byId["openai/gpt-5-free"].priceTier).toBe("FREE");
    expect(byId["openai/gpt-5-free"].isFree).toBe(true);
    expect(byId["openai/gpt-5-paid"].priceTier).not.toBe("FREE");
  });

  it("never exposes a credential in the response", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET" } as HandlerEvent,
      { provider: providerWithModels() }
    );

    expect(response.body).not.toContain("OPENROUTER_API_KEY");
    expect(response.body).not.toContain("Bearer ");
  });

  it("rejects non-GET methods safely", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "POST" } as HandlerEvent,
      { provider: providerWithModels() }
    );

    expect(response.statusCode).toBe(405);
  });

  it("exposes conservativeFullTribunalEstimateUsd (never the old misleading single-call name)", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET" } as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");
    const paid = payload.models.find((m: { id: string }) => m.id === "openai/gpt-5-paid");

    expect(paid).toHaveProperty("conservativeFullTribunalEstimateUsd");
    expect(paid).not.toHaveProperty("conservativeSingleCallEstimateUsd");
    expect(typeof paid.conservativeFullTribunalEstimateUsd).toBe("string");
    expect(Number(paid.conservativeFullTribunalEstimateUsd)).toBeGreaterThan(0);
  });

  it("reuses fresh metadata across a warm invocation within the TTL (module-scope cache wiring)", async () => {
    const provider = providerWithModels();
    const modelCache = new ModelMetadataCache<RawOpenRouterModel[]>();
    const endpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>();

    await handleModelsRequest({ httpMethod: "GET" } as HandlerEvent, {
      provider,
      modelCache,
      endpointCache
    });
    const callCountAfterFirst = provider.listModelsCallCount;

    await handleModelsRequest({ httpMethod: "GET" } as HandlerEvent, {
      provider,
      modelCache,
      endpointCache
    });

    expect(provider.listModelsCallCount).toBe(callCountAfterFirst);
  });

  it("excludes an advocate-capable, judge-incapable model from the HTTP response (Sections 3-6 regression)", async () => {
    const provider = new FakeOpenRouterProvider();
    provider.listModelsResult = [
      {
        id: "openai/gpt-5-advocate-only",
        canonical_slug: "openai/gpt-5-advocate-only",
        name: "Advocate Only",
        context_length: 200_000
      }
    ];
    provider.listEndpointsResult["openai/gpt-5-advocate-only"] = [
      {
        tag: "openai",
        provider_name: "OpenAI",
        name: "OpenAI",
        context_length: 200_000,
        max_prompt_tokens: 190_000,
        // Below the judge minimum (1200) but above the advocate minimum
        // (1000) -- the previous, advocate-only resolution would have
        // returned this model; the corrected dual-role resolution must not.
        max_completion_tokens: 1100,
        supported_parameters: ["response_format", "max_completion_tokens"],
        quantization: null,
        status: 0,
        pricing: { prompt: "0.000003", completion: "0.000006" }
      }
    ];

    const response = await handleModelsRequest(
      { httpMethod: "GET" } as HandlerEvent,
      { provider }
    );
    const payload = JSON.parse(response.body ?? "");

    expect(payload.models.map((m: { id: string }) => m.id)).not.toContain(
      "openai/gpt-5-advocate-only"
    );
  });

  it("exposes pricingObservedAt as the endpoint metadata fetch timestamp", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET" } as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");
    const paid = payload.models.find((m: { id: string }) => m.id === "openai/gpt-5-paid");

    expect(paid).toHaveProperty("pricingObservedAt");
    expect(typeof paid.pricingObservedAt).toBe("string");
    expect(() => new Date(paid.pricingObservedAt).toISOString()).not.toThrow();
  });
});
