// Milestone 10 (Issue #23) -- toRunResponse's additive shape. Proves
// every pre-existing field is untouched and the new M10 fields pass
// through faithfully, using a minimal fake PersistedRun (no Supabase).

import { describe, expect, it } from "vitest";
import { toRunResponse } from "./runResponses";
import type { PersistedRun } from "./runs";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

function baseRun(overrides: Partial<PersistedRun> = {}): PersistedRun {
  return {
    id: RUN_ID,
    caseId: "22222222-2222-4222-8222-222222222222",
    clientRequestId: "33333333-3333-4333-8333-333333333333",
    executionMode: "shared",
    status: "READY",
    createdAt: "2026-08-31T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    majorityVerdict: null,
    failureCode: null,
    failureMessage: null,
    totalCostUsd: null,
    advocateCostUsd: null,
    judgeCostUsd: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    totalTokens: null,
    logicalCallCount: 0,
    providerAttemptCount: 0,
    wallClockMs: null,
    partialSpend: null,
    admission: null,
    attempts: [],
    protocol: null,
    participants: [],
    ...overrides
  };
}

describe("toRunResponse (Milestone 10, Issue #23 -- additive API shape)", () => {
  it("A: every pre-existing (M6-M8) field is present and unchanged for a READY run", () => {
    const response = toRunResponse(baseRun());

    expect(response).toMatchObject({
      id: RUN_ID,
      caseId: "22222222-2222-4222-8222-222222222222",
      executionMode: "shared",
      status: "READY",
      createdAt: "2026-08-31T00:00:00.000Z",
      startedAt: null,
      completedAt: null,
      majorityVerdict: null,
      failureCode: null,
      failureMessage: null,
      totalCostUsd: null,
      advocateCostUsd: null,
      judgeCostUsd: null,
      participants: []
    });
    // clientRequestId/request_fingerprint must never appear in the public
    // response -- unchanged M6 exclusion (runResponses.ts's own comment).
    expect(response).not.toHaveProperty("clientRequestId");
    expect(response).not.toHaveProperty("requestFingerprint");
  });

  it("B: a COMPLETED run exposes the persisted run-level token totals", () => {
    const response = toRunResponse(
      baseRun({
        status: "COMPLETED",
        totalCostUsd: "0.0014619",
        totalInputTokens: 8071,
        totalOutputTokens: 2262,
        totalTokens: 10333,
        logicalCallCount: 7,
        providerAttemptCount: 7,
        wallClockMs: 12324
      })
    );

    expect(response.totalInputTokens).toBe(8071);
    expect(response.totalOutputTokens).toBe(2262);
    expect(response.totalTokens).toBe(10333);
    expect(response.logicalCallCount).toBe(7);
    expect(response.providerAttemptCount).toBe(7);
    expect(response.wallClockMs).toBe(12324);
  });

  it("passes through partialSpend/admission/attempts/protocol faithfully", () => {
    const response = toRunResponse(
      baseRun({
        partialSpend: { knownCostUsd: "0.003", hasUnknownCost: true },
        admission: { available: false, reason: "test" },
        attempts: [
          {
            participantId: "advocate-pro-1",
            role: "ADVOCATE",
            side: "PRO",
            attemptNumber: 1,
            status: "SUCCESS",
            configuredModelId: "openai/gpt-5-nano",
            canonicalModelId: "openai/gpt-5-nano-2025-08-07",
            providerEndpointTag: "azure/swedencentral",
            promptVersion: "advocate-v1",
            conservativeMaxCostUsd: "0.001",
            inputTokens: 400,
            outputTokens: 500,
            totalTokens: 900,
            inputPricePerMillion: "0.055",
            outputPricePerMillion: "0.44",
            requestPriceUsd: "0",
            pricingObservedAt: "2026-08-31T00:00:00.000Z",
            actualCostUsd: "0.0002",
            derivedCostUsd: "0.0002",
            latencyMs: 1000,
            providerRequestId: "gen-1",
            errorCategory: null,
            errorMessage: null,
            startedAt: "2026-08-31T00:00:00.000Z",
            completedAt: "2026-08-31T00:00:01.000Z"
          }
        ],
        protocol: null
      })
    );

    expect(response.partialSpend).toEqual({ knownCostUsd: "0.003", hasUnknownCost: true });
    expect(response.admission).toEqual({ available: false, reason: "test" });
    expect(response.attempts).toHaveLength(1);
    expect(response.attempts[0].providerRequestId).toBe("gen-1");
    expect(response.protocol).toBeNull();
  });
});
