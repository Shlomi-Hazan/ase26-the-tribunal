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

// M9 (Separate-Model Tribunal, Issue #20) -- role-aware discovery via
// GET /api/models?role=ADVOCATE|JUDGE. No role param must remain byte-
// for-byte the same M8 Shared-Tribunal response as above.
describe("GET /api/models?role=... (M9 role-aware discovery)", () => {
  function providerWithAdvocateOnlyModel() {
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
        // Below the judge minimum (1200) but at/above the advocate
        // minimum (1000).
        max_completion_tokens: 1000,
        supported_parameters: ["response_format", "max_completion_tokens"],
        quantization: null,
        status: 0,
        pricing: { prompt: "0.000003", completion: "0.000006" }
      }
    ];

    return provider;
  }

  // M9 pre-live audit correction (Issue #20): the exact locked contract
  // -- A/B/C confirm the two valid states, D/E/F/G confirm every invalid
  // shape (including the previously-mishandled explicit empty string and
  // whitespace-only value) fails closed with a 400, never a silent
  // Shared fallback. Case sensitivity is never loosened.
  it("A: no role param -> existing Shared behavior unchanged", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: null } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.models[0]).toHaveProperty("conservativeFullTribunalEstimateUsd");
  });

  it("B: role=ADVOCATE -> the ADVOCATE role catalog", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "ADVOCATE" } } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.models[0].role).toBe("ADVOCATE");
  });

  it("C: role=JUDGE -> the JUDGE role catalog", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "JUDGE" } } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.models[0].role).toBe("JUDGE");
  });

  it("D: role=advocate (wrong case) -> 400, never silently falling back to Shared behavior", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "advocate" } } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );

    expect(response.statusCode).toBe(400);
    const payload = JSON.parse(response.body ?? "");
    expect(payload.error).toBe("invalid_role");
  });

  it("E: role=EVERYONE (unrelated value) -> 400", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "EVERYONE" } } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );

    expect(response.statusCode).toBe(400);
  });

  it("F: role= (explicitly supplied empty string) -> 400, never a silent Shared fallback", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "" } } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );

    expect(response.statusCode).toBe(400);
    const payload = JSON.parse(response.body ?? "");
    expect(payload.error).toBe("invalid_role");
  });

  it("G: whitespace-only role -> 400, never a silent Shared fallback", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "   " } } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );

    expect(response.statusCode).toBe(400);
    const payload = JSON.parse(response.body ?? "");
    expect(payload.error).toBe("invalid_role");
  });

  it("R: no role query param still returns exactly the M8 Shared-Tribunal response shape", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: null } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.models.some((m: { conservativeFullTribunalEstimateUsd?: string }) => "conservativeFullTribunalEstimateUsd" in m)).toBe(true);
  });

  it("S: role=ADVOCATE includes a model the Shared/JUDGE catalogs exclude", async () => {
    const provider = providerWithAdvocateOnlyModel();

    const advocateResponse = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "ADVOCATE" } } as unknown as HandlerEvent,
      { provider }
    );
    const judgeResponse = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "JUDGE" } } as unknown as HandlerEvent,
      { provider }
    );
    const sharedResponse = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: null } as unknown as HandlerEvent,
      { provider }
    );

    const advocatePayload = JSON.parse(advocateResponse.body ?? "");
    const judgePayload = JSON.parse(judgeResponse.body ?? "");
    const sharedPayload = JSON.parse(sharedResponse.body ?? "");

    expect(advocatePayload.models.map((m: { id: string }) => m.id)).toContain(
      "openai/gpt-5-advocate-only"
    );
    expect(advocatePayload.models[0].role).toBe("ADVOCATE");
    expect(judgePayload.models.map((m: { id: string }) => m.id)).not.toContain(
      "openai/gpt-5-advocate-only"
    );
    expect(sharedPayload.models.map((m: { id: string }) => m.id)).not.toContain(
      "openai/gpt-5-advocate-only"
    );
  });

  it("role-catalog entries expose a participant-scoped estimate field, never the Shared full-Tribunal field", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "ADVOCATE" } } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );
    const payload = JSON.parse(response.body ?? "");
    const entry = payload.models[0];

    expect(entry).toHaveProperty("conservativeParticipantEstimateUsd");
    expect(entry).not.toHaveProperty("conservativeFullTribunalEstimateUsd");
    expect(entry).not.toHaveProperty("priceTier");
  });

  it("never exposes a credential in the role-aware response", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "GET", queryStringParameters: { role: "ADVOCATE" } } as unknown as HandlerEvent,
      { provider: providerWithModels() }
    );

    expect(response.body).not.toContain("OPENROUTER_API_KEY");
    expect(response.body).not.toContain("Bearer ");
  });
});
