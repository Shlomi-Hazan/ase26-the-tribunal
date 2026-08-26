// Milestone 7 -- sanitized model/route discovery surface
// (ARCHITECTURE.md Sec 5.3). Never proxies the raw OpenRouter catalog
// directly, never exposes credentials. Independent of any specific frozen
// run -- uses a worst-case-length synthetic input (the same conservative
// philosophy as docs/economics.md Sec 10.1's Hebrew-input rationale, since
// no real participant text exists yet at discovery time) so a route is
// never optimistically classified against a shorter estimate than a real
// run could actually need.

import {
  chargeSheetLimits,
  personalityLimit
} from "../../../src/schemas/tribunalSetup";
import { buildAdvocateSystemPrompt } from "../../../src/prompts/advocate-system";
import type { PriceTier } from "./pricing";
import { classifyPriceTier } from "./pricing";
import {
  computeCandidateAttemptCostUsd,
  resolveModelRoute
} from "./routeResolution";
import {
  ADVOCATE_OUTPUT_CAP_TOKENS,
  FIXED_PROMPT_OVERHEAD_TOKENS
} from "./tokenEstimation";
import type { OpenRouterProvider } from "./provider";
import { toDecimalString, TIER_THRESHOLDS_USD } from "./pricing";

// 2-byte UTF-8 character, matching docs/economics.md Sec 10.1's
// Hebrew-input conservative rationale -- biases the worst-case synthetic
// estimate higher than an ASCII-only worst case would.
const WORST_CASE_CHAR = "א";

function worstCaseInputTokens(): number {
  const chargeSheetChars =
    chargeSheetLimits.defendant + chargeSheetLimits.act + chargeSheetLimits.exactQuestion;
  const worstCaseText =
    buildAdvocateSystemPrompt("PRO") +
    WORST_CASE_CHAR.repeat(personalityLimit) +
    WORST_CASE_CHAR.repeat(chargeSheetChars);
  const byteLength = new TextEncoder().encode(worstCaseText).length;

  return Math.ceil(byteLength / 2) + FIXED_PROMPT_OVERHEAD_TOKENS;
}

export type EligibleModel = {
  id: string;
  canonicalModelId: string;
  name: string;
  providerName: string;
  contextLength: number;
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  isFree: boolean;
  priceTier: PriceTier;
  conservativeSingleCallEstimateUsd: string;
  supportsStructuredOutput: boolean;
};

// Section 34: "follow ADR policy for ABOVE_PREMIUM exactly" -- ABOVE_PREMIUM
// technically satisfies the hard ceiling but must not automatically appear
// as a normal recommended choice without a separate later product
// decision. This endpoint therefore never returns a route this ceiling
// can't already justify (HARD_BLOCK is excluded entirely, matching
// "ineligible"), but does not withhold ABOVE_PREMIUM from the response --
// it is returned, correctly labelled, so the (future) UI can make the
// separate decision about how prominently to surface it, rather than the
// API silently deciding for it.
export async function listEligibleModels(
  provider: OpenRouterProvider
): Promise<EligibleModel[]> {
  const models = await provider.listModels();
  const estimatedInputTokens = worstCaseInputTokens();
  const observedAt = new Date().toISOString();
  const results: EligibleModel[] = [];

  for (const model of models) {
    const separatorIndex = model.id.indexOf("/");
    const author = separatorIndex === -1 ? model.id : model.id.slice(0, separatorIndex);
    const slug = separatorIndex === -1 ? "" : model.id.slice(separatorIndex + 1);

    let endpoints;

    try {
      endpoints = await provider.listEndpoints(author, slug);
    } catch {
      continue;
    }

    const resolution = resolveModelRoute({
      configuredModelId: model.id,
      models,
      endpoints,
      role: "ADVOCATE",
      estimatedInputTokens,
      outputCapTokens: ADVOCATE_OUTPUT_CAP_TOKENS,
      observedAt
    });

    if (!resolution.eligible) {
      continue;
    }

    const { route } = resolution;
    const attemptCostUsd = computeCandidateAttemptCostUsd(
      route.pricing,
      estimatedInputTokens,
      ADVOCATE_OUTPUT_CAP_TOKENS
    );
    const priceTier = classifyPriceTier(attemptCostUsd);

    if (priceTier === "HARD_BLOCK") {
      continue;
    }

    results.push({
      id: route.configuredModelId,
      canonicalModelId: route.canonicalModelId,
      name: model.name ?? route.canonicalModelId,
      providerName: route.providerDisplayName,
      contextLength: route.contextLength,
      promptPricePerMillion: toDecimalString(route.pricing.promptPricePerMillion),
      completionPricePerMillion: toDecimalString(route.pricing.completionPricePerMillion),
      isFree: priceTier === "FREE",
      priceTier,
      conservativeSingleCallEstimateUsd: toDecimalString(attemptCostUsd),
      supportsStructuredOutput: route.supportedParameters.includes("response_format")
    });
  }

  return results;
}

// Re-exported for callers that only need the fixed threshold constants
// alongside the discovery list (e.g. a future UI tier legend).
export { TIER_THRESHOLDS_USD };
