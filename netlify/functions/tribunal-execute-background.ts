// Milestone 8 -- the Tribunal Background Function (ARCHITECTURE.md
// Sec 4). Not a public user API: every invocation must carry a valid
// X-Internal-Function-Secret header (never received by the browser) and
// a connected user's X-User-OpenRouter-Key header (never falls back to
// the operator's OPENROUTER_API_KEY). POST /api/runs is the only trusted
// caller -- it forwards both headers server-to-server after its own
// synchronous preflight gate passes (see netlify/server/tribunal/
// triggerExecution.ts). Runs up to 15 minutes; the worst-case two-phase,
// two-attempt-per-call execution comfortably fits inside that, unlike a
// normal 60s synchronous Function.
//
// Authoritative execution order lives in netlify/server/tribunal/
// execution.ts's executeTribunalRun -- this handler is a thin,
// authentication-first wrapper around it. Every expected
// application/provider failure is caught and terminalized inside
// executeTribunalRun; the outer try/catch here is the last-resort guard
// against a genuinely unexpected exception, never a lease/heartbeat
// recovery system (Issue #17's Background Failure Scope correction).

import type { BackgroundHandler, HandlerEvent } from "@netlify/functions";
import { readInternalFunctionSecretConfig } from "../server/env";
import { createServerSupabaseClient } from "../server/supabase";
import { SupabaseCaseRepository } from "../server/cases";
import { SupabaseRunRepository } from "../server/runs";
import { createPreflightRunLoader } from "../server/openrouter/preflightRunLoader";
import {
  readInternalFunctionSecretHeader,
  secretsMatch
} from "../server/tribunal/internalSecret";
import { readUserOpenRouterKey, buildUserScopedProviders } from "../server/extraction/userOpenRouterKey";
import { createSupabaseTribunalExecutionRepository } from "../server/tribunal/repository";
import { executeTribunalRun, type TribunalExecutionDeps } from "../server/tribunal/execution";

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HandleTribunalExecuteBackgroundDeps = {
  // Injectable purely for tests -- defaults to real config/execution
  // below, matching the pattern established by every other Netlify
  // Function's handleXRequest/handler split in this repository.
  readSecret: () => string;
  buildExecutionDeps: (userOpenRouterKey: string) => TribunalExecutionDeps;
  execute: (runId: string, deps: TribunalExecutionDeps) => Promise<unknown>;
};

function realDeps(): HandleTribunalExecuteBackgroundDeps {
  return {
    readSecret: () => readInternalFunctionSecretConfig().INTERNAL_FUNCTION_SECRET,
    buildExecutionDeps: (userOpenRouterKey) => {
      const client = createServerSupabaseClient();
      const runRepository = new SupabaseRunRepository(client);
      const caseRepository = new SupabaseCaseRepository(client);
      const { provider, createTimedProvider } = buildUserScopedProviders(
        userOpenRouterKey,
        "tribunalExecuteBackground"
      );

      return {
        runLoader: runRepository,
        preflightRunLoader: createPreflightRunLoader(runRepository, caseRepository),
        provider,
        createTimedProvider,
        repository: createSupabaseTribunalExecutionRepository(client)
      };
    },
    execute: executeTribunalRun
  };
}

export async function handleTribunalExecuteBackgroundRequest(
  event: HandlerEvent,
  deps: HandleTribunalExecuteBackgroundDeps = realDeps()
): Promise<void> {
  if (event.httpMethod !== "POST") {
    return;
  }

  // Authenticate the invocation BEFORE any other work -- reject missing/
  // invalid internal secret before parsing the body, reading the user
  // credential, or touching the database.
  let expectedSecret: string;

  try {
    expectedSecret = deps.readSecret();
  } catch {
    return; // Server misconfigured -- fail closed, zero execution.
  }

  const providedSecret = readInternalFunctionSecretHeader(event);

  if (!providedSecret || !secretsMatch(providedSecret, expectedSecret)) {
    return;
  }

  // User-funded BYOK gate (M7A correction, extended to M8): no connected
  // credential means zero Tribunal execution, exactly as the two paid
  // extraction endpoints already require.
  const userOpenRouterKey = readUserOpenRouterKey(event);

  if (!userOpenRouterKey) {
    return;
  }

  let runId: string;

  try {
    const body = event.body ? JSON.parse(event.body) : {};

    if (typeof body.runId !== "string" || !RUN_ID_PATTERN.test(body.runId)) {
      return;
    }

    runId = body.runId;
  } catch {
    return;
  }

  try {
    await deps.execute(runId, deps.buildExecutionDeps(userOpenRouterKey));
  } catch {
    // Last-resort guard only -- see module comment. Never re-throw (a
    // Background Function's return value/thrown error is not surfaced
    // to any caller; the run's own persisted status is the only durable
    // signal of what happened).
  }
}

export const handler: BackgroundHandler = async (event) => {
  await handleTribunalExecuteBackgroundRequest(event);
};
