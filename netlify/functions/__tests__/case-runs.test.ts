// Milestone 11 (Issue #27) -- GET /api/cases/:id/runs, the narrow
// Case-to-Run discovery read bridge. Injected-fake-repository tests
// (this codebase's established convention -- the Supabase query builder
// is never mocked), plus a structural source-boundary proof that this
// read path never imports execution/OpenRouter modules.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { HandlerEvent } from "@netlify/functions";
import { describe, expect, it } from "vitest";
import { RunPersistenceError, type RunRepository, type RunSummary } from "../../server/runs";
import { handleCaseRunsRequest } from "../case-runs";

const CASE_ID = "11111111-1111-4111-8111-111111111111";

function runSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: "22222222-2222-4222-8222-222222222222",
    caseId: CASE_ID,
    status: "COMPLETED",
    executionMode: "shared",
    createdAt: "2026-08-29T00:00:00.000Z",
    startedAt: "2026-08-29T00:00:01.000Z",
    completedAt: "2026-08-29T00:00:05.000Z",
    ...overrides
  };
}

class FakeRunRepository implements Pick<RunRepository, "listByCaseId"> {
  constructor(private readonly runsByCaseId: Map<string, RunSummary[]> = new Map()) {}

  async listByCaseId(caseId: string): Promise<RunSummary[]> {
    return this.runsByCaseId.get(caseId) ?? [];
  }
}

class ThrowingRunRepository implements Pick<RunRepository, "listByCaseId"> {
  async listByCaseId(): Promise<RunSummary[]> {
    throw new RunPersistenceError();
  }
}

function getEvent(id: string): HandlerEvent {
  return {
    httpMethod: "GET",
    queryStringParameters: { id }
  } as unknown as HandlerEvent;
}

describe("GET /api/cases/:id/runs (Milestone 11, Issue #27)", () => {
  it("returns the Run summaries for a valid case id", async () => {
    const repository = new FakeRunRepository(
      new Map([[CASE_ID, [runSummary()]]])
    );
    const response = await handleCaseRunsRequest(
      getEvent(CASE_ID),
      repository as unknown as RunRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.runs).toEqual([runSummary()]);
  });

  it("returns 200 { runs: [] } for a valid but unknown/run-less case id -- never a 404", async () => {
    const repository = new FakeRunRepository();
    const response = await handleCaseRunsRequest(
      getEvent("99999999-9999-4999-8999-999999999999"),
      repository as unknown as RunRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.runs).toEqual([]);
  });

  it("rejects a malformed (non-UUID) case id with 400 invalid_case", async () => {
    const repository = new FakeRunRepository();
    const response = await handleCaseRunsRequest(
      getEvent("not-a-uuid"),
      repository as unknown as RunRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(400);
    expect(payload.error).toBe("invalid_case");
  });

  it("rejects a missing id the same way as a malformed one", async () => {
    const repository = new FakeRunRepository();
    const response = await handleCaseRunsRequest(
      { httpMethod: "GET", queryStringParameters: {} } as unknown as HandlerEvent,
      repository as unknown as RunRepository
    );

    expect(response.statusCode).toBe(400);
  });

  it("rejects a non-GET method with 405", async () => {
    const repository = new FakeRunRepository();
    const response = await handleCaseRunsRequest(
      { httpMethod: "POST", queryStringParameters: { id: CASE_ID } } as unknown as HandlerEvent,
      repository as unknown as RunRepository
    );

    expect(response.statusCode).toBe(405);
  });

  it("maps a repository persistence failure to a safe 500 -- no stack trace, no Supabase internals", async () => {
    const response = await handleCaseRunsRequest(
      getEvent(CASE_ID),
      new ThrowingRunRepository() as unknown as RunRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(500);
    expect(payload.error).toBe("run_persistence_failed");
    expect(JSON.stringify(payload)).not.toMatch(/supabase|postgres|stack/i);
  });

  it("the successful response leaks no internal fields (client_request_id, request_fingerprint, cost, verdict)", async () => {
    const repository = new FakeRunRepository(
      new Map([[CASE_ID, [runSummary()]]])
    );
    const response = await handleCaseRunsRequest(
      getEvent(CASE_ID),
      repository as unknown as RunRepository
    );
    const bodyText = response.body ?? "";

    expect(bodyText).not.toMatch(/client_request_id|clientRequestId/i);
    expect(bodyText).not.toMatch(/request_fingerprint|requestFingerprint/i);
    expect(bodyText).not.toMatch(/majorityVerdict|majority_verdict/i);
    expect(bodyText).not.toMatch(/totalCostUsd|total_cost_usd/i);
  });

  it("source-boundary proof: this read path never imports the execution/OpenRouter boundary", () => {
    // The only path that can reach OpenRouter/a Background Function is
    // triggerExecutionIfEligible, imported exclusively by
    // netlify/functions/runs.ts's POST branch (Issue #27 "No-model-call
    // reopen proof"). This file must never import it, or any
    // OpenRouter-boundary module, or perform a raw fetch of its own.
    const source = readFileSync(path.resolve(__dirname, "../case-runs.ts"), "utf8");

    expect(source).not.toMatch(
      /triggerExecutionIfEligible|OpenRouterProvider|openrouter\.ai|createChatCompletion|fetch\(/
    );
  });
});
