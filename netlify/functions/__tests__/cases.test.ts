import type { HandlerContext, HandlerEvent } from "@netlify/functions";
import { describe, expect, it } from "vitest";
import {
  type CaseRepository,
  type CreateCaseInput,
  type PersistedCase
} from "../../server/cases";
import { handler as caseByIdHandler, handleCaseByIdRequest } from "../case-by-id";
import { handler as casesHandler, handleCasesRequest } from "../cases";

const storedCase: PersistedCase = {
  id: "11111111-1111-4111-8111-111111111111",
  defendant: "Alex Rowan",
  act: "Entered the restricted lab.",
  exactQuestion: "Did Alex knowingly violate the lab protocol?",
  sourceType: "MANUAL",
  sourceFilename: null,
  createdAt: "2026-08-25T10:00:00.000Z"
};

class FakeCaseRepository implements CaseRepository {
  readonly createdInputs: CreateCaseInput[] = [];

  async create(input: CreateCaseInput) {
    this.createdInputs.push(input);

    return {
      ...storedCase,
      ...input,
      sourceFilename: input.sourceType === "MANUAL" ? null : input.sourceFilename
    };
  }

  async list() {
    return [storedCase];
  }

  async getById(id: string) {
    return id === storedCase.id ? storedCase : null;
  }
}

describe("case persistence functions", () => {
  it("creates a normalized case through an injected repository", async () => {
    const repository = new FakeCaseRepository();
    const response = await handleCasesRequest(
      {
        httpMethod: "POST",
        body: JSON.stringify({
          defendant: "  Alex Rowan  ",
          act: "Entered the restricted lab.",
          exactQuestion: "Did Alex knowingly violate the lab protocol?",
          sourceType: "CHARGE_SHEET_FILE",
          sourceFilename: "charge.md"
        })
      } as HandlerEvent,
      repository
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(201);
    expect(repository.createdInputs).toEqual([
      {
        defendant: "Alex Rowan",
        act: "Entered the restricted lab.",
        exactQuestion: "Did Alex knowingly violate the lab protocol?",
        sourceType: "CHARGE_SHEET_FILE",
        sourceFilename: "charge.md"
      }
    ]);
    expect(payload.case.defendant).toBe("Alex Rowan");
    expect(response.body).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("lists stored cases without verdict or economics fabrication", async () => {
    const response = await handleCasesRequest(
      { httpMethod: "GET" } as HandlerEvent,
      new FakeCaseRepository()
    );
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.cases).toHaveLength(1);
    expect(payload.cases[0]).not.toHaveProperty("verdict");
    expect(payload.cases[0]).not.toHaveProperty("cost");
  });

  it("rejects invalid case input", async () => {
    const invalidRequests = [
      {
        defendant: "",
        act: "Entered the restricted lab.",
        exactQuestion: "Did Alex knowingly violate the lab protocol?",
        sourceType: "MANUAL"
      },
      {
        defendant: "Alex Rowan",
        act: "",
        exactQuestion: "Did Alex knowingly violate the lab protocol?",
        sourceType: "MANUAL"
      },
      {
        defendant: "Alex Rowan",
        act: "Entered the restricted lab.",
        exactQuestion: "",
        sourceType: "MANUAL"
      },
      {
        defendant: "Alex Rowan",
        act: "Entered the restricted lab.",
        exactQuestion: "Did Alex knowingly violate the lab protocol?",
        sourceType: "REMOTE_PROVIDER"
      },
      {
        defendant: "Alex Rowan",
        act: "Entered the restricted lab.",
        exactQuestion: "Did Alex knowingly violate the lab protocol?",
        sourceType: "CHARGE_SHEET_FILE",
        sourceFilename: "../charge.md"
      }
    ];

    for (const request of invalidRequests) {
      const response = await handleCasesRequest(
        {
          httpMethod: "POST",
          body: JSON.stringify(request)
        } as HandlerEvent,
        new FakeCaseRepository()
      );

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body ?? "").error).toBe("invalid_case");
    }
  });

  it("rejects malformed case source metadata with 400 before any repository call", async () => {
    const baseCase = {
      defendant: "Alex Rowan",
      act: "Entered the restricted lab.",
      exactQuestion: "Did Alex knowingly violate the lab protocol?"
    };
    const invalidRequests = [
      { ...baseCase, sourceType: "MANUAL", sourceFilename: "charge.txt" },
      { ...baseCase, sourceType: "CHARGE_SHEET_FILE" },
      { ...baseCase, sourceType: "TRIBUNAL_PACKAGE_FILE" },
      { ...baseCase, sourceType: "CHARGE_SHEET_FILE", sourceFilename: "." },
      { ...baseCase, sourceType: "CHARGE_SHEET_FILE", sourceFilename: ".." },
      {
        ...baseCase,
        sourceType: "CHARGE_SHEET_FILE",
        sourceFilename: "sub/charge.txt"
      },
      {
        ...baseCase,
        sourceType: "CHARGE_SHEET_FILE",
        sourceFilename: "../charge.txt"
      },
      {
        ...baseCase,
        sourceType: "CHARGE_SHEET_FILE",
        sourceFilename: "sub\\charge.txt"
      },
      {
        ...baseCase,
        sourceType: "CHARGE_SHEET_FILE",
        sourceFilename: "charge\0.txt"
      },
      {
        ...baseCase,
        sourceType: "TRIBUNAL_PACKAGE_FILE",
        sourceFilename: "package.pdf"
      },
      {
        ...baseCase,
        sourceType: "TRIBUNAL_PACKAGE_FILE",
        sourceFilename: "package.exe"
      }
    ];

    for (const request of invalidRequests) {
      const repository = new FakeCaseRepository();
      const response = await handleCasesRequest(
        {
          httpMethod: "POST",
          body: JSON.stringify(request)
        } as HandlerEvent,
        repository
      );

      expect(response.statusCode).toBe(400);
      expect(JSON.parse(response.body ?? "").error).toBe("invalid_case");
      // No repository/DB call happens for malformed metadata.
      expect(repository.createdInputs).toHaveLength(0);
    }
  });

  it("accepts valid case source metadata for every source type", async () => {
    const baseCase = {
      defendant: "Alex Rowan",
      act: "Entered the restricted lab.",
      exactQuestion: "Did Alex knowingly violate the lab protocol?"
    };
    const validRequests = [
      { ...baseCase, sourceType: "MANUAL" },
      {
        ...baseCase,
        sourceType: "CHARGE_SHEET_FILE",
        sourceFilename: "charge.txt"
      },
      {
        ...baseCase,
        sourceType: "CHARGE_SHEET_FILE",
        sourceFilename: "charge.md"
      },
      {
        ...baseCase,
        sourceType: "TRIBUNAL_PACKAGE_FILE",
        sourceFilename: "package.txt"
      },
      {
        ...baseCase,
        sourceType: "TRIBUNAL_PACKAGE_FILE",
        sourceFilename: "package.md"
      }
    ];

    for (const request of validRequests) {
      const response = await handleCasesRequest(
        {
          httpMethod: "POST",
          body: JSON.stringify(request)
        } as HandlerEvent,
        new FakeCaseRepository()
      );

      expect(response.statusCode).toBe(201);
    }
  });

  it("loads a stored case by id and returns safe not-found states", async () => {
    const repository = new FakeCaseRepository();
    const found = await handleCaseByIdRequest(
      {
        httpMethod: "GET",
        queryStringParameters: {
          id: storedCase.id
        }
      } as unknown as HandlerEvent,
      repository
    );
    const missing = await handleCaseByIdRequest(
      {
        httpMethod: "GET",
        queryStringParameters: {
          id: "22222222-2222-4222-8222-222222222222"
        }
      } as unknown as HandlerEvent,
      repository
    );

    expect(found.statusCode).toBe(200);
    expect(JSON.parse(found.body ?? "").case.id).toBe(storedCase.id);
    expect(missing.statusCode).toBe(404);
  });

  it("does not accept browser-supplied ids, timestamps, or raw file bytes", async () => {
    const response = await handleCasesRequest(
      {
        httpMethod: "POST",
        body: JSON.stringify({
          id: "99999999-9999-4999-8999-999999999999",
          defendant: "Alex Rowan",
          act: "Entered the restricted lab.",
          exactQuestion: "Did Alex knowingly violate the lab protocol?",
          sourceType: "MANUAL",
          createdAt: "2026-08-25T09:00:00.000Z",
          rawFileBytes: "not accepted"
        })
      } as HandlerEvent,
      new FakeCaseRepository()
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "").error).toBe("invalid_case");
  });

  it("returns a safe JSON error instead of a stack trace when server config is missing", async () => {
    // The real exported handlers construct the Supabase repository before
    // delegating to handle*Request. If that construction throws (e.g. no
    // SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY configured), the response must
    // still be the safe JSON error contract, never a raw thrown error/stack
    // trace with internal file paths.
    const listResponse = await casesHandler(
      { httpMethod: "GET" } as HandlerEvent,
      {} as HandlerContext,
      () => undefined
    );
    const byIdResponse = await caseByIdHandler(
      {
        httpMethod: "GET",
        queryStringParameters: { id: storedCase.id }
      } as unknown as HandlerEvent,
      {} as HandlerContext,
      () => undefined
    );

    for (const response of [listResponse, byIdResponse]) {
      expect(response).toBeTruthy();
      expect(response?.statusCode).toBe(500);
      const payload = JSON.parse(response?.body ?? "");
      expect(typeof payload.error).toBe("string");
      expect(response?.body).not.toContain("/Users/");
      expect(response?.body).not.toContain(" at ");
      expect(response?.body).not.toContain("ServerConfigError");
    }
  });
});
