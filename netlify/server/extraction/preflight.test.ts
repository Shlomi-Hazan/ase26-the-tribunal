// Milestone 7A -- economics unit tests (ADR 0004 Decision 9): Decimal
// boundary behavior for evaluateRetryBudget and the attempt-level vs.
// logical-call economics split, isolated from the full service
// orchestration (already covered indirectly by service.test.ts).

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";
import { EXTRACTION_HARD_CEILING_USD, MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL } from "./constants";
import { HandlerDeadline } from "./deadline";
import { FakeExtractionProvider } from "./fakeProvider";
import { evaluateExtractionEligibility, evaluateRetryBudget } from "./preflight";

describe("evaluateRetryBudget", () => {
  it("uses the conservative maximum when attempt #1's actual cost is unknown (null), never $0.00", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: null,
      attemptOnePerAttemptConservativeMaxCostUsd: "0.20",
      attemptTwoPerAttemptConservativeMaxCostUsd: new Decimal("0.20")
    });

    expect(result.totalUsd.toFixed()).toBe("0.4");
    expect(result.allowed).toBe(true);
  });

  it("uses the KNOWN actual cost when it is larger than the stored conservative maximum", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: "0.35",
      attemptOnePerAttemptConservativeMaxCostUsd: "0.20",
      attemptTwoPerAttemptConservativeMaxCostUsd: new Decimal("0.10")
    });

    expect(result.totalUsd.toFixed()).toBe("0.45");
  });

  it("uses the stored conservative maximum when the known actual cost is SMALLER than it", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: "0.05",
      attemptOnePerAttemptConservativeMaxCostUsd: "0.20",
      attemptTwoPerAttemptConservativeMaxCostUsd: new Decimal("0.10")
    });

    expect(result.totalUsd.toFixed()).toBe("0.3");
  });

  it("blocks when the combined total would exceed EXTRACTION_HARD_CEILING_USD", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: "0.40",
      attemptOnePerAttemptConservativeMaxCostUsd: "0.40",
      attemptTwoPerAttemptConservativeMaxCostUsd: new Decimal("0.20")
    });

    expect(result.allowed).toBe(false);
    expect(result.totalUsd.gt(EXTRACTION_HARD_CEILING_USD)).toBe(true);
  });

  it("allows exactly at the ceiling boundary (<=, not <)", () => {
    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: "0.25",
      attemptOnePerAttemptConservativeMaxCostUsd: "0.25",
      attemptTwoPerAttemptConservativeMaxCostUsd: new Decimal("0.25")
    });

    expect(result.totalUsd.toFixed()).toBe(EXTRACTION_HARD_CEILING_USD.toFixed());
    expect(result.allowed).toBe(true);
  });

  // Exact regression reproduction (independent pre-live audit, Section 2):
  // per-attempt conservative maximum = $0.20, logical (both-attempts)
  // maximum = $0.40. Attempt #1's actual cost is unknown -- prior to the
  // fix, attempt #1's STORED conservative figure was the LOGICAL $0.40
  // (conflated), so the retry guard incorrectly computed
  // $0.40 + $0.20 = $0.60 > $0.50 and blocked a retry that was always
  // within the original <= $0.50 reservation. With the corrected
  // per-attempt storage, the guard correctly computes
  // $0.20 + $0.20 = $0.40 <= $0.50 -- the retry MUST be allowed.
  it("regression: a retry within the original <= $0.50 logical reservation is never incorrectly blocked by a conflated logical-vs-per-attempt figure", () => {
    const perAttempt = "0.20";
    const logical = new Decimal(perAttempt).times(MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL);

    expect(logical.toFixed()).toBe("0.4");
    expect(logical.lte(EXTRACTION_HARD_CEILING_USD)).toBe(true);

    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: null,
      attemptOnePerAttemptConservativeMaxCostUsd: perAttempt, // per-attempt, never the logical $0.40
      attemptTwoPerAttemptConservativeMaxCostUsd: new Decimal("0.20")
    });

    expect(result.totalUsd.toFixed()).toBe("0.4");
    expect(result.allowed).toBe(true);
  });

  it("regression: a logical maximum exactly at the $0.50 ceiling still permits a retry under its own per-attempt reservation", () => {
    // logical = $0.50 => per-attempt = $0.25 (two attempts).
    const perAttempt = "0.25";

    const result = evaluateRetryBudget({
      attemptOneActualCostUsd: null,
      attemptOnePerAttemptConservativeMaxCostUsd: perAttempt,
      attemptTwoPerAttemptConservativeMaxCostUsd: new Decimal(perAttempt)
    });

    expect(result.totalUsd.toFixed()).toBe(EXTRACTION_HARD_CEILING_USD.toFixed());
    expect(result.allowed).toBe(true);
  });
});

describe("evaluateExtractionEligibility -- attempt-level vs. logical-call economics", () => {
  const CONFIGURED_MODEL_ID = "vendor/economics-model";

  function goodDeps() {
    const provider = new FakeExtractionProvider();

    provider.listModelsResult = [
      { id: CONFIGURED_MODEL_ID, canonical_slug: CONFIGURED_MODEL_ID }
    ] satisfies RawOpenRouterModel[];
    provider.listEndpointsResult = {
      [CONFIGURED_MODEL_ID]: [
        {
          tag: `${CONFIGURED_MODEL_ID}/endpoint-a`,
          supported_parameters: ["response_format", "max_completion_tokens"],
          max_completion_tokens: 65_000,
          context_length: 500_000,
          max_prompt_tokens: 400_000,
          pricing: { prompt: "0.0000001", completion: "0.0000002" }
        } satisfies RawOpenRouterEndpoint
      ]
    };

    return provider;
  }

  it("logicalConservativeMaxCostUsd is always exactly perAttemptConservativeMaxCostUsd times the max-attempts constant -- never independently computed", async () => {
    const provider = goodDeps();
    const deadline = new HandlerDeadline(() => 0);

    const result = await evaluateExtractionEligibility(CONFIGURED_MODEL_ID, "A short dossier.", {
      provider,
      deadline
    });

    expect(result.eligible).toBe(true);

    const expectedLogical = new Decimal(result.perAttemptConservativeMaxCostUsd).times(
      MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL
    );

    expect(new Decimal(result.logicalConservativeMaxCostUsd).toFixed()).toBe(
      expectedLogical.toFixed()
    );
    // The per-attempt figure is strictly smaller (never equal, since
    // MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL is 2) -- this is
    // the exact distinction whose conflation caused the regression above.
    expect(new Decimal(result.perAttemptConservativeMaxCostUsd).lt(
      new Decimal(result.logicalConservativeMaxCostUsd)
    )).toBe(true);
  });
});
