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
import { computeConservativeFullTribunalCostForRoute } from "./routeTierEconomics";
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
