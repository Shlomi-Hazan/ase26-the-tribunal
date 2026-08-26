import { describe, expect, it } from "vitest";
import { modelCallAttemptSchema } from "./telemetry";

describe("modelCallAttemptSchema", () => {
  it("accepts a successful attempt with full data", () => {
    const result = modelCallAttemptSchema.safeParse({
      logicalParticipantId: "advocate-pro-1",
      configuredModelId: "openai/gpt-5",
      canonicalModelId: "openai/gpt-5",
      providerEndpointTag: "openai",
      providerDisplayName: "OpenAI",
      attemptNumber: 1,
      status: "SUCCESS",
      inputTokens: 500,
      outputTokens: 300,
      totalTokens: 800,
      pricingSnapshot: {
        promptPricePerToken: "0.000003",
        completionPricePerToken: "0.000006",
        requestPriceUsd: "0",
        effectiveInputPricePerToken: "0.000003",
        observedAt: "2026-08-26T00:00:00.000Z"
      },
      actualProviderCostUsd: "0.0033",
      derivedComparisonCostUsd: "0.0033",
      latencyMs: 1200,
      providerRequestId: "gen-abc123",
      normalizedError: null
    });

    expect(result.success).toBe(true);
  });

  it("accepts a failed attempt with null token/cost fields (never fabricated zero)", () => {
    const result = modelCallAttemptSchema.safeParse({
      logicalParticipantId: "judge-1",
      configuredModelId: "openai/gpt-5",
      canonicalModelId: null,
      providerEndpointTag: null,
      providerDisplayName: null,
      attemptNumber: 2,
      status: "FAILED",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      pricingSnapshot: null,
      actualProviderCostUsd: null,
      derivedComparisonCostUsd: null,
      latencyMs: null,
      providerRequestId: null,
      normalizedError: "TIMEOUT"
    });

    expect(result.success).toBe(true);
  });

  it("rejects an attemptNumber outside 1..2 (max one retry)", () => {
    const result = modelCallAttemptSchema.safeParse({
      logicalParticipantId: "judge-1",
      configuredModelId: "openai/gpt-5",
      canonicalModelId: null,
      providerEndpointTag: null,
      providerDisplayName: null,
      attemptNumber: 3,
      status: "FAILED",
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      pricingSnapshot: null,
      actualProviderCostUsd: null,
      derivedComparisonCostUsd: null,
      latencyMs: null,
      providerRequestId: null,
      normalizedError: "TIMEOUT"
    });

    expect(result.success).toBe(false);
  });
});
