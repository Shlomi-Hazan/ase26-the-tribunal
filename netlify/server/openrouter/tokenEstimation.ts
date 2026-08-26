// Milestone 7 -- deterministic, tokenizer-independent input-token estimate
// (docs/economics.md Sec 10.1). Never calls an LLM/tokenizer API. Uses
// UTF-8 byte length, not JS string `.length` (which counts UTF-16 code
// units and would understate multi-byte text such as Hebrew).

import {
  chargeSheetLimits,
  personalityLimit
} from "../../../src/schemas/tribunalSetup";
import { buildAdvocateSystemPrompt } from "../../../src/prompts/advocate-system";
import { JUDGE_SYSTEM_PROMPT } from "../../../src/prompts/judge-system";

// Not a locked SPEC/ADR numeric value -- a conservative, documented
// implementation constant covering the fixed instruction/formatting text
// every request necessarily carries beyond its variable content (role
// markers, JSON-schema scaffolding, etc). Deliberately generous; safe to
// revise upward later if real usage ever shows it too small, since a
// preflight bound only needs to be conservative, never exact.
export const FIXED_PROMPT_OVERHEAD_TOKENS = 50;

export const ADVOCATE_OUTPUT_CAP_TOKENS = 1000;
export const JUDGE_OUTPUT_CAP_TOKENS = 1200;

// Judge preflight must reserve for all four advocate speeches at their
// maximum, before any advocate has run (docs/economics.md Sec 10.3).
export const RESERVED_ADVOCATE_SPEECHES_FOR_JUDGE = 4;

export function estimateInputTokens(text: string): number {
  const byteLength = new TextEncoder().encode(text).length;

  return Math.ceil(byteLength / 2) + FIXED_PROMPT_OVERHEAD_TOKENS;
}

export type AdvocateInputParts = {
  basePrompt: string;
  sideInstructions: string;
  personality: string;
  chargeSheetText: string;
};

// Advocate bound (Section 20): base prompt + side/role instructions +
// personality + Charge Sheet + other fixed request text, output cap 1000
// (applied by the caller as a separate output-side cost, not folded into
// this input-token count).
export function estimateAdvocateInputTokens(parts: AdvocateInputParts): number {
  return estimateInputTokens(
    [parts.basePrompt, parts.sideInstructions, parts.personality, parts.chargeSheetText].join(
      "\n"
    )
  );
}

export type JudgeInputParts = {
  basePrompt: string;
  personality: string;
  chargeSheetText: string;
};

// Judge bound (Section 20): base prompt + personality + Charge Sheet +
// up to 4 x 1000 advocate output tokens as downstream input exposure +
// output cap 1200 (applied separately by the caller).
export function estimateJudgeInputTokens(parts: JudgeInputParts): number {
  const baseTokens = estimateInputTokens(
    [parts.basePrompt, parts.personality, parts.chargeSheetText].join("\n")
  );
  const speechReserve =
    RESERVED_ADVOCATE_SPEECHES_FOR_JUDGE * ADVOCATE_OUTPUT_CAP_TOKENS;

  return baseTokens + speechReserve;
}

export function outputCapTokensForRole(role: "ADVOCATE" | "JUDGE"): number {
  return role === "ADVOCATE" ? ADVOCATE_OUTPUT_CAP_TOKENS : JUDGE_OUTPUT_CAP_TOKENS;
}

// ---------------------------------------------------------------------
// Canonical worst-case input estimates (independent review, pre-live
// gate; moved here from modelDiscovery.ts so routeTierEconomics.ts can
// share the exact same primitives for both GET /api/models and
// preflight's per-participant route-discovery tier -- Sections 8-11).
//
// These are deliberately independent of any specific frozen run's real
// case/personality text: the route DISCOVERY tier is a reusable category
// of "how expensive would the complete fixed Tribunal shape be on this
// exact resolved route," not a measurement of one particular run's
// actual content -- so it must always evaluate to the same figure for
// the same route, regardless of which participant or context asks.
// Real per-participant economics (this run's actual
// conservativeParticipantCostUsd / conservativeMaxCostUsd) are computed
// separately in preflight.ts from the real Charge Sheet/personality text.
//
// Corrected this pass (independent review, pre-live gate): the prior
// character here ("א", Hebrew, U+05D0) is only 2 UTF-8 bytes and is NOT
// the true worst case for this application's actual validation
// semantics -- it under-estimated context/cost exposure.
//
// The authoritative length constraints (chargeSheetLimits,
// personalityLimit, applied via `z.string().trim().max(N)` in
// src/schemas/tribunalSetup.ts, confirmed by direct source inspection --
// no `.normalize()` call anywhere in that file) bound JS
// `String.prototype.length`, i.e. UTF-16 CODE UNITS, not Unicode
// codepoints and not UTF-8 bytes. The worst case is therefore whichever
// valid string maximizes UTF-8 bytes PER CODE UNIT, filled to the full
// code-unit budget N:
//
//   - a lone BMP codepoint in U+0800..U+FFFF, excluding the surrogate
//     range U+D800..U+DFFF (e.g. CJK Unified Ideographs) -- 1 code unit,
//     3 UTF-8 bytes -- 3 bytes/unit.
//   - a surrogate PAIR (a supplementary-plane codepoint, U+10000+, e.g.
//     an emoji) -- 2 code units, 4 UTF-8 bytes total -- only 2
//     bytes/unit, LESS than the 3-byte BMP case above.
//   - an unpaired/lone surrogate (malformed input) -- 1 code unit;
//     TextEncoder replaces it with U+FFFD, which is also 3 bytes -- at
//     most 3 bytes/unit, never more.
//
// So 3 bytes/code-unit is the true maximum achievable under this
// application's exact validation semantics, and no 4-byte
// (surrogate-pair) content can ever exceed it -- verified empirically in
// tokenEstimation.test.ts (e.g. "漢" = 1 code unit = 3 UTF-8 bytes;
// "😀" = 2 code units = 4 UTF-8 bytes = 2/unit; the old "א" = 1 code unit
// = 2 UTF-8 bytes = 2/unit). Filling the entire allowed code-unit budget
// with a 3-byte BMP character (never leading/trailing whitespace, so
// `.trim()` does not reduce it) therefore yields the largest UTF-8 byte
// count any valid accepted input of that length could produce.
// ---------------------------------------------------------------------

const WORST_CASE_CHAR = "漢"; // U+6F22 -- 1 UTF-16 code unit, 3 UTF-8 bytes

function worstCaseChargeSheetText(): string {
  const totalChars =
    chargeSheetLimits.defendant + chargeSheetLimits.act + chargeSheetLimits.exactQuestion;

  return WORST_CASE_CHAR.repeat(totalChars);
}

function worstCasePersonalityText(): string {
  return WORST_CASE_CHAR.repeat(personalityLimit);
}

export function worstCaseAdvocateInputTokens(): number {
  return estimateAdvocateInputTokens({
    basePrompt: buildAdvocateSystemPrompt("PRO"),
    sideInstructions: "",
    personality: worstCasePersonalityText(),
    chargeSheetText: worstCaseChargeSheetText()
  });
}

export function worstCaseJudgeInputTokens(): number {
  return estimateJudgeInputTokens({
    basePrompt: JUDGE_SYSTEM_PROMPT,
    personality: worstCasePersonalityText(),
    chargeSheetText: worstCaseChargeSheetText()
  });
}
