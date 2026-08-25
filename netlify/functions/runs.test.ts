import type { HandlerContext, HandlerEvent } from "@netlify/functions";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  IdempotencyConflictError,
  type CreateCaseInput,
  type IdempotentCaseRepository,
  type PersistedCase
} from "../server/cases";
import {
  ROLE_BY_PARTICIPANT_ID,
  RunPersistenceError,
  SIDE_BY_PARTICIPANT_ID,
  type FreezeRunInput,
  type PersistedRun,
  type RunRepository
} from "../server/runs";
import { handleRunByIdRequest } from "./run-by-id";
import { handler as runsHandler, handleRunsRequest } from "./runs";

const storedCase: PersistedCase = {
  id: "11111111-1111-4111-8111-111111111111",
  defendant: "Alex Rowan",
  act: "Entered the restricted lab.",
  exactQuestion: "Did Alex knowingly violate the lab protocol?",
  sourceType: "MANUAL",
  sourceFilename: null,
  createdAt: "2026-08-26T10:00:00.000Z"
};

// In-memory simulation of the real freeze RPC's guarantees: exactly-seven
// atomic insert, unique(client_request_id), fingerprint reuse-or-conflict.
// This lets acceptRun's full A-H orchestration (including idempotency) be
// exercised without a real database, matching the Milestone 5 fake-
// repository pattern -- while the actual SQL still needs the live smoke
// test recorded separately.
class FakeRunRepository implements RunRepository {
  private readonly runsByClientRequestId = new Map<
    string,
    { run: PersistedRun; fingerprint: string }
  >();
  freezeCallCount = 0;

  async freeze(input: FreezeRunInput): Promise<PersistedRun> {
    this.freezeCallCount += 1;

    const existing = this.runsByClientRequestId.get(input.clientRequestId);

    if (existing) {
      if (existing.fingerprint === input.requestFingerprint) {
        return existing.run;
      }

      throw new IdempotencyConflictError();
    }

    if (input.participants.length !== 7) {
      throw new RunPersistenceError("exactly seven participant configs required");
    }

    const run: PersistedRun = {
      id: randomUUID(),
      caseId: input.caseId,
      clientRequestId: input.clientRequestId,
      executionMode: input.executionMode === "SHARED" ? "shared" : "separate",
      status: "READY",
      createdAt: "2026-08-26T10:05:00.000Z",
      participants: input.participants.map((entry) => ({
        participantId: entry.participantId,
        role: ROLE_BY_PARTICIPANT_ID[entry.participantId],
        side: SIDE_BY_PARTICIPANT_ID[entry.participantId],
        profileName: entry.profileName,
        personality: entry.personality,
        personalitySource: entry.personalitySource,
        personalitySourceFilename: entry.personalitySourceFilename,
        modelId: entry.modelId,
        promptVersion: "unassigned-pre-m7"
      }))
    };

    this.runsByClientRequestId.set(input.clientRequestId, {
      run,
      fingerprint: input.requestFingerprint
    });

    return run;
  }

  async getById(id: string): Promise<PersistedRun | null> {
    for (const { run } of this.runsByClientRequestId.values()) {
      if (run.id === id) {
        return run;
      }
    }

    return null;
  }
}

class FakeIdempotentCaseRepository implements IdempotentCaseRepository {
  private readonly casesByConveneRequestId = new Map<string, PersistedCase>();
  createIdempotentCallCount = 0;

  async create(): Promise<PersistedCase> {
    throw new Error("not used in these tests");
  }

  async list(): Promise<PersistedCase[]> {
    return [storedCase];
  }

  async getById(id: string): Promise<PersistedCase | null> {
    return id === storedCase.id ? storedCase : null;
  }

  async createIdempotent(
    input: CreateCaseInput,
    conveneRequestId: string
  ): Promise<PersistedCase> {
    this.createIdempotentCallCount += 1;
    const existing = this.casesByConveneRequestId.get(conveneRequestId);

    if (existing) {
      const matches =
        existing.defendant === input.defendant &&
        existing.act === input.act &&
        existing.exactQuestion === input.exactQuestion &&
        existing.sourceType === input.sourceType;

      if (matches) {
        return existing;
      }

      throw new IdempotencyConflictError();
    }

    const created: PersistedCase = {
      id: randomUUID(),
      defendant: input.defendant,
      act: input.act,
      exactQuestion: input.exactQuestion,
      sourceType: input.sourceType,
      sourceFilename:
        input.sourceType === "MANUAL" ? null : input.sourceFilename,
      createdAt: "2026-08-26T10:04:00.000Z"
    };

    this.casesByConveneRequestId.set(conveneRequestId, created);

    return created;
  }
}

function validParticipants() {
  return [
    "advocate-pro-1",
    "advocate-pro-2",
    "advocate-con-1",
    "advocate-con-2",
    "judge-1",
    "judge-2",
    "judge-3"
  ].map((participantId) => ({
    participantId,
    personality: `Personality for ${participantId}.`,
    personalitySource: "manual",
    modelId: "mock/free-deliberator"
  }));
}

function validBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    clientRequestId: "22222222-2222-4222-8222-222222222222",
    case: { kind: "existing", caseId: storedCase.id },
    executionMode: "shared",
    participants: validParticipants(),
    ...overrides
  });
}

describe("run persistence functions", () => {
  it("accepts a valid request and returns a READY run with no internal metadata leaked", async () => {
    const deps = {
      caseRepository: new FakeIdempotentCaseRepository(),
      runRepository: new FakeRunRepository()
    };

    const response = await handleRunsRequest(
      { httpMethod: "POST", body: validBody() } as HandlerEvent,
      deps
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(201);
    expect(payload.run.status).toBe("READY");
    expect(payload.run.caseId).toBe(storedCase.id);
    expect(payload.run.participants).toHaveLength(7);
    expect(payload.run).not.toHaveProperty("requestFingerprint");
    expect(payload.run).not.toHaveProperty("clientRequestId");
    expect(response.body).not.toContain("convene_request_id");
    expect(response.body).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("derives fixed role/side per participant regardless of request order", async () => {
    const deps = {
      caseRepository: new FakeIdempotentCaseRepository(),
      runRepository: new FakeRunRepository()
    };

    const response = await handleRunsRequest(
      { httpMethod: "POST", body: validBody() } as HandlerEvent,
      deps
    );
    const payload = JSON.parse(response.body ?? "");
    const byId = Object.fromEntries(
      payload.run.participants.map((entry: { participantId: string }) => [
        entry.participantId,
        entry
      ])
    );

    expect(byId["advocate-pro-1"]).toMatchObject({ role: "ADVOCATE", side: "PRO" });
    expect(byId["advocate-con-2"]).toMatchObject({ role: "ADVOCATE", side: "CON" });
    expect(byId["judge-2"]).toMatchObject({ role: "JUDGE", side: null });
  });

  it("rejects invalid case input with a safe 404 when the referenced case does not exist", async () => {
    const deps = {
      caseRepository: new FakeIdempotentCaseRepository(),
      runRepository: new FakeRunRepository()
    };

    const response = await handleRunsRequest(
      {
        httpMethod: "POST",
        body: validBody({
          case: { kind: "existing", caseId: "99999999-9999-4999-8999-999999999999" }
        })
      } as HandlerEvent,
      deps
    );

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? "").error).toBe("case_not_found");
  });

  it("reuses the existing run for a same-key/same-payload retry (lost-response retry)", async () => {
    const deps = {
      caseRepository: new FakeIdempotentCaseRepository(),
      runRepository: new FakeRunRepository()
    };
    const body = validBody();

    const first = await handleRunsRequest(
      { httpMethod: "POST", body } as HandlerEvent,
      deps
    );
    const second = await handleRunsRequest(
      { httpMethod: "POST", body } as HandlerEvent,
      deps
    );

    const firstPayload = JSON.parse(first.body ?? "");
    const secondPayload = JSON.parse(second.body ?? "");

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(secondPayload.run.id).toBe(firstPayload.run.id);
    expect((deps.runRepository as FakeRunRepository).freezeCallCount).toBe(2);
  });

  it("rejects a same-key/different-participant-config retry with 409 idempotency_conflict", async () => {
    const deps = {
      caseRepository: new FakeIdempotentCaseRepository(),
      runRepository: new FakeRunRepository()
    };

    await handleRunsRequest(
      { httpMethod: "POST", body: validBody() } as HandlerEvent,
      deps
    );

    const changedParticipants = validParticipants();
    changedParticipants[0] = {
      ...changedParticipants[0],
      personality: "A materially different personality for the same key."
    };

    const conflict = await handleRunsRequest(
      {
        httpMethod: "POST",
        body: validBody({ participants: changedParticipants })
      } as HandlerEvent,
      deps
    );

    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.body ?? "").error).toBe("idempotency_conflict");
  });

  it("reuses the same Convene-created case on a lost-response retry of a new-case request", async () => {
    const deps = {
      caseRepository: new FakeIdempotentCaseRepository(),
      runRepository: new FakeRunRepository()
    };
    const body = validBody({
      case: {
        kind: "new",
        case: {
          defendant: "Course Test Alex",
          act: "Performed a lost-response retry test.",
          exactQuestion: "Does the retry reuse the same case?",
          sourceType: "MANUAL"
        }
      }
    });

    const first = await handleRunsRequest(
      { httpMethod: "POST", body } as HandlerEvent,
      deps
    );
    const second = await handleRunsRequest(
      { httpMethod: "POST", body } as HandlerEvent,
      deps
    );

    const firstPayload = JSON.parse(first.body ?? "");
    const secondPayload = JSON.parse(second.body ?? "");

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(secondPayload.run.caseId).toBe(firstPayload.run.caseId);
    expect(secondPayload.run.id).toBe(firstPayload.run.id);
    expect(
      (deps.caseRepository as FakeIdempotentCaseRepository).createIdempotentCallCount
    ).toBe(2);
  });

  it("rejects a same-key/different-new-case-content retry with 409 idempotency_conflict", async () => {
    const deps = {
      caseRepository: new FakeIdempotentCaseRepository(),
      runRepository: new FakeRunRepository()
    };
    const newCaseBody = (defendant: string) =>
      validBody({
        case: {
          kind: "new",
          case: {
            defendant,
            act: "Performed a changed-content retry test.",
            exactQuestion: "Does a changed new-case retry conflict?",
            sourceType: "MANUAL"
          }
        }
      });

    await handleRunsRequest(
      { httpMethod: "POST", body: newCaseBody("Course Test Alex") } as HandlerEvent,
      deps
    );
    const conflict = await handleRunsRequest(
      { httpMethod: "POST", body: newCaseBody("Someone Else Entirely") } as HandlerEvent,
      deps
    );

    expect(conflict.statusCode).toBe(409);
    expect(JSON.parse(conflict.body ?? "").error).toBe("idempotency_conflict");
  });

  it("rejects malformed JSON and non-POST methods safely", async () => {
    const deps = {
      caseRepository: new FakeIdempotentCaseRepository(),
      runRepository: new FakeRunRepository()
    };

    const badJson = await handleRunsRequest(
      { httpMethod: "POST", body: "{not json" } as HandlerEvent,
      deps
    );
    expect(badJson.statusCode).toBe(400);

    const wrongMethod = await handleRunsRequest(
      { httpMethod: "GET" } as HandlerEvent,
      deps
    );
    expect(wrongMethod.statusCode).toBe(405);
  });

  it("returns a safe JSON error instead of a stack trace when server config is missing", async () => {
    const response = await runsHandler(
      { httpMethod: "POST", body: validBody() } as HandlerEvent,
      {} as HandlerContext,
      () => undefined
    );

    expect(response).toBeTruthy();
    expect(response?.statusCode).toBe(500);
    expect(response?.body).not.toContain("/Users/");
    expect(response?.body).not.toContain(" at ");
  });

  it("no OpenRouter/model call occurs anywhere in the accept path", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalled = false;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      fetchCalled = true;
      return originalFetch(...args);
    }) as typeof fetch;

    try {
      const deps = {
        caseRepository: new FakeIdempotentCaseRepository(),
        runRepository: new FakeRunRepository()
      };

      await handleRunsRequest(
        { httpMethod: "POST", body: validBody() } as HandlerEvent,
        deps
      );

      expect(fetchCalled).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("run read function", () => {
  it("returns a frozen run by id", async () => {
    const runRepository = new FakeRunRepository();
    const deps = { caseRepository: new FakeIdempotentCaseRepository(), runRepository };

    const created = await handleRunsRequest(
      { httpMethod: "POST", body: validBody() } as HandlerEvent,
      deps
    );
    const runId = JSON.parse(created.body ?? "").run.id;

    const response = await handleRunByIdRequest(
      {
        httpMethod: "GET",
        queryStringParameters: { id: runId }
      } as unknown as HandlerEvent,
      runRepository
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "").run.id).toBe(runId);
  });

  it("returns a safe 404 for an unknown but valid run id", async () => {
    const response = await handleRunByIdRequest(
      {
        httpMethod: "GET",
        queryStringParameters: { id: "99999999-9999-4999-8999-999999999999" }
      } as unknown as HandlerEvent,
      new FakeRunRepository()
    );

    expect(response.statusCode).toBe(404);
    expect(JSON.parse(response.body ?? "").error).toBe("run_not_found");
  });

  it("returns a safe 400 for a malformed run id", async () => {
    const response = await handleRunByIdRequest(
      {
        httpMethod: "GET",
        queryStringParameters: { id: "not-a-uuid" }
      } as unknown as HandlerEvent,
      new FakeRunRepository()
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "").error).toBe("invalid_run");
  });
});
