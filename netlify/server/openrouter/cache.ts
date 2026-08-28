// Milestone 7 -- bounded in-process model/endpoint metadata cache
// (ADR Decision 3). No Redis, no DB table, no queue -- a single-process
// in-memory cache with a locked authoritative TTL. Injectable clock for
// deterministic tests (no sleep-based timing tests).

export const MODEL_METADATA_TTL_MS = 300_000;

// Small, explicit bound appropriate for a SINGLE FROZEN RUN'S working
// set: preflight only ever resolves a handful of distinct configured
// model IDs per run (at most seven participants, realistically far
// fewer distinct models), so a cache used only for that purpose never
// needs to hold more than a modest number of entries. This remains the
// DEFAULT for any ModelMetadataCache instance that does not explicitly
// override maxEntries (e.g. the catalog cache below, and any test that
// constructs a bare cache) -- if this ever needs to grow for that
// narrower purpose, that is a deliberate, documented, reviewed change,
// not a silent one.
export const MODEL_METADATA_CACHE_MAX_ENTRIES = 200;

// Discovery/live-gate correction: this bound is explicitly too small for
// the FULL-CATALOG endpoint-metadata working set GET /api/models needs
// -- one cache entry per catalog model, not per configured participant.
// The M7 live integration gate observed a real catalog of ~387 models;
// with the 200-entry default, the least-recently-set eviction policy
// discarded early entries before a single discovery sweep even finished,
// so a second call within the 5-minute TTL still had to refetch nearly
// everything (confirmed empirically: a second handleModelsRequest call
// took ~47s, matching the first cold sweep, and the selected model's
// pricingObservedAt changed between calls -- not a cache hit).
//
// ENDPOINT_METADATA_CACHE_MAX_ENTRIES is a SEPARATE, explicit, reviewed
// bound for the production endpoint-metadata cache specifically (see
// sharedMetadataCache.ts's sharedEndpointCache) -- more than 2x the
// observed real catalog size, still a fixed in-process bound (no Redis,
// no DB table, no "unlimited"/future-proof claim). If OpenRouter's
// catalog later grows past this, that is a new, separate, reviewed
// capacity decision, not something this constant silently absorbs.
// The MODEL CATALOG cache (one "models" key) and any preflight-only
// cache remain correctly sized by the smaller MODEL_METADATA_CACHE_MAX_ENTRIES
// default above -- this bound is intentionally NOT applied everywhere.
export const ENDPOINT_METADATA_CACHE_MAX_ENTRIES = 1024;

export type Clock = () => number;

export type CacheEntryState = "fresh" | "stale" | "absent";

type CacheEntry<T> = {
  value: T;
  observedAtMs: number;
};

// Deterministic eviction: least-recently-set first (insertion order of the
// underlying Map), evicted only when a *new* key would push the cache past
// MODEL_METADATA_CACHE_MAX_ENTRIES. Re-setting an existing key moves it to
// the most-recently-set position (delete + re-insert), so a hot key that
// keeps getting refreshed is never the next eviction candidate.
export class ModelMetadataCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number = MODEL_METADATA_TTL_MS,
    private readonly clock: Clock = Date.now,
    private readonly maxEntries: number = MODEL_METADATA_CACHE_MAX_ENTRIES
  ) {}

  state(key: string): CacheEntryState {
    const entry = this.entries.get(key);

    if (!entry) {
      return "absent";
    }

    const age = this.clock() - entry.observedAtMs;

    // age < TTL -> fresh; age >= TTL -> stale (Section 10's exact boundary
    // semantics: TTL - 1ms fresh, exactly TTL stale).
    return age < this.ttlMs ? "fresh" : "stale";
  }

  get(key: string): T | null {
    const entry = this.entries.get(key);

    return entry ? entry.value : null;
  }

  set(key: string, value: T): void {
    if (this.entries.has(key)) {
      // Re-setting an existing key must never evict it, and moves it to
      // the most-recently-inserted position -- a plain Map.set on an
      // existing key would otherwise leave it at its original insertion
      // position, making it (incorrectly) the next eviction candidate the
      // moment it becomes the least-recently-refreshed entry.
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;

      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, { value, observedAtMs: this.clock() });
  }

  observedAt(key: string): string | null {
    const entry = this.entries.get(key);

    return entry ? new Date(entry.observedAtMs).toISOString() : null;
  }

  size(): number {
    return this.entries.size;
  }
}

// Corrected this pass (independent review, pre-live micro-correction):
// callers must never fabricate the current invocation time as a
// substitute for an unavailable cache observation timestamp -- doing so
// would silently misrepresent the pricing audit record (the whole point
// of ADR Decision 9's observedAt contract). If a key's observation
// timestamp is missing immediately after a successful cachedFetch of
// that same key, that is an internal invariant violation (should never
// happen in practice), not a normal-flow branch -- it fails closed via
// this dedicated error rather than substituting Date.now().
export class CacheObservedAtUnavailableError extends Error {
  constructor(key: string) {
    super(`No cache observation timestamp available for key "${key}".`);
    this.name = "CacheObservedAtUnavailableError";
  }
}

// Reads the real fetch/observation timestamp for `key`, throwing
// CacheObservedAtUnavailableError instead of returning null/undefined or
// silently falling back to the current time. Intended to be called
// immediately after a successful cachedFetch of the same key so callers
// get PricingSnapshot.observedAt's authoritative value -- never a
// fabricated one.
export function requireCacheObservedAt<T>(
  cache: ModelMetadataCache<T>,
  key: string
): string {
  const observedAt = cache.observedAt(key);

  if (observedAt === null) {
    throw new CacheObservedAtUnavailableError(key);
  }

  return observedAt;
}

// Required refresh-with-fallback semantics (Section 10):
//   fresh                       -> use without refresh
//   stale + successful refetch  -> replace/use fresh
//   stale + failed refetch      -> block (never serve stale as if fresh)
//   no cache + successful fetch -> store/use
//   no cache + failed fetch     -> block
// A caller that wants "fresh cache + provider unavailable -> fresh cache
// may still be used" (Section 38's explicit non-refetch allowance) simply
// never calls refresh() when state() is already "fresh" -- see
// cachedFetch below, which is the shared helper every consumer uses so
// this table's semantics are enforced in exactly one place.
export async function cachedFetch<T>(
  cache: ModelMetadataCache<T>,
  key: string,
  fetcher: () => Promise<T>
): Promise<T> {
  if (cache.state(key) === "fresh") {
    const value = cache.get(key);

    if (value !== null) {
      return value;
    }
  }

  // Stale or absent: attempt a refetch. A failure here must never fall
  // back to serving stale metadata as if it were fresh -- it propagates.
  const value = await fetcher();
  cache.set(key, value);

  return value;
}
