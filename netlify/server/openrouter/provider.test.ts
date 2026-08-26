import { describe, expect, it } from "vitest";
import { readOpenRouterServerConfig } from "../env";
import { ServerConfigError } from "../env";
import { PROVIDER_ATTEMPT_TIMEOUT_MS, RealOpenRouterProvider } from "./provider";
import { ProviderError } from "./errors";

describe("readOpenRouterServerConfig", () => {
  it("throws a typed ServerConfigError when OPENROUTER_API_KEY is missing", () => {
    expect(() => readOpenRouterServerConfig({})).toThrow(ServerConfigError);
  });

  it("returns a valid config when injected", () => {
    const config = readOpenRouterServerConfig({ OPENROUTER_API_KEY: "test-key" });

    expect(config.OPENROUTER_API_KEY).toBe("test-key");
  });

  it("never echoes the attempted (even if partially set) value in its error message", () => {
    try {
      readOpenRouterServerConfig({ OPENROUTER_API_KEY: "" });
      throw new Error("expected readOpenRouterServerConfig to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ServerConfigError);
      expect((error as Error).message).not.toContain("test-key");
    }
  });
});

function fakeFetch(
  responses: Array<{ ok: boolean; status: number; json: () => Promise<unknown> }>
): typeof fetch {
  let call = 0;

  return (async () => {
    const response = responses[Math.min(call, responses.length - 1)];
    call += 1;

    return response as unknown as Response;
  }) as typeof fetch;
}

describe("RealOpenRouterProvider", () => {
  const config = { OPENROUTER_API_KEY: "test-key" };

  it("parses a valid model list successfully", async () => {
    const fetchImpl = fakeFetch([
      {
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ id: "openai/gpt-5", canonical_slug: "openai/gpt-5" }]
        })
      }
    ]);
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    const models = await provider.listModels();

    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("openai/gpt-5");
  });

  it("normalizes malformed model list JSON as INVALID_PROVIDER_RESPONSE", async () => {
    const fetchImpl = fakeFetch([
      { ok: true, status: 200, json: async () => ({ notData: [] }) }
    ]);
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    await expect(provider.listModels()).rejects.toMatchObject({
      category: "INVALID_PROVIDER_RESPONSE"
    });
  });

  it("parses a valid endpoint list successfully", async () => {
    const fetchImpl = fakeFetch([
      {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            endpoints: [
              {
                tag: "openai",
                pricing: { prompt: "0.00001", completion: "0.00002" }
              }
            ]
          }
        })
      }
    ]);
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    const endpoints = await provider.listEndpoints("openai", "gpt-5");

    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].tag).toBe("openai");
  });

  it("normalizes malformed endpoint list JSON as INVALID_PROVIDER_RESPONSE", async () => {
    const fetchImpl = fakeFetch([{ ok: true, status: 200, json: async () => ({}) }]);
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    await expect(provider.listEndpoints("openai", "gpt-5")).rejects.toMatchObject({
      category: "INVALID_PROVIDER_RESPONSE"
    });
  });

  it("normalizes HTTP 401 as AUTHENTICATION", async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 401, json: async () => ({}) }]);
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    await expect(provider.listModels()).rejects.toMatchObject({
      category: "AUTHENTICATION"
    });
  });

  it("normalizes HTTP 403 as AUTHENTICATION", async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 403, json: async () => ({}) }]);
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    await expect(provider.listModels()).rejects.toMatchObject({
      category: "AUTHENTICATION"
    });
  });

  it("normalizes HTTP 429 as RATE_LIMITED", async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 429, json: async () => ({}) }]);
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    await expect(provider.listModels()).rejects.toMatchObject({
      category: "RATE_LIMITED"
    });
  });

  it("normalizes HTTP 500 as PROVIDER_5XX", async () => {
    const fetchImpl = fakeFetch([{ ok: false, status: 500, json: async () => ({}) }]);
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    await expect(provider.listModels()).rejects.toMatchObject({
      category: "PROVIDER_5XX"
    });
  });

  it("normalizes a network-level fetch rejection as TRANSIENT_NETWORK", async () => {
    const fetchImpl = (async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as typeof fetch;
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    await expect(provider.listModels()).rejects.toMatchObject({
      category: "TRANSIENT_NETWORK"
    });
  });

  it("normalizes an aborted (timed-out) request as TIMEOUT", async () => {
    const fetchImpl = (async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    }) as typeof fetch;
    const provider = new RealOpenRouterProvider(config, fetchImpl, 10);

    await expect(provider.listModels()).rejects.toMatchObject({ category: "TIMEOUT" });
  });

  it("caps the per-attempt timeout at 60 seconds by default", () => {
    expect(PROVIDER_ATTEMPT_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("rejects invalid provider preferences in createChatCompletion before sending a request", async () => {
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;
    const provider = new RealOpenRouterProvider(config, fetchImpl);

    await expect(
      provider.createChatCompletion({
        model: "openai/gpt-5",
        messages: [{ role: "user", content: "hi" }],
        max_completion_tokens: 100,
        // @ts-expect-error -- intentionally invalid shape for this test
        provider: { order: "not-an-array" }
      })
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetchCalled).toBe(false);
  });
});
