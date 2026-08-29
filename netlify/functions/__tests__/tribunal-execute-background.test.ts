// Milestone 8 -- Background Function authentication/BYOK gate tests.
// Every case here proves zero execution (deps.execute never called)
// before any of the injected real construction would ever run.

import type { HandlerEvent } from "@netlify/functions";
import { describe, expect, it, vi } from "vitest";
import { INTERNAL_FUNCTION_SECRET_HEADER } from "../../server/tribunal/internalSecret";
import { USER_OPENROUTER_KEY_HEADER } from "../../server/extraction/userOpenRouterKey";
import {
  handleTribunalExecuteBackgroundRequest,
  type HandleTribunalExecuteBackgroundDeps
} from "../tribunal-execute-background";

const REAL_SECRET = "internal-function-secret-for-tests-only";
const RUN_ID = "11111111-1111-4111-8111-111111111111";

function fakeEvent(headers: Record<string, string>, body: unknown = { runId: RUN_ID }): HandlerEvent {
  return {
    httpMethod: "POST",
    headers,
    body: JSON.stringify(body)
  } as HandlerEvent;
}

function fakeDeps(overrides: Partial<HandleTribunalExecuteBackgroundDeps> = {}): {
  deps: HandleTribunalExecuteBackgroundDeps;
  execute: ReturnType<typeof vi.fn>;
  buildExecutionDeps: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn().mockResolvedValue(undefined);
  const buildExecutionDeps = vi.fn().mockReturnValue({});

  return {
    deps: {
      readSecret: () => REAL_SECRET,
      buildExecutionDeps,
      execute,
      ...overrides
    },
    execute,
    buildExecutionDeps
  };
}

describe("handleTribunalExecuteBackgroundRequest", () => {
  it("missing internal secret header -> zero execution", async () => {
    const { deps, execute } = fakeDeps();

    await handleTribunalExecuteBackgroundRequest(
      fakeEvent({ [USER_OPENROUTER_KEY_HEADER]: "sk-or-v1-user-key" }),
      deps
    );

    expect(execute).not.toHaveBeenCalled();
  });

  it("wrong internal secret -> zero execution (constant-time compare, not a leaking ===)", async () => {
    const { deps, execute } = fakeDeps();

    await handleTribunalExecuteBackgroundRequest(
      fakeEvent({
        [INTERNAL_FUNCTION_SECRET_HEADER]: "the-wrong-secret",
        [USER_OPENROUTER_KEY_HEADER]: "sk-or-v1-user-key"
      }),
      deps
    );

    expect(execute).not.toHaveBeenCalled();
  });

  it("server misconfiguration (readSecret throws) -> zero execution, fails closed", async () => {
    const { deps, execute } = fakeDeps({
      readSecret: () => {
        throw new Error("missing env");
      }
    });

    await handleTribunalExecuteBackgroundRequest(
      fakeEvent({
        [INTERNAL_FUNCTION_SECRET_HEADER]: REAL_SECRET,
        [USER_OPENROUTER_KEY_HEADER]: "sk-or-v1-user-key"
      }),
      deps
    );

    expect(execute).not.toHaveBeenCalled();
  });

  it("valid secret but missing user OpenRouter credential -> zero execution (BYOK gate)", async () => {
    const { deps, execute, buildExecutionDeps } = fakeDeps();

    await handleTribunalExecuteBackgroundRequest(
      fakeEvent({ [INTERNAL_FUNCTION_SECRET_HEADER]: REAL_SECRET }),
      deps
    );

    expect(execute).not.toHaveBeenCalled();
    expect(buildExecutionDeps).not.toHaveBeenCalled();
  });

  it("GET request -> zero execution (POST only)", async () => {
    const { deps, execute } = fakeDeps();
    const event = fakeEvent({
      [INTERNAL_FUNCTION_SECRET_HEADER]: REAL_SECRET,
      [USER_OPENROUTER_KEY_HEADER]: "sk-or-v1-user-key"
    });

    await handleTribunalExecuteBackgroundRequest({ ...event, httpMethod: "GET" }, deps);

    expect(execute).not.toHaveBeenCalled();
  });

  it("malformed/missing runId -> zero execution", async () => {
    const { deps, execute } = fakeDeps();

    await handleTribunalExecuteBackgroundRequest(
      fakeEvent(
        {
          [INTERNAL_FUNCTION_SECRET_HEADER]: REAL_SECRET,
          [USER_OPENROUTER_KEY_HEADER]: "sk-or-v1-user-key"
        },
        { runId: "not-a-uuid" }
      ),
      deps
    );

    expect(execute).not.toHaveBeenCalled();
  });

  it("valid secret + connected credential + valid runId -> execution proceeds with the user's own key, never falling back", async () => {
    const { deps, execute, buildExecutionDeps } = fakeDeps();

    await handleTribunalExecuteBackgroundRequest(
      fakeEvent({
        [INTERNAL_FUNCTION_SECRET_HEADER]: REAL_SECRET,
        [USER_OPENROUTER_KEY_HEADER]: "sk-or-v1-the-users-own-key"
      }),
      deps
    );

    expect(buildExecutionDeps).toHaveBeenCalledWith("sk-or-v1-the-users-own-key");
    expect(execute).toHaveBeenCalledWith(RUN_ID, expect.anything());
  });

  it("an exception from execute never escapes uncaught (last-resort guard, no lease/retry system)", async () => {
    const { deps } = fakeDeps({ execute: vi.fn().mockRejectedValue(new Error("boom")) });

    await expect(
      handleTribunalExecuteBackgroundRequest(
        fakeEvent({
          [INTERNAL_FUNCTION_SECRET_HEADER]: REAL_SECRET,
          [USER_OPENROUTER_KEY_HEADER]: "sk-or-v1-user-key"
        }),
        deps
      )
    ).resolves.toBeUndefined();
  });
});
