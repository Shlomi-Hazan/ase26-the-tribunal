// Milestone 7A -- application-aware admission-control rate limiter (ADR
// 0004 Decision 19, SECURITY.md Sec 10). A single-process in-memory
// bound, mirroring M7's ModelMetadataCache in spirit (no Redis, no DB
// table, no queue) -- appropriate for a V1 single-tenant demo app.
//
// Deliberately NOT a naive path-level HTTP request counter (implementation
// note, ADR Decision 19 sixth pass): the caller decides WHETHER a given
// request counts as an admission at all (e.g. the initial endpoint only
// calls `recordAndCheck` for a genuinely NEW extractionRequestId, never
// for an idempotent replay of an existing one) -- this module only
// implements the sliding-window counting/eviction mechanism itself.

export type RateLimitConfig = {
  maxAcceptedRequests: number;
  windowMs: number;
};

export type RateLimitResult = { allowed: true } | { allowed: false };

export type Clock = () => number;

// Bounded map size: each distinct (namespace, key) pair gets its own
// timestamp list. A generous fixed cap (matching the spirit of
// ModelMetadataCache's MODEL_METADATA_CACHE_MAX_ENTRIES) prevents
// unbounded memory growth from a flood of distinct source IPs -- the
// oldest-inserted key is evicted first once the cap is reached, same
// least-recently-set discipline ModelMetadataCache already uses.
const MAX_TRACKED_KEYS = 4096;

export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, number[]>();

  constructor(private readonly clock: Clock = Date.now) {}

  // Atomic-in-process check-and-record: evaluates whether `key` has
  // capacity remaining under `config` as of now, and if so, records this
  // admission immediately (never a separate "check" then "record" pair a
  // caller could race between within the same single-threaded Node
  // event-loop turn regardless, but keeping this atomic avoids a
  // TOCTOU-shaped bug if this is ever refactored to await between the
  // two steps).
  checkAndRecord(namespace: string, key: string, config: RateLimitConfig): RateLimitResult {
    const compositeKey = `${namespace}:${key}`;
    const now = this.clock();
    const windowStart = now - config.windowMs;

    let timestamps = this.windows.get(compositeKey);

    if (timestamps) {
      // Move to most-recently-touched position, same eviction discipline
      // as ModelMetadataCache -- a hot key is never the next eviction
      // candidate.
      this.windows.delete(compositeKey);
    } else {
      timestamps = [];

      if (this.windows.size >= MAX_TRACKED_KEYS) {
        const oldestKey = this.windows.keys().next().value;

        if (oldestKey !== undefined) {
          this.windows.delete(oldestKey);
        }
      }
    }

    const withinWindow = timestamps.filter((timestamp) => timestamp > windowStart);

    if (withinWindow.length >= config.maxAcceptedRequests) {
      this.windows.set(compositeKey, withinWindow);

      return { allowed: false };
    }

    withinWindow.push(now);
    this.windows.set(compositeKey, withinWindow);

    return { allowed: true };
  }
}

// Module-scope singleton, mirroring sharedMetadataCache.ts's pattern --
// persists across warm Netlify Function invocations of the same runtime
// so the window actually has effect in production; each function's own
// tests inject a fresh SlidingWindowRateLimiter instead.
export const sharedExtractionRateLimiter = new SlidingWindowRateLimiter();

// ---------------------------------------------------------------------
// Trusted source IP (implementation note, ADR Decision 19 sixth pass):
// derived from the Netlify Function invocation context, never a raw
// caller-supplied header taken at face value -- an unauthenticated caller
// could otherwise spoof a fresh IP per request via a forwarding header
// and defeat the limit entirely. Netlify's HandlerEvent structurally
// carries a platform-populated `headers["x-nf-client-connection-ip"]`
// (set by the edge/CDN layer itself, not forwarded verbatim from the
// client) -- this is the one field trusted here. If it is ever absent
// (e.g. a non-Netlify local dev invocation), the caller falls back to a
// fixed shared bucket key rather than trusting any client-supplied
// header, which is intentionally conservative (stricter, not laxer) --
// a missing trusted IP means every untrusted caller shares one bucket.
// ---------------------------------------------------------------------

export function trustedSourceIp(headers: Record<string, string | undefined>): string {
  const trusted = headers["x-nf-client-connection-ip"];

  if (trusted && trusted.trim().length > 0) {
    return trusted.trim();
  }

  return "unknown-source";
}
