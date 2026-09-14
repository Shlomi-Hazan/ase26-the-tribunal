// Milestone 15 (M15 production routing correction) -- GET /api/runs/:id
// previously relied on netlify.toml substituting the `:id` placeholder
// into the rewrite target's query string (`?id=:id`), which Netlify's
// own documented redirect contract never supports and which was
// confirmed broken live in production. This suite proves the corrected
// contract: the friendly production-style request (a real `event.path`,
// no `queryStringParameters.id`) reaches the repository with the
// correctly extracted id, while direct Function invocation with an
// explicit `?id=<value>` query parameter (used for local/diagnostic
// calls) continues to work exactly as before.

import type { HandlerEvent } from "@netlify/functions";
import { describe, expect, it } from "vitest";
import { RunPersistenceError, type PersistedRun, type RunRepository } from "../../server/runs";
import { handleRunByIdRequest } from "../run-by-id";

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

class FakeRunRepository implements Pick<RunRepository, "getById"> {
  constructor(private readonly runsById: Map<string, PersistedRun> = new Map()) {}

  async getById(id: string): Promise<PersistedRun | null> {
    return this.runsById.get(id) ?? null;
  }
}

function friendlyEvent(path: string): HandlerEvent {
  return {
    httpMethod: "GET",
    path,
    queryStringParameters: {}
  } as unknown as HandlerEvent;
}

function directQueryEvent(id: string): HandlerEvent {
  return {
    httpMethod: "GET",
    path: "/.netlify/functions/run-by-id",
    queryStringParameters: { id }
  } as unknown as HandlerEvent;
}

describe("GET /api/runs/:id (Milestone 15 routing correction)", () => {
  it("C: a friendly production-style request (real path, no query id) resolves the correct run", async () => {
    const repository = new FakeRunRepository(new Map([[RUN_ID, baseRun()]]));
    const response = await handleRunByIdRequest(
      friendlyEvent(`/api/runs/${RUN_ID}`),
      repository as unknown as RunRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.run.id).toBe(RUN_ID);
  });

  it("direct Function invocation with ?id=<value> continues to work", async () => {
    const repository = new FakeRunRepository(new Map([[RUN_ID, baseRun()]]));
    const response = await handleRunByIdRequest(
      directQueryEvent(RUN_ID),
      repository as unknown as RunRepository
    );

    expect(response.statusCode).toBe(200);
  });

  it("C: a conflicting real query ?id=<other-uuid> never overrides the friendly path id -- the repository receives the PATH id", async () => {
    const OTHER_RUN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const repository = new FakeRunRepository(
      new Map([
        [RUN_ID, baseRun()],
        [OTHER_RUN_ID, baseRun({ id: OTHER_RUN_ID })]
      ])
    );
    const response = await handleRunByIdRequest(
      {
        httpMethod: "GET",
        path: `/api/runs/${RUN_ID}`,
        queryStringParameters: { id: OTHER_RUN_ID }
      } as unknown as HandlerEvent,
      repository as unknown as RunRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.run.id).toBe(RUN_ID);
    expect(payload.run.id).not.toBe(OTHER_RUN_ID);
  });

  it("a literal, un-substituted ':id' query value never overrides a valid friendly path id", async () => {
    const repository = new FakeRunRepository(new Map([[RUN_ID, baseRun()]]));
    const response = await handleRunByIdRequest(
      {
        httpMethod: "GET",
        path: `/api/runs/${RUN_ID}`,
        queryStringParameters: { id: ":id" }
      } as unknown as HandlerEvent,
      repository as unknown as RunRepository
    );

    expect(response.statusCode).toBe(200);
  });

  it("returns 404 run_not_found for a syntactically valid but unknown id", async () => {
    const repository = new FakeRunRepository();
    const response = await handleRunByIdRequest(
      friendlyEvent(`/api/runs/${RUN_ID}`),
      repository as unknown as RunRepository
    );

    expect(response.statusCode).toBe(404);
  });

  it("rejects a malformed friendly path (/api/runs/not-a-uuid) with 400 invalid_run", async () => {
    const repository = new FakeRunRepository();
    const response = await handleRunByIdRequest(
      friendlyEvent("/api/runs/not-a-uuid"),
      repository as unknown as RunRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(400);
    expect(payload.error).toBe("invalid_run");
  });

  it("rejects a missing path segment (/api/runs/) with 400", async () => {
    const repository = new FakeRunRepository();
    const response = await handleRunByIdRequest(
      friendlyEvent("/api/runs/"),
      repository as unknown as RunRepository
    );

    expect(response.statusCode).toBe(400);
  });

  it("rejects an unexpected extra path segment (/api/runs/:id/extra) with 400", async () => {
    const repository = new FakeRunRepository(new Map([[RUN_ID, baseRun()]]));
    const response = await handleRunByIdRequest(
      friendlyEvent(`/api/runs/${RUN_ID}/extra`),
      repository as unknown as RunRepository
    );

    expect(response.statusCode).toBe(400);
  });

  it("rejects a non-GET method with 405 before touching the repository", async () => {
    const repository = new FakeRunRepository(new Map([[RUN_ID, baseRun()]]));
    const response = await handleRunByIdRequest(
      { ...friendlyEvent(`/api/runs/${RUN_ID}`), httpMethod: "POST" } as unknown as HandlerEvent,
      repository as unknown as RunRepository
    );

    expect(response.statusCode).toBe(405);
  });

  it("maps a repository persistence failure to a safe 500 -- no stack trace, no Supabase internals", async () => {
    class ThrowingRepository implements Pick<RunRepository, "getById"> {
      async getById(): Promise<PersistedRun | null> {
        throw new RunPersistenceError();
      }
    }

    const response = await handleRunByIdRequest(
      friendlyEvent(`/api/runs/${RUN_ID}`),
      new ThrowingRepository() as unknown as RunRepository
    );

    expect(response.statusCode).toBe(500);
    expect(response.body ?? "").not.toMatch(/stack|supabase|postgres/i);
  });
});
