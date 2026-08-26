// Milestone 7 -- decimal-safe pricing normalization (ADR Decisions 7, 7A,
// 7B, 9, 10, 12). All authoritative arithmetic uses Decimal -- never
// JS Number -- for provider rate calculations, participant cost bounds,
// the retry reserve, the safety factor, tier thresholds, or the $5.00
// budget comparison. Provider rate strings parse directly into Decimal,
// never round-tripped through Number first.

import Decimal from "decimal.js";
import type { RawPublicPricing } from "./schemas";
import type { PreflightReasonCode } from "./errors";

export type PricingSnapshot = {
  modelId: string;
  providerEndpointTag: string;
  promptPricePerToken: Decimal;
  completionPricePerToken: Decimal;
  requestPriceUsd: Decimal;
  // ADR Decision 7B: null when the endpoint does not report the field at
  // all -- distinct from "reported as zero."
  cacheReadPricePerToken: Decimal | null;
  cacheWritePricePerToken: Decimal | null;
  // MAX(promptPricePerToken, cacheReadPricePerToken, cacheWritePricePerToken)
  // -- the value the conservative estimator actually uses in place of
  // promptPricePerToken alone (ADR Decision 7B). Never lower than
  // promptPricePerToken.
  effectiveInputPricePerToken: Decimal;
  promptPricePerMillion: Decimal;
  completionPricePerMillion: Decimal;
  currency: "USD";
  observedAt: string;
};

type PricingBlockedReason = Extract<
  PreflightReasonCode,
  "PRICING_UNAVAILABLE" | "PRICING_UNREPRESENTABLE"
>;

export type PricingResult =
  | { eligible: true; snapshot: PricingSnapshot }
  | { eligible: false; reasonCode: PricingBlockedReason };

const MILLION = new Decimal(1_000_000);

// A present rate string must parse to a finite, non-negative decimal.
// Malformed provider metadata must never silently become an eligible
// route (Section 6) -- returns "invalid" rather than throwing so callers
// can map it to a safe reason code.
function parseRate(raw: string | undefined): Decimal | null | "invalid" {
  if (raw === undefined) {
    return null;
  }

  let parsed: Decimal;

  try {
    parsed = new Decimal(raw);
  } catch {
    return "invalid";
  }

  if (!parsed.isFinite() || parsed.isNegative()) {
    return "invalid";
  }

  return parsed;
}

// ADR Decision 7A, hardened this pass (Section 15): absent -> accepted
// (equivalent to 0, no discount); in [0,1] -> accepted, ignored for
// conservative pricing; negative/>1/non-finite -> blocked. This function
// never applies the discount to any rate -- it only validates it, per the
// locked conservative policy (preflight always uses the undiscounted base
// rate).
function validateDiscount(discount: number | undefined): "ok" | "invalid" {
  if (discount === undefined) {
    return "ok";
  }

  if (!Number.isFinite(discount) || discount < 0 || discount > 1) {
    return "invalid";
  }

  return "ok";
}

// Builds the authoritative PricingSnapshot for one resolved endpoint, or
// reports why the endpoint's pricing is not eligible. This is the single
// place ADR Decisions 7 / 7A / 7B's billable-dimension classification is
// enforced: every current pricing field is deliberately classified into
// (A) impossible-to-invoke, (B) represented conservatively, or
// (C) blocks eligibility -- nothing passes unclassified.
export function buildPricingSnapshot(
  modelId: string,
  providerEndpointTag: string,
  pricing: RawPublicPricing,
  observedAt: string
): PricingResult {
  // (A) impossible for the Tribunal's text-only, no-cache-control request
  // to invoke: image/image_output/image_token/audio/audio_output/
  // input_audio_cache/web_search. Deliberately never parsed or considered
  // -- their value cannot affect this request under any circumstance.

  // (C) blocks: pricing.overrides non-empty (ADR Decision 7A) -- the
  // top-level price is only the default-conditions price; V1 does not
  // implement a conditional-pricing evaluation engine.
  if (pricing.overrides && pricing.overrides.length > 0) {
    return { eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" };
  }

  // (C) blocks: malformed discount (ADR Decision 7A, hardened this pass).
  if (validateDiscount(pricing.discount) === "invalid") {
    return { eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" };
  }

  const promptRate = parseRate(pricing.prompt);
  const completionRate = parseRate(pricing.completion);
  const requestRate = parseRate(pricing.request);
  const internalReasoningRate = parseRate(pricing.internal_reasoning);
  const cacheReadRate = parseRate(pricing.input_cache_read);
  const cacheWriteRate = parseRate(pricing.input_cache_write);
  // (A/C, ADR Decision 7B): input_cache_write_1h is deliberately parsed/
  // classified here (never silently flowing into an unknown state) but
  // structurally excluded from effectiveInputPricePerToken below -- the
  // Tribunal request contract never sends the explicit 1-hour
  // cache-control field this rate requires, so it is impossible for this
  // request to invoke it. A malformed value here still blocks, exactly
  // like any other malformed pricing field -- see the loop below.
  const cacheWrite1hRate = parseRate(pricing.input_cache_write_1h);

  const requiredRatesPresent =
    promptRate !== null &&
    promptRate !== "invalid" &&
    completionRate !== null &&
    completionRate !== "invalid";

  if (!requiredRatesPresent) {
    return { eligible: false, reasonCode: "PRICING_UNAVAILABLE" };
  }

  const anyInvalid = [
    promptRate,
    completionRate,
    requestRate,
    internalReasoningRate,
    cacheReadRate,
    cacheWriteRate,
    cacheWrite1hRate
  ].some((value) => value === "invalid");

  if (anyInvalid) {
    return { eligible: false, reasonCode: "PRICING_UNAVAILABLE" };
  }

  const prompt = promptRate as Decimal;
  const completion = completionRate as Decimal;
  const request = (requestRate as Decimal | null) ?? new Decimal(0);
  const internalReasoning = internalReasoningRate as Decimal | null;
  const cacheRead = cacheReadRate as Decimal | null;
  const cacheWrite = cacheWriteRate as Decimal | null;

  // (C) blocks: non-zero internal_reasoning (ADR Decision 7) -- reasoning-
  // token count is not bounded by V1's request contract.
  if (internalReasoning !== null && !internalReasoning.isZero()) {
    return { eligible: false, reasonCode: "PRICING_UNREPRESENTABLE" };
  }

  // (B) represented conservatively (ADR Decision 7B): MAX(prompt,
  // cacheRead, cacheWrite). Never lower than the raw prompt rate.
  const effectiveInputPricePerToken = Decimal.max(
    prompt,
    cacheRead ?? new Decimal(0),
    cacheWrite ?? new Decimal(0)
  );

  return {
    eligible: true,
    snapshot: {
      modelId,
      providerEndpointTag,
      promptPricePerToken: prompt,
      completionPricePerToken: completion,
      requestPriceUsd: request,
      cacheReadPricePerToken: cacheRead,
      cacheWritePricePerToken: cacheWrite,
      effectiveInputPricePerToken,
      promptPricePerMillion: prompt.times(MILLION),
      completionPricePerMillion: completion.times(MILLION),
      currency: "USD",
      observedAt
    }
  };
}

// ---------------------------------------------------------------------
// Model price tiers (ADR Decision 12; discovery metadata only, never
// budget authority).
// ---------------------------------------------------------------------

export type PriceTier = "FREE" | "BUDGET" | "PREMIUM" | "ABOVE_PREMIUM" | "HARD_BLOCK";

export const TIER_THRESHOLDS_USD = {
  BUDGET_MAX: new Decimal("0.50"),
  PREMIUM_MAX: new Decimal("2.00"),
  ABOVE_PREMIUM_MAX: new Decimal("5.00")
} as const;

// conservativeCompleteRunCostUsd must already be the COMPLETE conservative
// economics for the exact route (effective input pricing + output pricing
// + request fee + retry exposure + any other represented V1 charge,
// undiscounted) -- never a bare per-token rate. FREE requires this
// complete figure to be exactly $0.00 (ADR Decision 12, Section 23): a
// route with prompt=0 but non-zero cache-write/output/request exposure is
// never FREE, because that exposure is already folded into the figure
// this function receives.
export function classifyPriceTier(conservativeCompleteRunCostUsd: Decimal): PriceTier {
  if (conservativeCompleteRunCostUsd.isZero()) {
    return "FREE";
  }

  if (conservativeCompleteRunCostUsd.lte(TIER_THRESHOLDS_USD.BUDGET_MAX)) {
    return "BUDGET";
  }

  if (conservativeCompleteRunCostUsd.lte(TIER_THRESHOLDS_USD.PREMIUM_MAX)) {
    return "PREMIUM";
  }

  if (conservativeCompleteRunCostUsd.lte(TIER_THRESHOLDS_USD.ABOVE_PREMIUM_MAX)) {
    return "ABOVE_PREMIUM";
  }

  return "HARD_BLOCK";
}

export function toDecimalString(value: Decimal): string {
  return value.toFixed(6);
}
