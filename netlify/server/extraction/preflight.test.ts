// Milestone 7A -- economics unit tests (ADR 0004 Decision 9): Decimal
// boundary behavior for evaluateRetryBudget, isolated from the full
// service orchestration (already covered indirectly by service.test.ts).

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { EXTRACTION_HARD_CEILING_USD } from "./constants";
import { evaluateRetryBudget } from "./preflight";

describe("evaluateRetryBudget", () => {
  it("uses the conservative maximum when attempt #1's actual cost is unknown (null), never $0.00", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: null,
      attemptOneConservativeMaxCostUsd: "0.20",
      attemptTwoConservativeMaxCostUsd: new Decimal("0.20")
    });

    expect(result.totalUsd.toFixed()).toBe("0.4");
    expect(result.allowed).toBe(true);
  });

  it("uses the KNOWN actual cost when it is larger than the stored conservative maximum", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: "0.35",
      attemptOneConservativeMaxCostUsd: "0.20",
      attemptTwoConservativeMaxCostUsd: new Decimal("0.10")
    });

    expect(result.totalUsd.toFixed()).toBe("0.45");
  });

  it("uses the stored conservative maximum when the known actual cost is SMALLER than it", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: "0.05",
      attemptOneConservativeMaxCostUsd: "0.20",
      attemptTwoConservativeMaxCostUsd: new Decimal("0.10")
    });

    expect(result.totalUsd.toFixed()).toBe("0.3");
  });

  it("blocks when the combined total would exceed EXTRACTION_HARD_CEILING_USD", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: "0.40",
      attemptOneConservativeMaxCostUsd: "0.40",
      attemptTwoConservativeMaxCostUsd: new Decimal("0.20")
    });

    expect(result.allowed).toBe(false);
    expect(result.totalUsd.gt(EXTRACTION_HARD_CEILING_USD)).toBe(true);
  });

  it("allows exactly at the ceiling boundary (<=, not <)", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: "0.25",
      attemptOneConservativeMaxCostUsd: "0.25",
      attemptTwoConservativeMaxCostUsd: new Decimal("0.25")
    });

    expect(result.totalUsd.toFixed()).toBe(EXTRACTION_HARD_CEILING_USD.toFixed());
    expect(result.allowed).toBe(true);
  });
});
