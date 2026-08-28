import type { Handler, HandlerEvent } from "@netlify/functions";
import { z } from "zod";
import { readOpenRouterServerConfig } from "../server/env";
import { RealOpenRouterProvider } from "../server/openrouter/provider";
import { createPreflightRunLoader } from "../server/openrouter/preflightRunLoader";
import {
  preflightErrorResponse,
  preflightJsonResponse,
  toPreflightResponse
} from "../server/openrouter/preflightResponses";
import { runPreflight, type PreflightServiceDeps } from "../server/openrouter/preflight";
import {
  sharedEndpointCache,
  sharedModelCache
} from "../server/openrouter/sharedMetadataCache";
import { RunValidationError } from "../server/runs";
import { createSupabaseIdempotentCaseRepository } from "../server/cases";
import { createSupabaseRunRepository } from "../server/runs";

const preflightRequestSchema = z.strictObject({
  runId: z.string().uuid("runId must be a valid UUID.")
});

// Correction (independent review, pre-live gate): modelCache/endpointCache
// are no longer excluded here -- the real `handler` below now injects the
// shared, module-scope cache singletons (sharedMetadataCache.ts) so warm
// invocations actually reuse fresh metadata within the 5-minute TTL
// instead of recreating an empty cache on every request. Tests still
// call handlePreflightRequest directly with their own fakes and simply
// omit modelCache/endpointCache/clock, which runPreflight's own defaults
// (a fresh per-call cache) already handle safely.
export async function handlePreflightRequest(
  event: HandlerEvent,
  deps: Omit<PreflightServiceDeps, "clock">
) {
  try {
    if (event.httpMethod !== "POST") {
      return preflightJsonResponse(405, { error: "method_not_allowed" });
    }

    const runId = parseRunId(event.body);
    const result = await runPreflight(runId, deps);

    return preflightJsonResponse(200, toPreflightResponse(result));
  } catch (error) {
    return preflightErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handlePreflightRequest(event, {
      runLoader: createPreflightRunLoader(
        createSupabaseRunRepository(),
        createSupabaseIdempotentCaseRepository()
      ),
      provider: new RealOpenRouterProvider(readOpenRouterServerConfig()),
      // Module-scope singletons (sharedMetadataCache.ts) that persist
      // across warm invocations of THIS function's own runtime,
      // giving the approved 5-minute TTL cache its intended effect in
      // production. Also imported by GET /api/models
      // (netlify/functions/models.ts) so each function is correctly
      // wired -- but cross-function process/cache sharing is never
      // relied upon: this function's correctness does not depend on
      // GET /api/models having run first (corrected this pass, see
      // sharedMetadataCache.ts).
      modelCache: sharedModelCache,
      endpointCache: sharedEndpointCache
    });
  } catch (error) {
    // Repository/provider construction (e.g. missing server config) can
    // throw synchronously before handlePreflightRequest's own try/catch
    // runs. Route it through the same safe error response so no stack
    // trace/internal path ever reaches the client (matches
    // netlify/functions/runs.ts's pattern).
    return preflightErrorResponse(error);
  }
};

function parseRunId(body: string | null): string {
  if (!body) {
    throw new RunValidationError(["Request body is required."]);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(body);
  } catch {
    throw new RunValidationError(["Request body must be valid JSON."]);
  }

  const result = preflightRequestSchema.safeParse(parsed);

  if (!result.success) {
    throw new RunValidationError(result.error.issues.map((issue) => issue.message));
  }

  return result.data.runId;
}
