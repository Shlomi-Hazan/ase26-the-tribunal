import { describe, expect, it } from "vitest";
import {
  computeStalenessThresholdMs,
  MAX_ATTEMPTS_PER_LOGICAL_CALL,
  PROVIDER_ATTEMPT_TIMEOUT_MS
} from "./executionTimingPolicy";

// Milestone 13 (Issue #36 G2) -- the pure arithmetic both the server
// execution engine and RunPage's staleness signal rely on.
describe("computeStalenessThresholdMs", () => {
  it("derives the threshold from two sequential concurrent phases, each bounded by one logical call's worst case, plus the orchestration margin", () => {
    const logicalCallWorstCaseMs = PROVIDER_ATTEMPT_TIMEOUT_MS * MAX_ATTEMPTS_PER_LOGICAL_CALL;
    const expected = logicalCallWorstCaseMs * 2 + 60_000;

    expect(computeStalenessThresholdMs()).toBe(expected);
  });

  it("is a positive, finite, bounded value -- comfortably above the pure ~240s provider-time worst case", () => {
    const threshold = computeStalenessThresholdMs();

    expect(threshold).toBeGreaterThan(240_000);
    expect(Number.isFinite(threshold)).toBe(true);
  });
});
