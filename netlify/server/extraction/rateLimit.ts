// Milestone 7A -- admission-control rate limiting (ADR 0004 Decision 19,
// SECURITY.md Sec 10).
//
// Corrected this pass (independent pre-live audit, Section 4):
// `SlidingWindowRateLimiter` below is a single-process IN-MEMORY bound.
// Netlify Functions execute in ephemeral, horizontally-scaled runtimes
// (per Netlify's own Functions documentation) -- a per-process Map
// cannot enforce the locked "3 accepted NEW logical-extraction starts
// per 180 seconds per source IP" target across concurrent/successive
// invocations that may land on different underlying instances. This
// class therefore remains valid ONLY as an OPTIONAL best-effort/local
// coarse layer (e.g. for the looser, non-exact retry/preflight
// operational limits, Section 4's own allowance) -- it MUST NOT be
// treated as the authoritative implementation of the new-start policy.
// The authoritative, cross-process mechanism is
// ExtractionRepository#checkAndRecordAdmission (repository.ts), backed
// by a Supabase RPC using a transaction-scoped advisory lock (no
// Redis) -- see service.ts's submitInitialExtraction.
//
// Deliberately NOT a naive path-level HTTP request counter (regardless
// of which layer is used): the caller decides WHETHER a given request
// counts as an admission at all (e.g. the initial endpoint only records
// an admission for a genuinely NEW extractionRequestId, never for an
// idempotent replay of an existing one) -- this module only implements
// the sliding-window counting/eviction mechanism itself.

import { createHash } from "node:crypto";
import { getContext } from "@netlify/functions";

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
// Trusted source IP -- corrected this pass (independent pre-live audit,
// Section 5). The prior revision trusted
// `headers["x-nf-client-connection-ip"]`, a claim review could not
// verify against current official Netlify documentation. The
// `@netlify/functions` package (the one this repository already
// depends on) exports `getContext()`, documented to return the current
// invocation's platform `Context` object -- which includes `ip: string`
// -- callable from a legacy-format Handler function without changing
// its signature (the "smallest compatible change" the correction task
// required). `getContext()` is the value trusted here; a raw
// caller-supplied forwarding header (e.g. `X-Forwarded-For`) is never
// read or trusted anywhere in this module.
//
// `getContext()` throws (or `Context.ip` may be empty) outside a real
// Netlify Function invocation -- e.g. local unit tests, or a genuinely
// missing platform value -- in which case this falls back to a fixed
// shared bucket key rather than trusting any client-supplied
// alternative, intentionally conservative (stricter, not laxer): a
// missing trusted IP means every untrusted caller shares one bucket.
// `overrideIp` exists purely so tests can inject a deterministic value
// without a real Netlify runtime context -- production call sites never
// pass it.
// ---------------------------------------------------------------------

export function trustedSourceIp(overrideIp?: string | null): string {
  if (overrideIp !== undefined) {
    return overrideIp && overrideIp.trim().length > 0 ? overrideIp.trim() : "unknown-source";
  }

  try {
    // getContext() throws outside a real Netlify Function invocation
    // (e.g. this module's own unit tests, or a local non-Netlify dev
    // server) -- caught below, conservative fallback.
    const context = getContext();

    if (context.ip && context.ip.trim().length > 0) {
      return context.ip.trim();
    }
  } catch {
    // Not running inside a real Netlify Function invocation, or the
    // platform IP was genuinely unavailable -- conservative fallback.
  }

  return "unknown-source";
}

// A privacy-conscious bucket key for the Supabase-backed admission RPC
// (Section 3/4): the raw source IP is hashed before it ever reaches the
// database, so no raw IP address is stored in
// setup_extraction_admission_events.
export function hashedAdmissionBucket(namespace: string, sourceIp: string): string {
  return `${namespace}:${createHash("sha256").update(sourceIp, "utf8").digest("hex")}`;
}
