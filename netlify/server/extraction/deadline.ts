// Milestone 7A -- handler-wide soft deadline, checked twice (ADR 0004
// Decision 8, corrected in the fourth planning pass). Uses monotonic
// elapsed time (`performance.now()`, never `Date.now()`, which can jump
// on clock adjustment) -- the pre-claim value is never reused for the
// post-claim/provider-timeout computation, since the atomic claim itself
// consumes real time between the two checks.

import {
  PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS,
  PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS,
  PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS
} from "./constants";
import { ExtractionError } from "./errors";

export type MonotonicClock = () => number;

export const defaultMonotonicClock: MonotonicClock = () => performance.now();

export class HandlerDeadline {
  private readonly startMs: number;

  constructor(private readonly clock: MonotonicClock = defaultMonotonicClock) {
    this.startMs = clock();
  }

  remainingMs(): number {
    const elapsedMs = this.clock() - this.startMs;

    return PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS - elapsedMs;
  }

  // Throws INPUT_PROCESSING_TIMEOUT if the remaining window is already
  // below the locked minimum -- used for BOTH the pre-claim check (before
  // any deterministic pre-work / before the atomic claim) and, called
  // again with a freshly recomputed remainingMs, the post-claim check
  // immediately before the provider fetch. Callers must never cache a
  // remainingMs() result across an await boundary that could itself
  // consume time (e.g. the atomic claim) -- always call remainingMs()
  // fresh at the point that matters.
  assertMinimumWindow(): void {
    if (this.remainingMs() < PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS) {
      throw new ExtractionError(
        "INPUT_PROCESSING_TIMEOUT",
        "Insufficient time remains in the handler's soft deadline to attempt a provider call."
      );
    }
  }

  // Computed from THIS call's freshly read remainingMs() -- callers must
  // call this immediately before the provider fetch, after
  // assertMinimumWindow() has already passed at that same point in time,
  // never using an earlier (e.g. pre-claim) remainingMs() value.
  effectiveProviderTimeoutMs(): number {
    return Math.min(PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS, this.remainingMs());
  }
}
