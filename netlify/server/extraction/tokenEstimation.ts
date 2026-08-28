// Milestone 7A -- deterministic, tokenizer-independent input-token
// estimate for the extraction call (ADR 0004 Decisions 9, 11). Mirrors
// M7's tokenEstimation.ts exactly: UTF-8 byte length, the same
// `Math.ceil(bytes / 2)` conservative-token proxy, never a real
// tokenizer/LLM call.

import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../../../src/prompts/versions";
import { getPackageExtractionPrompt } from "../../../src/prompts/package-extraction/registry";

// Implementation-time decision D (Issue #15): computed from the real
// package-extraction-v1 prompt's exact UTF-8 byte length -- never
// guessed. Resolved through the registry (registry.ts is the sole
// import point for v1.ts's actual text, ADR Decision 7) rather than
// importing v1.ts directly. If the prompt text ever changes (which
// would itself require a new v2 version -- v1 is immutable), this
// constant is recomputed by the same formula the drift test re-verifies.
const currentPromptBuilder = getPackageExtractionPrompt(PACKAGE_EXTRACTION_PROMPT_VERSION);

if (!currentPromptBuilder) {
  throw new Error(
    `PACKAGE_EXTRACTION_PROMPT_VERSION ("${PACKAGE_EXTRACTION_PROMPT_VERSION}") is not resolvable in the registry.`
  );
}

export const EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS = Math.ceil(
  new TextEncoder().encode(currentPromptBuilder()).length / 2
);

export function estimateExtractionInputTokens(normalizedDossierText: string): number {
  const byteLength = new TextEncoder().encode(normalizedDossierText).length;

  return Math.ceil(byteLength / 2) + EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS;
}

// Worst-case input estimate for the read-only preflight quote and the
// authoritative pre-spend guard: the maximum-length normalized dossier
// (NORMALIZED_DOSSIER_TEXT_MAX_CHARS, filled with the same worst-case
// 3-bytes/UTF-16-code-unit character M7's own worst-case estimator uses
// for the identical reason -- see tokenEstimation.ts's WORST_CASE_CHAR
// rationale) plus the fixed prompt overhead above.
const WORST_CASE_CHAR = "漢"; // "漢" -- 1 UTF-16 code unit, 3 UTF-8 bytes

export function worstCaseExtractionInputTokens(
  normalizedDossierTextMaxChars: number
): number {
  return estimateExtractionInputTokens(
    WORST_CASE_CHAR.repeat(normalizedDossierTextMaxChars)
  );
}
