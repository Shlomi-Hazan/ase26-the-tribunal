import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  buildPricingSnapshot,
  classifyPriceTier,
  toDecimalString,
  toDisplayUsdString
} from "./pricing";
import { publicPricingSchema, type RawPublicPricing } from "./schemas";

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

  // Lossless-serialization regression tests (independent review, pre-live
  // gate, Section 20). The prior implementation used .toFixed(6), which
  // could turn a legitimate non-zero provider per-token rate into "0".
  it("serializes zero as a valid, unambiguous zero", () => {
    expect(toDecimalString(new Decimal(0))).toBe("0");
  });

  it("never rounds a small non-zero rate to zero", () => {
    expect(toDecimalString(new Decimal("0.00000007"))).toBe("0.00000007");
    expect(toDecimalString(new Decimal("0.00000007"))).not.toBe("0");
    expect(toDecimalString(new Decimal("0.00000007"))).not.toBe("0.000000");
  });

  it("round-trips common OpenRouter per-token rates exactly", () => {
    for (const rate of ["0.000003", "0.000006", "0.0000005", "0.000001", "0.00003"]) {
      expect(toDecimalString(new Decimal(rate))).toBe(rate);
    }
  });

  it("preserves an extremely small positive rate as non-zero", () => {
    const tiny = new Decimal("0.0000000000001");

    expect(toDecimalString(tiny)).not.toBe("0");
    expect(new Decimal(toDecimalString(tiny)).isZero()).toBe(false);
  });

  it("never uses scientific notation for a very small value", () => {
    expect(toDecimalString(new Decimal("0.0000000000001"))).not.toMatch(/e/i);
  });
});

describe("toDisplayUsdString", () => {
  it("is a distinct, separately-named display formatter that MAY round", () => {
    expect(toDisplayUsdString(new Decimal("0.00000007"))).toBe("0.00");
    // The authoritative serializer must never do this -- proving the two
    // are genuinely different functions, not aliases of each other.
    expect(toDecimalString(new Decimal("0.00000007"))).not.toBe(
      toDisplayUsdString(new Decimal("0.00000007"))
    );
  });

  it("defaults to 2 decimal places for human-facing USD totals", () => {
    expect(toDisplayUsdString(new Decimal("1.005"))).toMatch(/^1\.0[01]$/);
    expect(toDisplayUsdString(new Decimal("5"))).toBe("5.00");
  });
});

describe("unknown pricing keys fail closed (independent review, pre-live gate)", () => {
  // These tests parse through the REAL publicPricingSchema first -- the
  // defect being fixed is that a plain z.object(...) silently stripped
  // unrecognized keys before buildPricingSnapshot ever saw them. Building
  // a RawPublicPricing object by hand (bypassing the schema) would not
  // exercise that failure mode at all.

  it("an unknown pricing key with a zero-like value fails closed (PRICING_UNREPRESENTABLE)", () => {
    const parsed = publicPricingSchema.parse({
      prompt: "0.000003",
      completion: "0.000006",
      future_billable_dimension: "0"
    });

    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      parsed,
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });

  it("an unknown pricing key with a non-zero value fails closed (PRICING_UNREPRESENTABLE)", () => {
    const parsed = publicPricingSchema.parse({
      prompt: "0.000003",
      completion: "0.000006",
      future_billable_dimension: "0.01"
    });

    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      parsed,
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });

  it("a future object/array-shaped pricing modifier key fails closed", () => {
    const parsed = publicPricingSchema.parse({
      prompt: "0.000003",
      completion: "0.000006",
      future_conditional_modifier: [{ some: "structure" }]
    });

    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      parsed,
      "2026-08-26T00:00:00.000Z"
    );

    expect(result).toEqual({ eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" });
  });

  it("the unknown key survives Zod parsing instead of being silently stripped", () => {
    const parsed = publicPricingSchema.parse({
      prompt: "0.000003",
      completion: "0.000006",
      future_billable_dimension: "0.01"
    });

    expect(parsed).toHaveProperty("future_billable_dimension", "0.01");
  });

  it("known current pricing keys continue to parse and classify normally", () => {
    const parsed = publicPricingSchema.parse({
      prompt: "0.000003",
      completion: "0.000006",
      request: "0.001",
      input_cache_read: "0.0000003",
      input_cache_write: "0.00000375",
      internal_reasoning: "0",
      discount: 0.1,
      overrides: []
    });

    const result = buildPricingSnapshot(
      "openai/gpt-5",
      "openai",
      parsed,
      "2026-08-26T00:00:00.000Z"
    );

    expect(result.eligible).toBe(true);
  });
});
