// Milestone 12 (human product override, PR #34) -- POST /api/demo/jon-
// snow/runs. NOT a second Tribunal engine and NOT a fallback for generic
// /api/runs: a dedicated, canonical-only, operator-funded entrance into
// the exact same acceptRun/triggerExecutionIfEligible pipeline
// (netlify/server/tribunal/jonSnowDemoRun.ts). Protected by a revocable
// access capability (demoAccess.ts), never the OpenRouter credential
// itself -- see SECURITY.md Sec 3.1.1.
import type { Handler, HandlerEvent } from "@netlify/functions";
import { z } from "zod";
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
import { hashedAdmissionBucket, trustedSourceIp } from "../server/extraction/rateLimit";
import { JON_SNOW_DEMO_RUN_START_RATE_LIMIT } from "../server/tribunal/rateLimitPolicy";
import {
  createSupabaseAdmissionControl,
  type AdmissionControl
} from "../server/admissionControl";

// Mirrors netlify/functions/runs.ts's HandleRunsRequestDeps split
// exactly: everything real Supabase/OpenRouter construction is injected,
// so this handler is fully unit-testable with fakes (no real network/
// database, no real env vars). `readDemoConfig` is itself injectable
// (rather than the two config values directly) so tests can also exercise
// the "config throws" path (scenario C) without setting real env vars.
// `admissionControl`/`sourceIp` (Milestone 13, Issue #36 G3): optional,
// same pattern as runs.ts -- a caller that omits them gets the pre-M13
// behavior (the rate-limit check is skipped); the real handler below
// always supplies both.
export type HandleDemoJonSnowRunsDeps = {
  caseRepository: IdempotentCaseRepository;
  runRepository: RunRepository;
  tribunalRepository: TribunalExecutionRepository;
  modelDiscovery: Omit<ModelDiscoveryDeps, "clock">;
  readDemoConfig: () => JonSnowDemoServerConfig;
  fetchImpl?: typeof fetch;
  backgroundFunctionBaseUrl?: string;
  admissionControl?: AdmissionControl;
  sourceIp?: string;
};

// Mirrors netlify/functions/runs.ts's own peekClientRequestId exactly --
// a lightweight, standalone UUID check used only to key the
// admission-control dedup, never a substitute for
// acceptJonSnowDemoRun's own request validation.
const clientRequestIdPeekSchema = z.string().uuid();

function peekClientRequestId(rawBody: unknown): string | null {
  if (typeof rawBody !== "object" || rawBody === null || !("clientRequestId" in rawBody)) {
    return null;
  }

  const result = clientRequestIdPeekSchema.safeParse((rawBody as { clientRequestId: unknown }).clientRequestId);

  return result.success ? result.data : null;
}

export async function handleDemoJonSnowRunsRequest(
  event: HandlerEvent,
  deps: HandleDemoJonSnowRunsDeps
) {
  try {
    if (event.httpMethod !== "POST") {
      return runJsonResponse(405, { error: "method_not_allowed" });
    }

    // C: missing/invalid JON_SNOW_DEMO_OPENROUTER_API_KEY or
    // JON_SNOW_DEMO_ACCESS_TOKEN (e.g. a value shorter than the required
    // 32-character minimum, netlify/server/env.ts) -- fails safely,
    // before any case/run/Supabase/provider work. This response (503
    // demo_not_configured) IS distinguishable from an authenticated-but-
    // wrong-token rejection below (401 demo_access_denied) -- correction
    // (independent review): an earlier version of this comment
    // overclaimed the two were indistinguishable by response shape, which
    // was never actually true of this code. The guarantee that matters,
    // and does hold in both cases: zero case/run creation, zero
    // OpenRouter completion/spend.
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

    const rawBody = parseJsonBody(event.body);

    // Milestone 13 (Issue #36 G3): admission-control rate limiting for
    // this operator-funded endpoint, only reached AFTER the access-
    // capability gate above already passed (an invalid-token flood is
    // already rejected for free by that check, before ever consuming an
    // admission slot). Reuses the SAME authoritative
    // check_and_record_admission RPC as generic /api/runs, under its
    // own "jon-snow-demo-start" bucket -- a distinct admission pool that
    // never shares capacity with the generic "run-start" bucket. This is
    // what stops a leaked/shared demo access capability from permitting
    // unbounded fresh clientRequestIds from one source; per SECURITY.md
    // Sec 20, this is a bounded admission control, never a DDoS-proof
    // authentication system.
    //
    // Corrected (independent review, PR #37): a malformed/missing
    // clientRequestId MUST skip the admission-control call ENTIRELY --
    // see the identical correction in netlify/functions/runs.ts for the
    // full reasoning (a `null` identity is NOT exempt from counting
    // against the RPC's sliding window; it would otherwise let repeated
    // malformed requests exhaust the bucket for the same source IP).
    const peekedClientRequestId = peekClientRequestId(rawBody);

    if (deps.admissionControl && peekedClientRequestId !== null) {
      const bucket = hashedAdmissionBucket("jon-snow-demo-start", deps.sourceIp ?? trustedSourceIp());
      const admitted = await deps.admissionControl.checkAndRecordAdmission(
        bucket,
        peekedClientRequestId,
        JON_SNOW_DEMO_RUN_START_RATE_LIMIT.windowMs / 1000,
        JON_SNOW_DEMO_RUN_START_RATE_LIMIT.maxAcceptedRequests
      );

      if (!admitted) {
        return runJsonResponse(429, { error: "rate_limited" });
      }
    }

    const result = await acceptJonSnowDemoRun(rawBody, {
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
    const client = createServerSupabaseClient();

    return await handleDemoJonSnowRunsRequest(event, {
      caseRepository: createSupabaseIdempotentCaseRepository(),
      runRepository: createSupabaseRunRepository(),
      tribunalRepository: createSupabaseTribunalExecutionRepository(client),
      // Metadata-only catalog re-check: the operator's own general
      // OPENROUTER_API_KEY (zero cost, same construction GET /api/models
      // already uses) -- never the demo execution credential.
      modelDiscovery: {
        provider: new RealOpenRouterProvider(readOpenRouterServerConfig()),
        modelCache: sharedModelCache,
        endpointCache: sharedEndpointCache
      },
      readDemoConfig: readJonSnowDemoServerConfig,
      admissionControl: createSupabaseAdmissionControl(client),
      sourceIp: trustedSourceIp()
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
