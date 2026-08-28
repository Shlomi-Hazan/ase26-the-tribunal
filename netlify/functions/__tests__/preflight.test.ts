import type { HandlerContext, HandlerEvent } from "@netlify/functions";
import { describe, expect, it } from "vitest";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "../../../src/prompts/versions";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";
import { FakeOpenRouterProvider } from "../../server/openrouter/fakeProvider";
import type { PreflightRun, PreflightRunLoader } from "../../server/openrouter/preflight";
import { handler as preflightHandler, handlePreflightRequest } from "../preflight";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function testRun(): PreflightRun {
  return {
    id: RUN_ID,
    caseId: "22222222-2222-4222-8222-222222222222",
    participants: participantIds.map((id: ParticipantId) => ({
      participantId: id,
      modelId: "openai/gpt-5",
      personality: "A measured, professional demeanor.",
      promptVersion: id.startsWith("advocate")
        ? ADVOCATE_PROMPT_VERSION
        : JUDGE_PROMPT_VERSION
    }))
  };
}

class FakeRunLoader implements PreflightRunLoader {
  async getRun(runId: string) {
    return runId === RUN_ID ? testRun() : null;
  }

  async getCase() {
    return {
      defendant: "Alex Rowan",
      act: "Entered the restricted lab.",
      exactQuestion: "Did Alex knowingly violate the lab protocol?"
    };
  }
}

function cheapProvider() {
  const provider = new FakeOpenRouterProvider();
  provider.listModelsResult = [
    { id: "openai/gpt-5", canonical_slug: "openai/gpt-5", name: "Cheap", context_length: 200_000 }
  ];
  provider.listEndpointsResult["openai/gpt-5"] = [
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
  ];

  return provider;
}

describe("POST /api/preflight", () => {
  it("returns an eligible preflight result with decimal-string monetary fields", async () => {
    const response = await handlePreflightRequest(
      {
        httpMethod: "POST",
        body: JSON.stringify({ runId: RUN_ID })
      } as HandlerEvent,
      { runLoader: new FakeRunLoader(), provider: cheapProvider() }
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.preflight.eligible).toBe(true);
    expect(typeof payload.preflight.hardBudgetUsd).toBe("string");
    expect(response.body).not.toContain("OPENROUTER_API_KEY");
  });

  it("rejects a malformed run id with a safe 400", async () => {
    const response = await handlePreflightRequest(
      { httpMethod: "POST", body: JSON.stringify({ runId: "not-a-uuid" }) } as HandlerEvent,
      { runLoader: new FakeRunLoader(), provider: cheapProvider() }
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "").error).toBe("invalid_preflight_request");
  });

  it("rejects malformed JSON with a safe 400", async () => {
    const response = await handlePreflightRequest(
      { httpMethod: "POST", body: "{not json" } as HandlerEvent,
      { runLoader: new FakeRunLoader(), provider: cheapProvider() }
    );

    expect(response.statusCode).toBe(400);
  });

  it("rejects an empty request body with a safe 400", async () => {
    const response = await handlePreflightRequest(
      { httpMethod: "POST", body: null } as HandlerEvent,
      { runLoader: new FakeRunLoader(), provider: cheapProvider() }
    );

    expect(response.statusCode).toBe(400);
  });

  it("rejects extra unknown fields in the request body", async () => {
    const response = await handlePreflightRequest(
      {
        httpMethod: "POST",
        body: JSON.stringify({ runId: RUN_ID, unexpected: true })
      } as HandlerEvent,
      { runLoader: new FakeRunLoader(), provider: cheapProvider() }
    );

    expect(response.statusCode).toBe(400);
  });

  it("returns a safe 404 for an unknown run", async () => {
    const response = await handlePreflightRequest(
      {
        httpMethod: "POST",
        body: JSON.stringify({ runId: "99999999-9999-4999-8999-999999999999" })
      } as HandlerEvent,
      { runLoader: new FakeRunLoader(), provider: cheapProvider() }
    );

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? "").error).toBe("run_not_found");
  });

  it("rejects non-POST methods safely", async () => {
    const response = await handlePreflightRequest(
      { httpMethod: "GET" } as HandlerEvent,
      { runLoader: new FakeRunLoader(), provider: cheapProvider() }
    );

    expect(response.statusCode).toBe(405);
  });

  it("returns a safe JSON error instead of a stack trace when server config is missing", async () => {
    const response = await preflightHandler(
      { httpMethod: "POST", body: JSON.stringify({ runId: RUN_ID }) } as HandlerEvent,
      {} as HandlerContext,
      () => undefined
    );

    expect(response).toBeTruthy();
    expect(response?.statusCode).toBe(502);
    expect(response?.body).not.toContain("/Users/");
    expect(response?.body).not.toContain(" at ");
  });

  it("makes zero real OpenRouter network requests", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      return originalFetch(...args);
    }) as typeof fetch;

    try {
      await handlePreflightRequest(
        { httpMethod: "POST", body: JSON.stringify({ runId: RUN_ID }) } as HandlerEvent,
        { runLoader: new FakeRunLoader(), provider: cheapProvider() }
      );

      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
