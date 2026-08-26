import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { buildPricingSnapshot, classifyPriceTier, toDecimalString } from "./pricing";
import type { RawPublicPricing } from "./schemas";

function basePricing(overrides: Partial<RawPublicPricing> = {}): RawPublicPricing {
  return {
    prompt: "0.000003",
    completion: "0.000006",
    ...overrides
  };
}

describe("buildPricingSnapshot -- raw rate parsing", () => {
  it("parses prompt/completion rate strings exactly into Decimal", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing(),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.promptPricePerToken.toString()).toBe("0.000003");
    expect(result.snapshot.completionPricePerToken.toString()).toBe("0.000006");
  });

  it("computes exact per-million display conversion", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing(),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.promptPricePerMillion.toString()).toBe("3");
    expect(result.snapshot.completionPricePerMillion.toString()).toBe("6");
  });

  it("defaults an absent request fee to zero", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing(),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.requestPriceUsd.toString()).toBe("0");
  });

  it("parses a non-zero request fee exactly", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ request: "0.001" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.requestPriceUsd.toString()).toBe("0.001");
  });

  it("blocks with PRICING_UNAVAILABLE when the prompt rate is malformed", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ prompt: "not-a-number" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNAVAILABLE" });
  });

  it("blocks with PRICING_UNAVAILABLE when a rate string is negative", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ request: "-0.01" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNAVAILABLE" });
  });
});

describe("buildPricingSnapshot -- internal_reasoning", () => {
  it("does not block on a zero internal_reasoning rate", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ internal_reasoning: "0" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
  });

  it("blocks with PRICING_UNREPRESENTABLE on a non-zero internal_reasoning rate", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ internal_reasoning: "0.00001" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });
});

describe("buildPricingSnapshot -- pricing.overrides (ADR Decision 7A)", () => {
  it("continues normal flow when overrides is empty", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ overrides: [] }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
  });

  it("continues normal flow when overrides is absent", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing(),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
  });

  it("blocks with PRICING_UNREPRESENTABLE when overrides is non-empty", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ overrides: [{ min_prompt_tokens: 128000, prompt: "0.000006" }] }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });
});

describe("buildPricingSnapshot -- pricing.discount (ADR Decision 7A, hardened)", () => {
  it("accepts an absent discount", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing(),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
  });

  it("accepts and ignores a discount within [0, 1] -- never lowers the bound", () => {
    const withoutDiscount = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing(),
      "2026-08-26T00:00:00.000Z"
    );
    const withDiscount = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ discount: 0.5 }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(withDiscount.eligible).toBe(true);
    if (!withDiscount.eligible || !withoutDiscount.eligible) return;
    expect(withDiscount.snapshot.promptPricePerToken.toString()).toBe(
      withoutDiscount.snapshot.promptPricePerToken.toString()
    );
  });

  it("accepts a discount of exactly 0", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ discount: 0 }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
  });

  it("accepts a discount of exactly 1", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ discount: 1 }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
  });

  it("blocks with PRICING_UNREPRESENTABLE when discount is negative", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ discount: -0.1 }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });

  it("blocks with PRICING_UNREPRESENTABLE when discount is greater than 1", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ discount: 1.5 }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });

  it("blocks with PRICING_UNREPRESENTABLE when discount is NaN", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ discount: Number.NaN }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });

  it("blocks with PRICING_UNREPRESENTABLE when discount is Infinity", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing({ discount: Number.POSITIVE_INFINITY }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });
});

describe("buildPricingSnapshot -- cache-write economics (ADR Decision 7B)", () => {
  it("A: prompt < cache write -> effective input price uses the cache-write rate", () => {
    const result = buildPricingSnapshot(
      "anthropic/claude",
      "anthropic",
      basePricing({ prompt: "0.000003", input_cache_write: "0.00000375" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.effectiveInputPricePerToken.toString()).toBe("0.00000375");
  });

  it("B: cache read < prompt -> conservative bound stays at prompt/cache-write max", () => {
    const result = buildPricingSnapshot(
      "anthropic/claude",
      "anthropic",
      basePricing({
        prompt: "0.000003",
        input_cache_read: "0.0000003",
        input_cache_write: "0.00000375"
      }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.effectiveInputPricePerToken.toString()).toBe("0.00000375");
  });

  it("C: cache read unexpectedly > prompt -> MAX still keeps the estimate conservative", () => {
    const result = buildPricingSnapshot(
      "anthropic/claude",
      "anthropic",
      basePricing({ prompt: "0.000003", input_cache_read: "0.000004" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.effectiveInputPricePerToken.toString()).toBe("0.000004");
  });

  it("D: prompt = 0 and cache write > 0 -> effective input price is non-zero (never FREE)", () => {
    const result = buildPricingSnapshot(
      "anthropic/claude",
      "anthropic",
      basePricing({ prompt: "0", input_cache_write: "0.00000375" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.effectiveInputPricePerToken.isZero()).toBe(false);
  });

  it("F: input_cache_write_1h is parsed but never affects effectiveInputPricePerToken", () => {
    const withHighHourlyRate = buildPricingSnapshot(
      "anthropic/claude",
      "anthropic",
      basePricing({ prompt: "0.000003", input_cache_write_1h: "0.000006" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(withHighHourlyRate.eligible).toBe(true);
    if (!withHighHourlyRate.eligible) return;
    // Even though input_cache_write_1h ($0.000006) exceeds prompt price
    // ($0.000003), the effective price must remain the prompt price --
    // the Tribunal request contract cannot invoke the 1-hour tier.
    expect(withHighHourlyRate.snapshot.effectiveInputPricePerToken.toString()).toBe(
      "0.000003"
    );
  });

  it("G: a malformed input_cache_write_1h still blocks (never silently unclassified)", () => {
    const result = buildPricingSnapshot(
      "anthropic/claude",
      "anthropic",
      basePricing({ input_cache_write_1h: "not-a-number" }),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNAVAILABLE" });
  });

  it("cacheReadPricePerToken/cacheWritePricePerToken are null when absent", () => {
    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      basePricing(),
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
    if (!result.eligible) return;
    expect(result.snapshot.cacheReadPricePerToken).toBeNull();
    expect(result.snapshot.cacheWritePricePerToken).toBeNull();
  });
});

describe("classifyPriceTier -- locked thresholds", () => {
  it("classifies exactly $0.00 as FREE", () => {
    expect(classifyPriceTier(new Decimal(0))).toBe("FREE");
  });

  it("classifies a tiny non-zero amount as BUDGET, never FREE", () => {
    expect(classifyPriceTier(new Decimal("0.0000001"))).toBe("BUDGET");
  });

  it("classifies just above $0.00 as BUDGET", () => {
    expect(classifyPriceTier(new Decimal("0.01"))).toBe("BUDGET");
  });

  it("classifies exactly $0.50 as BUDGET", () => {
    expect(classifyPriceTier(new Decimal("0.50"))).toBe("BUDGET");
  });

  it("classifies just above $0.50 as PREMIUM", () => {
    expect(classifyPriceTier(new Decimal("0.500001"))).toBe("PREMIUM");
  });

  it("classifies exactly $2.00 as PREMIUM", () => {
    expect(classifyPriceTier(new Decimal("2.00"))).toBe("PREMIUM");
  });

  it("classifies just above $2.00 as ABOVE_PREMIUM", () => {
    expect(classifyPriceTier(new Decimal("2.000001"))).toBe("ABOVE_PREMIUM");
  });

  it("classifies exactly $5.00 as ABOVE_PREMIUM", () => {
    expect(classifyPriceTier(new Decimal("5.00"))).toBe("ABOVE_PREMIUM");
  });

  it("classifies just above $5.00 as HARD_BLOCK", () => {
    expect(classifyPriceTier(new Decimal("5.000001"))).toBe("HARD_BLOCK");
  });
});

describe("toDecimalString", () => {
  it("serializes a Decimal as a fixed-precision decimal string, never scientific notation", () => {
    expect(toDecimalString(new Decimal("0.000003"))).toBe("0.000003");
    expect(toDecimalString(new Decimal(0))).not.toContain("e");
  });
});
