import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RunCaseRequest, RunParticipantRequest } from "../../services/runApi";
import { useRunStart } from "./useRunStart";

const CASE_REQUEST: RunCaseRequest = {
  kind: "new",
  case: {
    defendant: "Test Defendant",
    act: "Test act.",
    exactQuestion: "Test question?",
    sourceType: "MANUAL"
  }
};

const PARTICIPANTS: RunParticipantRequest[] = [
  {
    participantId: "advocate-pro-1",
    personality: "Personality.",
    personalitySource: "manual",
    modelId: "test/model"
  }
];

function runResponse(id: string, caseId: string, status = "READY") {
  return new Response(
    JSON.stringify({
      run: {
        id,
        caseId,
        executionMode: "shared",
        status,
        createdAt: "2026-08-25T10:00:00.000Z",
        participants: []
      },
      executionTriggered: status === "READY"
    }),
    { status: 201 }
  );
}

beforeEach(() => {
  vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useRunStart", () => {
  it("submits via POST /api/runs with a fresh clientRequestId and resolves the ConveneResult", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      runResponse("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222")
    );

    const { result } = renderHook(() => useRunStart());
    let outcome: Awaited<ReturnType<typeof result.current.start>> = null;

    await act(async () => {
      outcome = await result.current.start(CASE_REQUEST, "shared", PARTICIPANTS);
    });

    expect(outcome).not.toBeNull();
    expect(outcome!.run.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(outcome!.executionTriggered).toBe(true);
    expect(result.current.error).toBe("");
    expect(result.current.isSubmitting).toBe(false);

    const [url, requestInit] = vi.mocked(globalThis.fetch).mock.calls[0] as [
      string,
      RequestInit
    ];
    const body = JSON.parse(requestInit.body as string);

    expect(url).toBe("/api/runs");
    expect(requestInit.method).toBe("POST");
    expect(body.case).toEqual(CASE_REQUEST);
    expect(body.executionMode).toBe("shared");
    expect(body.participants).toEqual(PARTICIPANTS);
    expect(typeof body.clientRequestId).toBe("string");
    expect(body.clientRequestId.length).toBeGreaterThan(0);
  });

  it("reuses the same clientRequestId across an unchanged resubmission, and mints a fresh one after a material edit", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "conflict" }), { status: 409 }))
      .mockResolvedValueOnce(
        runResponse("33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444")
      )
      .mockResolvedValueOnce(
        runResponse("55555555-5555-4555-8555-555555555555", "66666666-6666-4666-8666-666666666666")
      );

    const { result } = renderHook(() => useRunStart());

    await act(async () => {
      await result.current.start(CASE_REQUEST, "shared", PARTICIPANTS);
    });

    await waitFor(() => expect(result.current.error).not.toBe(""));

    await act(async () => {
      await result.current.start(CASE_REQUEST, "shared", PARTICIPANTS);
    });

    const editedParticipants: RunParticipantRequest[] = [
      { ...PARTICIPANTS[0], personality: "A materially different personality." }
    ];

    await act(async () => {
      await result.current.start(CASE_REQUEST, "shared", editedParticipants);
    });

    const calls = vi.mocked(globalThis.fetch).mock.calls as Array<[string, RequestInit]>;
    const ids = calls.map(([, init]) => JSON.parse(init.body as string).clientRequestId as string);

    expect(ids[0]).toBe(ids[1]); // unchanged resubmission reuses the id
    expect(ids[2]).not.toBe(ids[1]); // materially edited submission mints a fresh id
  });

  it("captures a formatted error and returns null on failure, without throwing", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "run_request_failed", errors: ["Something went wrong."] }), {
        status: 500
      })
    );

    const { result } = renderHook(() => useRunStart());
    let outcome: Awaited<ReturnType<typeof result.current.start>> = null;

    await act(async () => {
      outcome = await result.current.start(CASE_REQUEST, "shared", PARTICIPANTS);
    });

    expect(outcome).toBeNull();
    expect(result.current.error).toBe("Something went wrong.");
    expect(result.current.isSubmitting).toBe(false);
  });
});
