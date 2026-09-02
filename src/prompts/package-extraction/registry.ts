// Milestone 7A -- versioned, immutable historical package-extraction
// prompt registry (ADR 0004 Decision 7, corrected in the sixth planning
// pass). The sole resolution point for "what was package-extraction-vN's
// exact prompt text" -- no external call site imports a specific vN
// module directly. A future v2 is added here additively; v1's module is
// never edited in place once it has been used by an accepted logical
// extraction.
//
// Unlike M7's advocate/judge prompts (one mutable current builder each,
// src/prompts/advocate-system.ts / judge-system.ts), a Tribunal
// participant's one permitted retry happens within the same request
// against the one running deployment -- no deployment-drift window. M7A's
// retry is a separate, later, explicit HTTP call that can arrive after an
// intervening deployment (ADR Decision 15's frozen-identity rule) -- a
// single mutable file cannot answer "what was v1's text" once rewritten
// for v2, so this registry exists specifically to make that question
// always answerable.

import { PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1 } from "./v1";
import { PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2 } from "./v2";

export type PackageExtractionPromptBuilder = () => string;

// PRO/CON semantic correction (Issue #30): package-extraction-v2 added
// additively -- v1's entry/resolution is unchanged, so every existing
// v1-stamped extraction record continues to replay against the exact
// v1 text it always has.
const PACKAGE_EXTRACTION_PROMPT_REGISTRY: Readonly<
  Record<string, PackageExtractionPromptBuilder>
> = Object.freeze({
  "package-extraction-v1": () => PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1,
  "package-extraction-v2": () => PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2
});

// Returns the exact historical prompt builder for `version`, or
// `undefined` if that version cannot be resolved -- callers (the retry
// path, Decision 7) MUST fail closed (`PROMPT_VERSION_UNAVAILABLE`,
// Decision 16) on `undefined` rather than falling back to the current
// version. Never throws -- an unresolvable version is an ordinary,
// expected outcome this function's return type already models, not an
// exceptional one.
export function getPackageExtractionPrompt(
  version: string
): PackageExtractionPromptBuilder | undefined {
  return PACKAGE_EXTRACTION_PROMPT_REGISTRY[version];
}

export function isKnownPackageExtractionPromptVersion(version: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    PACKAGE_EXTRACTION_PROMPT_REGISTRY,
    version
  );
}
