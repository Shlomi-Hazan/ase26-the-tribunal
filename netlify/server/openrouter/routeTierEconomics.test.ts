import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  BUDGET_SAFETY_FACTOR,
  MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL,
  TOTAL_ADVOCATES,
  TOTAL_JUDGES
} from "./economicsConstants";
import { buildPricingSnapshot } from "./pricing";
import { computeCandidateAttemptCostUsd } from "./routeResolution";
import {
  computeConservativeFullTribunalCostForRoute,
  computeConservativeParticipantEstimateForRoute
} from "./routeTierEconomics";
import {
  ADVOCATE_OUTPUT_CAP_TOKENS,
  JUDGE_OUTPUT_CAP_TOKENS,
  worstCaseAdvocateInputTokens,
  worstCaseJudgeInputTokens
} from "./tokenEstimation";

function pricingSnapshotFixture() {
  const result = buildPricingSnapshot(
    "openai/gpt-5",
    "openai",
    { prompt: "0.000003", completion: "0.000006", request: "0.0001" },
    "2026-08-26T00:00:00.000Z"
  );

  if (!result.eligible) {
    throw new Error("expected a resolvable pricing fixture");
  }

  return result.snapshot;
}

describe("computeConservativeFullTribunalCostForRoute (Section 9's centralized helper)", () => {
  it("matches the exact 4-advocate + 3-judge, x2-retry, x1.10-safety-factor formula", () => {
    const pricing = pricingSnapshotFixture();

    const advocateAttemptCost = computeCandidateAttemptCostUsd(
      pricing,
      worstCaseAdvocateInputTokens(),
      ADVOCATE_OUTPUT_CAP_TOKENS
    );
    const judgeAttemptCost = computeCandidateAttemptCostUsd(
      pricing,
      worstCaseJudgeInputTokens(),
      JUDGE_OUTPUT_CAP_TOKENS
    );

    const expected = advocateAttemptCost
      .times(MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL)
      .times(TOTAL_ADVOCATES)
      .plus(
        judgeAttemptCost.times(MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL).times(TOTAL_JUDGES)
      )
      .times(BUDGET_SAFETY_FACTOR);

    expect(
      computeConservativeFullTribunalCostForRoute(pricing).equals(expected)
    ).toBe(true);
  });

  it("uses distinct advocate and judge input/output bounds -- not one figure scaled by 7", () => {
    const pricing = pricingSnapshotFixture();

    const advocateAttemptCost = computeCandidateAttemptCostUsd(
      pricing,
      worstCaseAdvocateInputTokens(),
      ADVOCATE_OUTPUT_CAP_TOKENS
    );
    // The old, corrected approximation: one attempt's cost x 2 (retry) x 7
    // (as if every logical call had advocate economics).
    const oldApproximation = advocateAttemptCost
      .times(MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL)
      .times(TOTAL_ADVOCATES + TOTAL_JUDGES)
      .times(BUDGET_SAFETY_FACTOR);

    expect(
      computeConservativeFullTribunalCostForRoute(pricing).equals(oldApproximation)
    ).toBe(false);
  });

  it("judge economics reserve the 4x1000 advocate-speech input exposure, making the judge share strictly larger per call than the advocate share", () => {
    const pricing = pricingSnapshotFixture();

    const advocateAttemptCost = computeCandidateAttemptCostUsd(
      pricing,
      worstCaseAdvocateInputTokens(),
      ADVOCATE_OUTPUT_CAP_TOKENS
    );
    const judgeAttemptCost = computeCandidateAttemptCostUsd(
      pricing,
      worstCaseJudgeInputTokens(),
      JUDGE_OUTPUT_CAP_TOKENS
    );

    expect(judgeAttemptCost.greaterThan(advocateAttemptCost)).toBe(true);
  });

  it("is deterministic for the same pricing snapshot", () => {
    const pricing = pricingSnapshotFixture();

    const first = computeConservativeFullTribunalCostForRoute(pricing);
    const second = computeConservativeFullTribunalCostForRoute(pricing);

    expect(first.equals(second)).toBe(true);
  });

  it("scales with the route's effective input price (cache-write-aware)", () => {
    const cheap = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      { prompt: "0.000001", completion: "0.000002" },
      "2026-08-26T00:00:00.000Z"
    );
    const expensive = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      { prompt: "0.00001", completion: "0.00002" },
      "2026-08-26T00:00:00.000Z"
    );

    if (!cheap.eligible || !expensive.eligible) {
      throw new Error("expected resolvable pricing fixtures");
    }

    const cheapCost = computeConservativeFullTribunalCostForRoute(cheap.snapshot);
    const expensiveCost = computeConservativeFullTribunalCostForRoute(expensive.snapshot);

    expect(expensiveCost.greaterThan(cheapCost)).toBe(true);
  });

  it("returns Decimal(0) for a genuinely free route", () => {
    const free = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      { prompt: "0", completion: "0" },
      "2026-08-26T00:00:00.000Z"
    );

    if (!free.eligible) {
      throw new Error("expected a resolvable free pricing fixture");
    }

    expect(
      computeConservativeFullTribunalCostForRoute(free.snapshot).equals(new Decimal(0))
    ).toBe(true);
  });
});

// M9 (Separate-Model Tribunal, Issue #20), Test Plan item Z2:
// "role-specific participant estimate semantics are mathematically
// consistent with the existing Shared full-Tribunal estimate for an
// otherwise identical pricing route."
describe("computeConservativeParticipantEstimateForRoute (M9 role-aware discovery)", () => {
  it("4x(ADVOCATE participant estimate) + 3x(JUDGE participant estimate) exactly equals the full-Tribunal estimate for the same pricing", () => {
    const pricing = pricingSnapshotFixture();

    const advocateEstimate = computeConservativeParticipantEstimateForRoute(pricing, "ADVOCATE");
    const judgeEstimate = computeConservativeParticipantEstimateForRoute(pricing, "JUDGE");
    const reconstructedFullTribunal = advocateEstimate.times(4).plus(judgeEstimate.times(3));

    expect(reconstructedFullTribunal.equals(computeConservativeFullTribunalCostForRoute(pricing))).toBe(
      true
    );
  });

  it("matches the exact x2-retry, x1.10-safety-factor formula for a single participant", () => {
    const pricing = pricingSnapshotFixture();

    const advocateAttemptCost = computeCandidateAttemptCostUsd(
      pricing,
      worstCaseAdvocateInputTokens(),
      ADVOCATE_OUTPUT_CAP_TOKENS
    );
    const expected = advocateAttemptCost
      .times(MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL)
      .times(BUDGET_SAFETY_FACTOR);

    expect(
      computeConservativeParticipantEstimateForRoute(pricing, "ADVOCATE").equals(expected)
    ).toBe(true);
  });

  it("the judge participant estimate is strictly larger than the advocate participant estimate (same reserve as the full-Tribunal formula)", () => {
    const pricing = pricingSnapshotFixture();

    const advocateEstimate = computeConservativeParticipantEstimateForRoute(pricing, "ADVOCATE");
    const judgeEstimate = computeConservativeParticipantEstimateForRoute(pricing, "JUDGE");

    expect(judgeEstimate.greaterThan(advocateEstimate)).toBe(true);
  });

  it("returns Decimal(0) for a genuinely free route, for either role", () => {
    const free = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      { prompt: "0", completion: "0" },
      "2026-08-26T00:00:00.000Z"
    );

    if (!free.eligible) {
      throw new Error("expected a resolvable free pricing fixture");
    }

    expect(
      computeConservativeParticipantEstimateForRoute(free.snapshot, "ADVOCATE").equals(new Decimal(0))
    ).toBe(true);
    expect(
      computeConservativeParticipantEstimateForRoute(free.snapshot, "JUDGE").equals(new Decimal(0))
    ).toBe(true);
  });
});
