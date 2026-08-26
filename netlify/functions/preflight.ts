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
import { RunValidationError } from "../server/runs";
import { createSupabaseIdempotentCaseRepository } from "../server/cases";
import { createSupabaseRunRepository } from "../server/runs";

const preflightRequestSchema = z.strictObject({
  runId: z.string().uuid("runId must be a valid UUID.")
});

export async function handlePreflightRequest(
  event: HandlerEvent,
  deps: Omit<PreflightServiceDeps, "clock" | "modelCache" | "endpointCache">
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
      provider: new RealOpenRouterProvider(readOpenRouterServerConfig())
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
