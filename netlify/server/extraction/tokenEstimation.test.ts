// Milestone 7A -- extraction token-estimation tests (ADR 0004 Decisions
// 9, 11; implementation-time decision D, Issue #15).

import { describe, expect, it } from "vitest";
import { PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1 } from "../../../src/prompts/package-extraction/v1";
import {
  EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS,
  estimateExtractionInputTokens,
  worstCaseExtractionInputTokens
} from "./tokenEstimation";
import { NORMALIZED_DOSSIER_TEXT_MAX_CHARS } from "./constants";

describe("EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS", () => {
  it("is computed from the real v1 prompt's exact UTF-8 byte length, not guessed", () => {
    const expected = Math.ceil(
      new TextEncoder().encode(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1).length / 2
    );

    expect(EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS).toBe(expected);
    expect(EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS).toBeGreaterThan(0);
  });
});

describe("estimateExtractionInputTokens", () => {
  it("adds the fixed prompt overhead to the dossier's own conservative token estimate", () => {
    const dossier = "a".repeat(100);
    const expected = Math.ceil(new TextEncoder().encode(dossier).length / 2) +
      EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS;

    expect(estimateExtractionInputTokens(dossier)).toBe(expected);
  });
});

describe("worstCaseExtractionInputTokens", () => {
  it("bounds the real preflight/authoritative estimate for any dossier at the max length", () => {
    const worstCase = worstCaseExtractionInputTokens(NORMALIZED_DOSSIER_TEXT_MAX_CHARS);
    const realEstimateAtMaxAsciiLength = estimateExtractionInputTokens(
      "a".repeat(NORMALIZED_DOSSIER_TEXT_MAX_CHARS)
    );

    expect(worstCase).toBeGreaterThanOrEqual(realEstimateAtMaxAsciiLength);
  });
});
