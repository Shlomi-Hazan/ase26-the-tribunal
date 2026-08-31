import type { Handler, HandlerEvent } from "@netlify/functions";
import { readOpenRouterServerConfig } from "../server/env";
import { RealOpenRouterProvider } from "../server/openrouter/provider";
import {
  listEligibleModels,
  listRoleEligibleModels,
  type ModelDiscoveryDeps
} from "../server/openrouter/modelDiscovery";
import type { RouteRole } from "../server/openrouter/routeResolution";
import {
  sharedEndpointCache,
  sharedModelCache
} from "../server/openrouter/sharedMetadataCache";
import { preflightErrorResponse, preflightJsonResponse } from "../server/openrouter/preflightResponses";

// M9 (Separate-Model Tribunal, Issue #20): the only two accepted role
// values, matching routeResolution.ts's RouteRole exactly. An explicit
// allowlist, never a loose string cast -- any other value (including a
// near-miss like lowercase "advocate") fails closed with a 400, never
// silently falls back to Shared discovery.
const VALID_ROLES: readonly RouteRole[] = ["ADVOCATE", "JUDGE"];

type RoleQueryParamResult =
  | { present: false }
  | { present: true; valid: true; role: RouteRole }
  | { present: true; valid: false };

function parseRoleQueryParam(event: HandlerEvent): RoleQueryParamResult {
  const raw = event.queryStringParameters?.role;

  // M9 pre-live audit correction (Issue #20): "absent" means ONLY
  // genuinely absent per the Netlify event contract (the query string
  // key itself never appears, or the parsed object is missing/null) --
  // never an explicitly supplied empty string. `?role=` and `?role= `
  // (whitespace-only) are both a PRESENT, INVALID role: they fail closed
  // with a 400 below, exactly like any other malformed value, rather
  // than silently falling back to Shared discovery.
  if (raw === undefined || raw === null) {
    return { present: false };
  }

  if ((VALID_ROLES as readonly string[]).includes(raw)) {
    return { present: true, valid: true, role: raw as RouteRole };
  }

  return { present: true, valid: false };
}

export async function handleModelsRequest(
  event: HandlerEvent,
  deps: Omit<ModelDiscoveryDeps, "clock">
) {
  try {
    if (event.httpMethod !== "GET") {
      return preflightJsonResponse(405, { error: "method_not_allowed" });
    }

    const roleParam = parseRoleQueryParam(event);

    // No role query param -- exact, unmodified M8 Shared-Tribunal
    // discovery response shape/semantics.
    if (!roleParam.present) {
      const models = await listEligibleModels(deps);

      return preflightJsonResponse(200, { models });
    }

    if (!roleParam.valid) {
      return preflightJsonResponse(400, {
        error: "invalid_role",
        message: "role must be exactly \"ADVOCATE\" or \"JUDGE\" when provided."
      });
    }

    // M9: role-aware discovery -- reuses the same centralized eligibility
    // primitives (see modelDiscovery.ts), never a second implementation.
    const models = await listRoleEligibleModels(roleParam.role, deps);

    return preflightJsonResponse(200, { models });
  } catch (error) {
    return preflightErrorResponse(error);
  }
}

export const handler: Handler = async (event) => {
  try {
    return await handleModelsRequest(event, {
      provider: new RealOpenRouterProvider(readOpenRouterServerConfig()),
      // Module-scope singletons (sharedMetadataCache.ts) that persist
      // across warm invocations of THIS function's own runtime. Also
      // imported by POST /api/preflight (netlify/functions/preflight.ts)
      // so each function is correctly wired -- but cross-function
      // process/cache sharing is never relied upon: this function's
      // correctness does not depend on POST /api/preflight having run
      // first (corrected this pass, see sharedMetadataCache.ts).
      modelCache: sharedModelCache,
      endpointCache: sharedEndpointCache
    });
  } catch (error) {
    // Provider construction (e.g. missing OPENROUTER_API_KEY) can throw
    // synchronously before handleModelsRequest's own try/catch runs.
    return preflightErrorResponse(error);
  }
};
