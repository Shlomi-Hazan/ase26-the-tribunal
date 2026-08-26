// Milestone 7 -- per-Function-instance metadata cache singletons
// (independent review, pre-live gate; ADR Decision 3).
//
// Renamed contract, corrected this pass (independent audit found the
// original comment here overclaimed a cross-function runtime guarantee
// that does not exist -- see below): ModelMetadataCache itself was
// always correct; what was missing was production wiring. Each Netlify
// Function is bundled and deployed independently, and its own warm
// runtime reuses ITS OWN module-scope state across repeated invocations
// of THAT SAME function -- that per-function warm-instance reuse is the
// actual, reliable mechanism this module provides, and is exactly the
// "bounded in-process, no Redis, no DB table" cache lifetime ADR
// Decision 3 approved.
//
// CORRECTED CLAIM: this file's exports are imported by BOTH
// `POST /api/preflight` (netlify/functions/preflight.ts) and
// `GET /api/models` (netlify/functions/models.ts) so that EACH
// function's own bundled runtime gets a correctly-scoped module-scope
// cache for its own repeated invocations. This is NOT a guarantee that
// the two functions run in the same process or share one cache
// instance at runtime -- separate Netlify Functions are not guaranteed
// to inhabit the same process, and correctness never depends on one
// endpoint's fetch priming the other's cache. If the platform happens to
// colocate them, a shared fetch is a harmless bonus, never a
// requirement -- each function independently satisfies the 5-minute TTL
// contract on its own, using only its own invocation history.
//
// Tests never import this module. Every test constructs its own
// ModelMetadataCache (or omits one, letting the service default to a
// fresh instance) so test runs stay fully isolated and deterministic --
// see preflight.ts's/modelDiscovery.ts's optional cache parameters.

import { ModelMetadataCache } from "./cache";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

export const sharedModelCache = new ModelMetadataCache<RawOpenRouterModel[]>();
export const sharedEndpointCache = new ModelMetadataCache<RawOpenRouterEndpoint[]>();
