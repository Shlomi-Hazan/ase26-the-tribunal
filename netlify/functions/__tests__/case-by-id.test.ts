// Milestone 15 (M15 production routing correction) -- GET /api/cases/:id
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
import {
  CaseValidationError,
  type CaseRepository,
  type PersistedCase
} from "../../server/cases";
import { handleCaseByIdRequest } from "../case-by-id";

const CASE_ID = "f13a74a5-1c7e-46a6-b35e-4d622e171cbe";

function persistedCase(overrides: Partial<PersistedCase> = {}): PersistedCase {
  return {
    id: CASE_ID,
    defendant: "M15 Production Persistence Smoke",
    act: "Production persistence verification only.",
    exactQuestion: "Does the case reopen correctly?",
    sourceType: "MANUAL",
    sourceFilename: null,
    createdAt: "2026-09-14T11:25:27.104Z",
    ...overrides
  };
}

class FakeCaseRepository implements Pick<CaseRepository, "getById"> {
  constructor(private readonly casesById: Map<string, PersistedCase> = new Map()) {}

  async getById(id: string): Promise<PersistedCase | null> {
    return this.casesById.get(id) ?? null;
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
    path: "/.netlify/functions/case-by-id",
    queryStringParameters: { id }
  } as unknown as HandlerEvent;
}

describe("GET /api/cases/:id (Milestone 15 routing correction)", () => {
  it("A: a friendly production-style request (real path, no query id) resolves the correct case", async () => {
    const repository = new FakeCaseRepository(new Map([[CASE_ID, persistedCase()]]));
    const response = await handleCaseByIdRequest(
      friendlyEvent(`/api/cases/${CASE_ID}`),
      repository as unknown as CaseRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.case).toEqual(persistedCase());
  });

  it("direct Function invocation with ?id=<value> continues to work", async () => {
    const repository = new FakeCaseRepository(new Map([[CASE_ID, persistedCase()]]));
    const response = await handleCaseByIdRequest(
      directQueryEvent(CASE_ID),
      repository as unknown as CaseRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.case).toEqual(persistedCase());
  });

  it("A: a conflicting real query ?id=<other-uuid> never overrides the friendly path id -- the repository receives the PATH id", async () => {
    const OTHER_CASE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const repository = new FakeCaseRepository(
      new Map([
        [CASE_ID, persistedCase()],
        [OTHER_CASE_ID, persistedCase({ id: OTHER_CASE_ID, defendant: "Wrong Case" })]
      ])
    );
    const response = await handleCaseByIdRequest(
      {
        httpMethod: "GET",
        path: `/api/cases/${CASE_ID}`,
        queryStringParameters: { id: OTHER_CASE_ID }
      } as unknown as HandlerEvent,
      repository as unknown as CaseRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.case.id).toBe(CASE_ID);
    expect(payload.case.id).not.toBe(OTHER_CASE_ID);
  });

  it("a literal, un-substituted ':id' query value never overrides a valid friendly path id", async () => {
    const repository = new FakeCaseRepository(new Map([[CASE_ID, persistedCase()]]));
    const response = await handleCaseByIdRequest(
      {
        httpMethod: "GET",
        path: `/api/cases/${CASE_ID}`,
        queryStringParameters: { id: ":id" }
      } as unknown as HandlerEvent,
      repository as unknown as CaseRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.case).toEqual(persistedCase());
  });

  it("returns 404 case_not_found for a syntactically valid but unknown id", async () => {
    const repository = new FakeCaseRepository();
    const response = await handleCaseByIdRequest(
      friendlyEvent(`/api/cases/${CASE_ID}`),
      repository as unknown as CaseRepository
    );

    expect(response.statusCode).toBe(404);
  });

  it("rejects a malformed friendly path (/api/cases/not-a-uuid) with 400 invalid_case", async () => {
    const repository = new FakeCaseRepository();
    const response = await handleCaseByIdRequest(
      friendlyEvent("/api/cases/not-a-uuid"),
      repository as unknown as CaseRepository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(400);
    expect(payload.error).toBe("invalid_case");
  });

  it("rejects a missing path segment (/api/cases/) with 400 invalid_case", async () => {
    const repository = new FakeCaseRepository();
    const response = await handleCaseByIdRequest(
      friendlyEvent("/api/cases/"),
      repository as unknown as CaseRepository
    );

    expect(response.statusCode).toBe(400);
  });

  it("rejects an unexpected extra path segment (/api/cases/:id/unexpected) with 400 invalid_case", async () => {
    const repository = new FakeCaseRepository(new Map([[CASE_ID, persistedCase()]]));
    const response = await handleCaseByIdRequest(
      friendlyEvent(`/api/cases/${CASE_ID}/unexpected`),
      repository as unknown as CaseRepository
    );

    expect(response.statusCode).toBe(400);
  });

  it("rejects a non-GET method with 405 before touching the repository", async () => {
    const repository = new FakeCaseRepository(new Map([[CASE_ID, persistedCase()]]));
    const response = await handleCaseByIdRequest(
      { ...friendlyEvent(`/api/cases/${CASE_ID}`), httpMethod: "POST" } as unknown as HandlerEvent,
      repository as unknown as CaseRepository
    );

    expect(response.statusCode).toBe(405);
  });

  it("maps a validation error to a safe response with no stack trace/internal detail", async () => {
    class ThrowingRepository implements Pick<CaseRepository, "getById"> {
      async getById(): Promise<PersistedCase | null> {
        throw new CaseValidationError(["unreachable in this path"]);
      }
    }

    const response = await handleCaseByIdRequest(
      friendlyEvent(`/api/cases/${CASE_ID}`),
      new ThrowingRepository() as unknown as CaseRepository
    );

    expect(response.statusCode).toBe(400);
    expect(response.body ?? "").not.toMatch(/stack|supabase|postgres/i);
  });
});
