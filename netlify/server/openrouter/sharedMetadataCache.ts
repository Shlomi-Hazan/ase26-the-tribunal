// Milestone 7 -- shared, module-scope metadata cache singletons
// (independent review, pre-live gate; ADR Decision 3, Sections 15-18 of
// the correction task).
//
// ModelMetadataCache itself was always correct; what was missing was
// production wiring. A Netlify Function module is reused across warm
// invocations of the same underlying container -- module-scope state
// declared here persists exactly as long as that container stays warm,
// which is precisely the "bounded in-process, no Redis, no DB table"
// cache lifetime ADR Decision 3 approved. Both POST /api/preflight
// (netlify/functions/preflight.ts) and GET /api/models
// (netlify/functions/models.ts) import and inject these SAME two
// instances, so a warm container never independently refetches the same
// model/endpoint metadata twice within the 5-minute TTL, and a route
// resolved by one endpoint benefits from a fetch already made by the
// other.
//
// Tests never import this module. Every test constructs its own
// ModelMetadataCache (or omits one, letting the service default to a
// fresh instance) so test runs stay fully isolated and deterministic --
// see preflight.ts's/modelDiscovery.ts's optional cache parameters.

import { ModelMetadataCache } from "./cache";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

export const sharedModelCache = new ModelMetadataCache<RawOpenRouterModel[]>();
export const sharedEndpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>();
