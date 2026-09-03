// Milestone 12 (human product override, PR #34) -- POST /api/demo/jon-
// snow/runs. NOT a second Tribunal engine and NOT a fallback for generic
// /api/runs: a dedicated, canonical-only, operator-funded entrance into
// the exact same acceptRun/triggerExecutionIfEligible pipeline
// (netlify/server/tribunal/jonSnowDemoRun.ts). Protected by a revocable
// access capability (demoAccess.ts), never the OpenRouter credential
// itself -- see SECURITY.md Sec 3.1.1.
import type { Handler, HandlerEvent } from "@netlify/functions";
import { createSupabaseIdempotentCaseRepository, type IdempotentCaseRepository } from "../server/cases";
import {
  readJonSnowDemoServerConfig,
  readOpenRouterServerConfig,
  type JonSnowDemoServerConfig
} from "../server/env";
import { RealOpenRouterProvider } from "../server/openrouter/provider";
import type { ModelDiscoveryDeps } from "../server/openrouter/modelDiscovery";
import { sharedEndpointCache, sharedModelCache } from "../server/openrouter/sharedMetadataCache";
import { createSupabaseRunRepository, RunValidationError, type RunRepository } from "../server/runs";
import { runErrorResponse, runJsonResponse, toRunResponse } from "../server/runResponses";
import {
  isValidJonSnowDemoAccess,
  readJonSnowDemoAccessHeader
} from "../server/tribunal/demoAccess";
import { acceptJonSnowDemoRun } from "../server/tribunal/jonSnowDemoRun";
import {
  createSupabaseTribunalExecutionRepository,
  type TribunalExecutionRepository
} from "../server/tribunal/repository";
import { createServerSupabaseClient } from "../server/supabase";

// Mirrors netlify/functions/runs.ts's HandleRunsRequestDeps split
// exactly: everything real Supabase/OpenRouter construction is injected,
// so this handler is fully unit-testable with fakes (no real network/
// database, no real env vars). `readDemoConfig` is itself injectable
// (rather than the two config values directly) so tests can also exercise
// the "config throws" path (scenario C) without setting real env vars.
export type HandleDemoJonSnowRunsDeps = {
  caseRepository: IdempotentCaseRepository;
  runRepository: RunRepository;
  tribunalRepository: TribunalExecutionRepository;
  modelDiscovery: Omit<ModelDiscoveryDeps, "clock">;
  readDemoConfig: () => JonSnowDemoServerConfig;
  fetchImpl?: typeof fetch;
  backgroundFunctionBaseUrl?: string;
};

export async function handleDemoJonSnowRunsRequest(
  event: HandlerEvent,
  deps: HandleDemoJonSnowRunsDeps
) {
  try {
    if (event.httpMethod !== "POST") {
      return runJsonResponse(405, { error: "method_not_allowed" });
    }

    // C: missing/invalid JON_SNOW_DEMO_OPENROUTER_API_KEY or
    // JON_SNOW_DEMO_ACCESS_TOKEN -- fails safely with a generic error,
    // before any case/run/Supabase/provider work, and before the access
    // header is even inspected, so a caller can never distinguish
    // "server not configured" from "wrong token" by response shape.
    let demoConfig: JonSnowDemoServerConfig;

    try {
      demoConfig = deps.readDemoConfig();
    } catch {
      return runJsonResponse(503, { error: "demo_not_configured" });
    }

    // A/B: missing or invalid demo access capability -- zero case/run
    // creation, zero provider execution.
    const providedAccess = readJonSnowDemoAccessHeader(event);

    if (!isValidJonSnowDemoAccess(providedAccess, demoConfig.JON_SNOW_DEMO_ACCESS_TOKEN)) {
      return runJsonResponse(401, { error: "demo_access_denied" });
    }

    const result = await acceptJonSnowDemoRun(parseJsonBody(event.body), {
      caseRepository: deps.caseRepository,
      runRepository: deps.runRepository,
      tribunalRepository: deps.tribunalRepository,
      modelDiscovery: deps.modelDiscovery,
      demoOpenRouterKey: demoConfig.JON_SNOW_DEMO_OPENROUTER_API_KEY,
      fetchImpl: deps.fetchImpl,
      backgroundFunctionBaseUrl: deps.backgroundFunctionBaseUrl
    });

    return runJsonResponse(201, {
      run: toRunResponse(result.run),
      executionTriggered: result.executionTriggered
    });
  } catch (error) {
    return runErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleDemoJonSnowRunsRequest(event, {
      caseRepository: createSupabaseIdempotentCaseRepository(),
      runRepository: createSupabaseRunRepository(),
      tribunalRepository: createSupabaseTribunalExecutionRepository(createServerSupabaseClient()),
      // Metadata-only catalog re-check: the operator's own general
      // OPENROUTER_API_KEY (zero cost, same construction GET /api/models
      // already uses) -- never the demo execution credential.
      modelDiscovery: {
        provider: new RealOpenRouterProvider(readOpenRouterServerConfig()),
        modelCache: sharedModelCache,
        endpointCache: sharedEndpointCache
      },
      readDemoConfig: readJonSnowDemoServerConfig
    });
  } catch (error) {
    // Repository/provider construction (e.g. missing Supabase/OpenRouter
    // config) can throw synchronously before handleDemoJonSnowRunsRequest's
    // own try/catch runs -- same pattern as netlify/functions/runs.ts.
    return runErrorResponse(error);
  }
};

function parseJsonBody(body: string | null) {
  if (!body) {
    throw new RunValidationError(["Request body is required."]);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new RunValidationError(["Request body must be valid JSON."]);
  }
}
