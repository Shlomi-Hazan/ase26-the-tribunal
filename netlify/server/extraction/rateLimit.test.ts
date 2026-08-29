// Milestone 7A -- admission-control rate limiter tests (ADR 0004
// Decision 19, SECURITY.md Sec 10).

import { describe, expect, it } from "vitest";
import { hashedAdmissionBucket, SlidingWindowRateLimiter, trustedSourceIp } from "./rateLimit";

function fakeClock(startMs: number) {
  let now = startMs;

  return { clock: () => now, advance: (deltaMs: number) => (now += deltaMs) };
}

describe("SlidingWindowRateLimiter", () => {
  it("admits up to maxAcceptedRequests within the window, then rejects the next one", () => {
    const { clock } = fakeClock(0);
    const limiter = new SlidingWindowRateLimiter(clock);
    const config = { maxAcceptedRequests: 3, windowMs: 180_000 };

    expect(limiter.checkAndRecord("start", "1.2.3.4", config).allowed).toBe(true);
    expect(limiter.checkAndRecord("start", "1.2.3.4", config).allowed).toBe(true);
    expect(limiter.checkAndRecord("start", "1.2.3.4", config).allowed).toBe(true);
    expect(limiter.checkAndRecord("start", "1.2.3.4", config).allowed).toBe(false); // 4th
  });

  it("admits again once the window rolls past the oldest recorded request", () => {
    const { clock, advance } = fakeClock(0);
    const limiter = new SlidingWindowRateLimiter(clock);
    const config = { maxAcceptedRequests: 1, windowMs: 180_000 };

    expect(limiter.checkAndRecord("start", "1.2.3.4", config).allowed).toBe(true);
    expect(limiter.checkAndRecord("start", "1.2.3.4", config).allowed).toBe(false);

    advance(180_001);

    expect(limiter.checkAndRecord("start", "1.2.3.4", config).allowed).toBe(true);
  });

  it("tracks distinct source IPs independently", () => {
    const { clock } = fakeClock(0);
    const limiter = new SlidingWindowRateLimiter(clock);
    const config = { maxAcceptedRequests: 1, windowMs: 180_000 };

    expect(limiter.checkAndRecord("start", "1.1.1.1", config).allowed).toBe(true);
    expect(limiter.checkAndRecord("start", "2.2.2.2", config).allowed).toBe(true);
    expect(limiter.checkAndRecord("start", "1.1.1.1", config).allowed).toBe(false);
  });

  it("tracks distinct namespaces independently -- a 'retry' rejection does not consume 'start' budget", () => {
    const { clock } = fakeClock(0);
    const limiter = new SlidingWindowRateLimiter(clock);
    const startConfig = { maxAcceptedRequests: 1, windowMs: 180_000 };
    const retryConfig = { maxAcceptedRequests: 1, windowMs: 180_000 };

    expect(limiter.checkAndRecord("extraction-start", "1.1.1.1", startConfig).allowed).toBe(true);
    expect(limiter.checkAndRecord("extraction-retry", "1.1.1.1", retryConfig).allowed).toBe(true);
    expect(limiter.checkAndRecord("extraction-start", "1.1.1.1", startConfig).allowed).toBe(false);
  });
});

describe("trustedSourceIp", () => {
  it("uses the documented Netlify Context.ip value (via an explicit override, standing in for getContext() outside a real invocation)", () => {
    expect(trustedSourceIp("203.0.113.5")).toBe("203.0.113.5");
  });

  it("falls back to a fixed shared bucket key when getContext() is unavailable outside a real Netlify Function invocation (e.g. this test's own environment)", () => {
    // No override supplied -- exercises the real getContext() path,
    // which throws outside an actual Netlify Function invocation.
    expect(trustedSourceIp()).toBe("unknown-source");
  });

  it("an explicit empty/blank override also falls back to the shared bucket key", () => {
    expect(trustedSourceIp("")).toBe("unknown-source");
    expect(trustedSourceIp("   ")).toBe("unknown-source");
  });
});

describe("hashedAdmissionBucket", () => {
  it("never includes the raw source IP in its output -- privacy-conscious (Section 3)", () => {
    const bucket = hashedAdmissionBucket("extraction-start", "203.0.113.5");

    expect(bucket).not.toContain("203.0.113.5");
    expect(bucket.startsWith("extraction-start:")).toBe(true);
  });

  it("is deterministic for the same (namespace, ip) pair", () => {
    expect(hashedAdmissionBucket("extraction-start", "1.2.3.4")).toBe(
      hashedAdmissionBucket("extraction-start", "1.2.3.4")
    );
  });

  it("differs for different source IPs", () => {
    expect(hashedAdmissionBucket("extraction-start", "1.2.3.4")).not.toBe(
      hashedAdmissionBucket("extraction-start", "5.6.7.8")
    );
  });
});
