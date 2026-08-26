import type { HandlerEvent } from "@netlify/functions";
import { describe, expect, it } from "vitest";
import { FakeOpenRouterProvider } from "../../server/openrouter/fakeProvider";
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
      providerWithModels()
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
      providerWithModels()
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
      providerWithModels()
    );

    expect(response.body).not.toContain("OPENROUTER_API_KEY");
    expect(response.body).not.toContain("Bearer ");
  });

  it("rejects non-GET methods safely", async () => {
    const response = await handleModelsRequest(
      { httpMethod: "POST" } as HandlerEvent,
      providerWithModels()
    );

    expect(response.statusCode).toBe(405);
  });
});
