import type { HandlerEvent } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { packageSeats } from "../../../src/schemas/tribunalSetup";
import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../../../src/prompts/versions";
import { EXTRACTION_OUTPUT_CAP_TOKENS } from "../../server/extraction/constants";
import { FakeExtractionProvider, fakeChatCompletionResult } from "../../server/extraction/fakeProvider";
import { FakeExtractionRepository } from "../../server/extraction/fakeRepository";
import type { ExtractionSourceDeps } from "../../server/extraction/service";
import { handleSetupExtractionsPreflightRequest } from "../setup-extractions-preflight";
import { handleSetupExtractionsRequest } from "../setup-extractions";
import { handleSetupExtractionsRetryRequest } from "../setup-extractions-retry";

const CONFIGURED_MODEL_ID = "vendor/extraction-model";

function fakeEvent(overrides: Partial<HandlerEvent>): HandlerEvent {
  return {
    httpMethod: "POST",
    headers: {},
    queryStringParameters: {},
    body: null,
    ...overrides
  } as HandlerEvent;
}

// A fully-populated, zero-warning fixture -- a clean "success" outcome.
// Every required field has a real value, satisfying the server-side
// semantic validation (Section 10) with no warnings needed at all.
function goodExtractionJson() {
  return JSON.stringify({
    chargeSheet: {
      defendant: "The Accused",
      act: "Did the thing.",
      exactQuestion: "Did they do the thing?"
    },
    participants: Object.fromEntries(
      packageSeats.map((seat) => [
        seat,
        { profileName: null, personality: `${seat} personality.` }
      ])
    ),
    warnings: []
  });
}

function makeDeps(): ExtractionSourceDeps {
  const provider = new FakeExtractionProvider();

  provider.listModelsResult = [{ id: CONFIGURED_MODEL_ID, canonical_slug: CONFIGURED_MODEL_ID }];
  provider.listEndpointsResult = {
    [CONFIGURED_MODEL_ID]: [
      {
        tag: `${CONFIGURED_MODEL_ID}/endpoint-a`,
        supported_parameters: ["response_format", "max_completion_tokens"],
        max_completion_tokens: EXTRACTION_OUTPUT_CAP_TOKENS,
        context_length: 500_000,
        max_prompt_tokens: 400_000,
        pricing: { prompt: "0.0000001", completion: "0.0000002" }
      }
    ]
  };
  provider.createChatCompletionResult = fakeChatCompletionResult({ contentJson: goodExtractionJson() });

  return {
    provider,
    repository: new FakeExtractionRepository(),
    sourceIp: "203.0.113.9",
    configuredModelId: CONFIGURED_MODEL_ID,
    promptVersion: PACKAGE_EXTRACTION_PROMPT_VERSION
  };
}

describe("POST /api/setup-extractions/preflight handler", () => {
  it("405s on a non-POST method", async () => {
    const result = await handleSetupExtractionsPreflightRequest(
      fakeEvent({ httpMethod: "GET" }),
      makeDeps()
    );

    expect(result.statusCode).toBe(405);
  });

  it("400s on invalid JSON", async () => {
    const result = await handleSetupExtractionsPreflightRequest(
      fakeEvent({ body: "{not json" }),
      makeDeps()
    );

    expect(result.statusCode).toBe(400);
  });

  it("returns the preflight quote for valid pasted text", async () => {
    const result = await handleSetupExtractionsPreflightRequest(
      fakeEvent({ body: JSON.stringify({ source: { kind: "text", text: "Dossier text." } }) }),
      makeDeps()
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { eligible: boolean };
    expect(body.eligible).toBe(true);
  });
});

describe("POST /api/setup-extractions handler", () => {
  it("400s when extractionRequestId is missing", async () => {
    const result = await handleSetupExtractionsRequest(
      fakeEvent({ body: JSON.stringify({ source: { kind: "text", text: "x" } }) }),
      makeDeps()
    );

    expect(result.statusCode).toBe(400);
  });

  it("returns a successful extraction for a valid request", async () => {
    const deps = makeDeps();
    const result = await handleSetupExtractionsRequest(
      fakeEvent({
        body: JSON.stringify({
          extractionRequestId: randomUUID(),
          source: { kind: "text", text: "Dossier text." }
        })
      }),
      deps
    );

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as { status: string };
    expect(body.status).toBe("success");
  });
});

describe("POST /api/setup-extractions/:id/retry handler", () => {
  it("400s when the id path segment is missing", async () => {
    const result = await handleSetupExtractionsRetryRequest(
      fakeEvent({ body: JSON.stringify({ source: { kind: "text", text: "x" } }) }),
      makeDeps()
    );

    expect(result.statusCode).toBe(400);
  });

  it("reports IDEMPOTENCY_CONFLICT-shaped block for a retry against a non-existent extraction", async () => {
    const result = await handleSetupExtractionsRetryRequest(
      fakeEvent({
        queryStringParameters: { id: randomUUID() },
        body: JSON.stringify({ source: { kind: "text", text: "x" } })
      }),
      makeDeps()
    );

    const body = JSON.parse(result.body) as { errorCode: string };
    expect(body.errorCode).toBe("IDEMPOTENCY_CONFLICT");
  });
});
