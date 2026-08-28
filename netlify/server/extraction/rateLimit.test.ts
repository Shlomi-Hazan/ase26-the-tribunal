// Milestone 7A -- admission-control rate limiter tests (ADR 0004
// Decision 19, SECURITY.md Sec 10).

import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter, trustedSourceIp } from "./rateLimit";

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
  it("uses the Netlify-populated x-nf-client-connection-ip header", () => {
    expect(trustedSourceIp({ "x-nf-client-connection-ip": "203.0.113.5" })).toBe("203.0.113.5");
  });

  it("falls back to a fixed shared bucket key when the trusted header is absent -- never trusts a client-supplied forwarding header instead", () => {
    expect(trustedSourceIp({ "x-forwarded-for": "1.2.3.4" })).toBe("unknown-source");
    expect(trustedSourceIp({})).toBe("unknown-source");
  });
});
