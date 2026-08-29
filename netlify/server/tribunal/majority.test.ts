import { describe, expect, it } from "vitest";
import { computeMajorityVerdict, type Verdict } from "./majority";

// SPEC.md OUT-007: exhaustive over all eight three-judge verdict
// combinations. No model call -- plain deterministic code (OUT-008).
describe("computeMajorityVerdict", () => {
  const cases: Array<{ verdicts: [Verdict, Verdict, Verdict]; expected: Verdict }> = [
    { verdicts: ["GUILTY", "GUILTY", "GUILTY"], expected: "GUILTY" },
    { verdicts: ["GUILTY", "GUILTY", "NOT_GUILTY"], expected: "GUILTY" },
    { verdicts: ["GUILTY", "NOT_GUILTY", "GUILTY"], expected: "GUILTY" },
    { verdicts: ["NOT_GUILTY", "GUILTY", "GUILTY"], expected: "GUILTY" },
    { verdicts: ["GUILTY", "NOT_GUILTY", "NOT_GUILTY"], expected: "NOT_GUILTY" },
    { verdicts: ["NOT_GUILTY", "GUILTY", "NOT_GUILTY"], expected: "NOT_GUILTY" },
    { verdicts: ["NOT_GUILTY", "NOT_GUILTY", "GUILTY"], expected: "NOT_GUILTY" },
    { verdicts: ["NOT_GUILTY", "NOT_GUILTY", "NOT_GUILTY"], expected: "NOT_GUILTY" }
  ];

  it.each(cases)("$verdicts -> $expected", ({ verdicts, expected }) => {
    expect(computeMajorityVerdict(verdicts)).toBe(expected);
  });
});
