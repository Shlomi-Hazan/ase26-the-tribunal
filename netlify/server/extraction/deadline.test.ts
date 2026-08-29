// Milestone 7A -- handler-wide soft deadline tests (ADR 0004 Decision 8,
// corrected in the fourth planning pass). Deterministic injectable clock
// -- no sleep-based timing tests.

import { describe, expect, it } from "vitest";
import { HandlerDeadline } from "./deadline";
import {
  PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS,
  PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS,
  PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS
} from "./constants";

function fakeClock(startMs: number) {
  let now = startMs;

  return {
    clock: () => now,
    advance: (deltaMs: number) => {
      now += deltaMs;
    }
  };
}

describe("HandlerDeadline", () => {
  it("does not throw when ample time remains", () => {
    const { clock } = fakeClock(0);
    const deadline = new HandlerDeadline(clock);

    expect(() => deadline.assertMinimumWindow()).not.toThrow();
  });

  it("pre-claim: throws INPUT_PROCESSING_TIMEOUT when remaining time is already below the minimum window", () => {
    const { clock, advance } = fakeClock(0);
    const deadline = new HandlerDeadline(clock);

    advance(
      PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS - PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS + 1
    );

    expect(() => deadline.assertMinimumWindow()).toThrowError(
      expect.objectContaining({ code: "INPUT_PROCESSING_TIMEOUT" })
    );
  });

  it("exact boundary: remainingMs === minimum window is still permitted (strictly-less-than, not <=)", () => {
    const { clock, advance } = fakeClock(0);
    const deadline = new HandlerDeadline(clock);

    advance(
      PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS - PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS
    );

    expect(() => deadline.assertMinimumWindow()).not.toThrow();
  });

  it("post-claim recheck uses freshly recomputed time, never a stale pre-claim value", () => {
    const { clock, advance } = fakeClock(0);
    const deadline = new HandlerDeadline(clock);

    deadline.assertMinimumWindow(); // pre-claim check passes
    const preClaimRemaining = deadline.remainingMs();

    // Simulate the atomic claim itself consuming real time.
    advance(10_000);

    const postClaimRemaining = deadline.remainingMs();

    expect(postClaimRemaining).toBeLessThan(preClaimRemaining);
    expect(postClaimRemaining).toBe(preClaimRemaining - 10_000);
  });

  it("post-claim: insufficient window throws after the claim consumed time even though the pre-claim check passed", () => {
    const { clock, advance } = fakeClock(0);
    const deadline = new HandlerDeadline(clock);

    deadline.assertMinimumWindow(); // pre-claim: passes

    advance(
      PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS - PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS + 1
    );

    expect(() => deadline.assertMinimumWindow()).toThrowError(
      expect.objectContaining({ code: "INPUT_PROCESSING_TIMEOUT" })
    );
  });

  it("effectiveProviderTimeoutMs uses min(providerTimeout, remainingMs) computed from the CURRENT call", () => {
    const { clock, advance } = fakeClock(0);
    const deadline = new HandlerDeadline(clock);

    // Ample time -> capped at the provider timeout constant.
    expect(deadline.effectiveProviderTimeoutMs()).toBe(PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS);

    // Advance so remaining time is now BELOW the provider timeout
    // constant -- effective timeout must shrink to match.
    advance(20_000);
    const remaining = deadline.remainingMs();

    expect(deadline.effectiveProviderTimeoutMs()).toBe(Math.min(PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS, remaining));
    expect(deadline.effectiveProviderTimeoutMs()).toBeLessThan(PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS);
  });
});
