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

// Corrected this pass (independent review, pre-live micro-correction):
// the ONE canonical Charge Sheet serialization used by BOTH the real
// preflight estimator (preflight.ts) and the synthetic worst-case
// estimate below -- previously each wrote its own separate
// `[defendant, act, exactQuestion].join("\n")` literal, and the
// worst-case one drifted (it concatenated the three limits into a
// single run of characters with no separators at all). Two different,
// independently-written copies of the same serialization contract can
// silently diverge again the moment either is edited alone; this is the
// single source of truth for the field order and the two
// application-added "\n" separators between defendant/act/exactQuestion.
export type ChargeSheetTextParts = {
  defendant: string;
  act: string;
  exactQuestion: string;
};

export function serializeChargeSheetForModelContext(
  parts: ChargeSheetTextParts
): string {
  return [parts.defendant, parts.act, parts.exactQuestion].join("\n");
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

// Corrected this pass (independent review, pre-live micro-correction):
// the synthetic Charge Sheet is now three separately-filled fields
// (defendant/act/exactQuestion, each independently at its own limit),
// serialized through the exact same serializeChargeSheetForModelContext
// the real estimator uses -- so the two application-added "\n"
// separators between them are included in the byte count, matching what
// a real maximum-length Charge Sheet actually produces. The prior
// implementation concatenated the three limits into one run of
// characters with no separators at all, under-counting by the separator
// bytes.
function worstCaseChargeSheetText(): string {
  return serializeChargeSheetForModelContext({
    defendant: WORST_CASE_CHAR.repeat(chargeSheetLimits.defendant),
    act: WORST_CASE_CHAR.repeat(chargeSheetLimits.act),
    exactQuestion: WORST_CASE_CHAR.repeat(chargeSheetLimits.exactQuestion)
  });
}

function worstCasePersonalityText(): string {
  return WORST_CASE_CHAR.repeat(personalityLimit);
}

// Corrected this pass: the real preflight estimator passes
// `sideInstructions: side ?? ""`, and a real ADVOCATE participant's
// `side` is always "PRO" or "CON" (never the empty string) --
// SIDE_BY_PARTICIPANT_ID only ever maps advocate seats to one of those
// two values. The prior canonical bound used `sideInstructions: ""`,
// which is never what a real advocate estimate actually contains, and
// silently under-counted by those bytes. Computing both real variants
// and taking the max (rather than assuming they are byte-identical
// today) means a future wording change to only one side's prompt can
// never make this bound silently too small again.
export function worstCaseAdvocateInputTokens(): number {
  const chargeSheetText = worstCaseChargeSheetText();
  const personality = worstCasePersonalityText();

  const proEstimate = estimateAdvocateInputTokens({
    basePrompt: buildAdvocateSystemPrompt("PRO"),
    sideInstructions: "PRO",
    personality,
    chargeSheetText
  });
  const conEstimate = estimateAdvocateInputTokens({
    basePrompt: buildAdvocateSystemPrompt("CON"),
    sideInstructions: "CON",
    personality,
    chargeSheetText
  });

  return Math.max(proEstimate, conEstimate);
}

export function worstCaseJudgeInputTokens(): number {
  return estimateJudgeInputTokens({
    basePrompt: JUDGE_SYSTEM_PROMPT,
    personality: worstCasePersonalityText(),
    chargeSheetText: worstCaseChargeSheetText()
  });
}
