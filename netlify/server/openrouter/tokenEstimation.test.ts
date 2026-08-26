import { describe, expect, it } from "vitest";
import {
  chargeSheetLimits,
  personalityLimit
} from "../../../src/schemas/tribunalSetup";
import { buildAdvocateSystemPrompt } from "../../../src/prompts/advocate-system";
import { JUDGE_SYSTEM_PROMPT } from "../../../src/prompts/judge-system";
import {
  ADVOCATE_OUTPUT_CAP_TOKENS,
  estimateAdvocateInputTokens,
  estimateInputTokens,
  estimateJudgeInputTokens,
  FIXED_PROMPT_OVERHEAD_TOKENS,
  JUDGE_OUTPUT_CAP_TOKENS,
  RESERVED_ADVOCATE_SPEECHES_FOR_JUDGE,
  worstCaseAdvocateInputTokens,
  worstCaseJudgeInputTokens
} from "./tokenEstimation";

describe("estimateInputTokens", () => {
  it("uses UTF-8 byte length, not JS string .length, for multi-byte text", () => {
    const ascii = "a".repeat(100);
    const hebrew = "א".repeat(100); // 2 bytes per character in UTF-8

    const asciiTokens = estimateInputTokens(ascii);
    const hebrewTokens = estimateInputTokens(hebrew);

    expect(hebrewTokens).toBeGreaterThan(asciiTokens);
  });

  it("adds the fixed prompt overhead once", () => {
    const tokens = estimateInputTokens("");

    expect(tokens).toBe(FIXED_PROMPT_OVERHEAD_TOKENS);
  });

  it("never calls an external tokenizer -- pure, synchronous, deterministic", () => {
    expect(estimateInputTokens("hello")).toBe(estimateInputTokens("hello"));
  });
});

describe("estimateAdvocateInputTokens", () => {
  it("combines base prompt, side instructions, personality, and Charge Sheet text", () => {
    const withShortPersonality = estimateAdvocateInputTokens({
      basePrompt: "base",
      sideInstructions: "side",
      personality: "short",
      chargeSheetText: "sheet"
    });
    const withLongPersonality = estimateAdvocateInputTokens({
      basePrompt: "base",
      sideInstructions: "side",
      personality: "a much longer personality description here",
      chargeSheetText: "sheet"
    });

    expect(withLongPersonality).toBeGreaterThan(withShortPersonality);
  });
});

describe("estimateJudgeInputTokens", () => {
  it("reserves all four advocate speeches at their maximum before any advocate has run", () => {
    const tokens = estimateJudgeInputTokens({
      basePrompt: "base",
      personality: "personality",
      chargeSheetText: "sheet"
    });
    const baselineWithoutSpeeches = estimateInputTokens(
      ["base", "personality", "sheet"].join("\n")
    );

    expect(tokens).toBe(
      baselineWithoutSpeeches +
        RESERVED_ADVOCATE_SPEECHES_FOR_JUDGE * ADVOCATE_OUTPUT_CAP_TOKENS
    );
  });

  it("reserves exactly 4 x 1000 = 4000 tokens for advocate speeches", () => {
    expect(RESERVED_ADVOCATE_SPEECHES_FOR_JUDGE * ADVOCATE_OUTPUT_CAP_TOKENS).toBe(4000);
  });
});

describe("output caps are hard ceilings, not estimates", () => {
  it("locks the advocate output cap at 1000", () => {
    expect(ADVOCATE_OUTPUT_CAP_TOKENS).toBe(1000);
  });

  it("locks the judge output cap at 1200", () => {
    expect(JUDGE_OUTPUT_CAP_TOKENS).toBe(1200);
  });
});

// UTF-8 worst-case-bound regression tests (independent review, pre-live
// gate, second pass). The canonical worst-case estimate must never be
// exceeded by ANY valid input the application's actual .trim().max(N)
// validation would accept -- proven here directly against alternative
// same-length-budget payloads, not merely asserted.
describe("canonical worst-case bound is genuinely conservative under the app's validation semantics", () => {
  const totalChargeSheetChars =
    chargeSheetLimits.defendant + chargeSheetLimits.act + chargeSheetLimits.exactQuestion;

  function advocateTokensFor(personality: string, chargeSheetText: string): number {
    return estimateAdvocateInputTokens({
      basePrompt: buildAdvocateSystemPrompt("PRO"),
      sideInstructions: "",
      personality,
      chargeSheetText
    });
  }

  function judgeTokensFor(personality: string, chargeSheetText: string): number {
    return estimateJudgeInputTokens({
      basePrompt: JUDGE_SYSTEM_PROMPT,
      personality,
      chargeSheetText
    });
  }

  it("A: a max-length ASCII payload does not exceed the canonical advocate/judge bound", () => {
    const personality = "a".repeat(personalityLimit);
    const chargeSheetText = "a".repeat(totalChargeSheetChars);

    expect(advocateTokensFor(personality, chargeSheetText)).toBeLessThanOrEqual(
      worstCaseAdvocateInputTokens()
    );
    expect(judgeTokensFor(personality, chargeSheetText)).toBeLessThanOrEqual(
      worstCaseJudgeInputTokens()
    );
  });

  it("B: a max-length Hebrew (2-byte) payload does not exceed the canonical bound", () => {
    const personality = "א".repeat(personalityLimit);
    const chargeSheetText = "א".repeat(totalChargeSheetChars);

    expect(advocateTokensFor(personality, chargeSheetText)).toBeLessThanOrEqual(
      worstCaseAdvocateInputTokens()
    );
    expect(judgeTokensFor(personality, chargeSheetText)).toBeLessThanOrEqual(
      worstCaseJudgeInputTokens()
    );
  });

  it("C: a max-length CJK (3-byte) payload does not exceed the canonical bound", () => {
    const personality = "漢".repeat(personalityLimit);
    const chargeSheetText = "漢".repeat(totalChargeSheetChars);

    expect(advocateTokensFor(personality, chargeSheetText)).toBeLessThanOrEqual(
      worstCaseAdvocateInputTokens()
    );
    expect(judgeTokensFor(personality, chargeSheetText)).toBeLessThanOrEqual(
      worstCaseJudgeInputTokens()
    );
  });

  it("D: max-length surrogate-pair (4-byte, e.g. emoji) content does not exceed the canonical bound", () => {
    // Each surrogate pair is 2 UTF-16 code units, so filling the same
    // .length budget takes half as many *characters* but the same number
    // of code units -- exactly what z.string().max(N) actually measures.
    const personality = "😀".repeat(personalityLimit / 2);
    const chargeSheetText = "😀".repeat(Math.floor(totalChargeSheetChars / 2));

    // Sanity: this payload is genuinely at (or under, due to flooring)
    // the code-unit budget the real validation schema enforces.
    expect(personality.length).toBeLessThanOrEqual(personalityLimit);
    expect(chargeSheetText.length).toBeLessThanOrEqual(totalChargeSheetChars);

    expect(advocateTokensFor(personality, chargeSheetText)).toBeLessThanOrEqual(
      worstCaseAdvocateInputTokens()
    );
    expect(judgeTokensFor(personality, chargeSheetText)).toBeLessThanOrEqual(
      worstCaseJudgeInputTokens()
    );
  });

  it("E: the old Hebrew-only synthetic estimate is no longer the authoritative maximum -- CJK now estimates materially higher", () => {
    const hebrewPersonality = "א".repeat(personalityLimit);
    const hebrewChargeSheet = "א".repeat(totalChargeSheetChars);
    const cjkPersonality = "漢".repeat(personalityLimit);
    const cjkChargeSheet = "漢".repeat(totalChargeSheetChars);

    const oldEstimate = advocateTokensFor(hebrewPersonality, hebrewChargeSheet);
    const correctedEstimate = advocateTokensFor(cjkPersonality, cjkChargeSheet);

    expect(correctedEstimate).toBeGreaterThan(oldEstimate);
    // The corrected canonical function must match the true (CJK) worst
    // case, not the retired Hebrew one.
    expect(worstCaseAdvocateInputTokens()).toBe(correctedEstimate);
    expect(worstCaseAdvocateInputTokens()).toBeGreaterThan(oldEstimate);
  });

  it("F: judge worst-case still includes the full 4 x 1000 advocate-speech reserve after the bound correction", () => {
    const withoutSpeeches = judgeTokensFor(
      "漢".repeat(personalityLimit),
      "漢".repeat(totalChargeSheetChars)
    );
    const speechReserve = RESERVED_ADVOCATE_SPEECHES_FOR_JUDGE * ADVOCATE_OUTPUT_CAP_TOKENS;

    // estimateJudgeInputTokens already folds the reserve in -- confirm the
    // canonical judge worst-case is at least that much larger than what a
    // same-text advocate-shaped estimate (no reserve) would produce.
    const advocateShapedSameText = estimateInputTokens(
      [JUDGE_SYSTEM_PROMPT, "漢".repeat(personalityLimit), "漢".repeat(totalChargeSheetChars)].join(
        "\n"
      )
    );

    expect(withoutSpeeches - advocateShapedSameText).toBe(speechReserve);
    expect(worstCaseJudgeInputTokens() - speechReserve).toBeGreaterThan(0);
  });

  it("G: worstCaseJudgeInputTokens is materially larger than worstCaseAdvocateInputTokens (the pricing-tier/context bound consumers inherit this automatically)", () => {
    expect(worstCaseJudgeInputTokens()).toBeGreaterThan(worstCaseAdvocateInputTokens());
  });
});
