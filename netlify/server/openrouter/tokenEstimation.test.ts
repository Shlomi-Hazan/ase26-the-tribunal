import { describe, expect, it } from "vitest";
import {
  ADVOCATE_OUTPUT_CAP_TOKENS,
  estimateAdvocateInputTokens,
  estimateInputTokens,
  estimateJudgeInputTokens,
  FIXED_PROMPT_OVERHEAD_TOKENS,
  JUDGE_OUTPUT_CAP_TOKENS,
  RESERVED_ADVOCATE_SPEECHES_FOR_JUDGE
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
