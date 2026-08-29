// Milestone 7A -- Smart Import shared constants/helpers (kept in their
// own module, not exported from SmartImportPage.tsx, so the page file
// only ever exports its component -- react-refresh/only-export-components
// otherwise flags a mixed component+value export file, matching every
// other page in src/pages/).

import Decimal from "decimal.js";
import type { ExtractionAttemptSummary } from "../services/extractionApi";

// Mirrors netlify/server/extraction/errors.ts's RETRYABLE_EXTRACTION_CODES
// exactly (server code cannot be imported into the client bundle -- see
// npm run verify:client-bundle). smartImport.test.tsx asserts this set
// stays byte-for-byte in sync so the two never silently drift apart.
export const RETRYABLE_ERROR_CODES = new Set([
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "INVALID_STRUCTURED_OUTPUT"
]);

// Corrected this pass (independent pre-live audit, Section 16): the
// existing TribunalSetupDraft provenance enum (sourceTypeSchema /
// personalitySourceSchema, src/schemas/tribunalSetup.ts) is enforced by
// hard CHECK constraints in ALREADY-APPLIED historical migrations
// (20260825000000_create_cases.sql, 20260825214212_participant_
// configuration.sql) -- adding a new "SMART_IMPORT" enum value would
// require altering those live constraints, out of scope for this pass.
// The existing TRIBUNAL_PACKAGE_FILE/tribunal_package values are reused
// as the interim technical mapping (documented in PR #16 / Issue #15),
// but this distinctive filename marker ensures the Review screen's
// existing "(filename)" detail text never lets that reuse read as a
// literal file upload -- see ReviewPage.tsx's formatSourceType/
// formatPersonalitySource, which render the source-type label
// unchanged, immediately followed by this marker in parentheses.
export const SMART_IMPORT_PROVENANCE_MARKER = "AI Smart Import — not a literal file";

// New this pass (second independent pre-live re-audit, Section 7): ADR
// 0004 Decision 9 requires a running cumulative total (attempt #1
// actual/conservative + attempt #2 estimate/actual) against the $0.50
// logical-call ceiling, visible before AND after Retry. The prior
// revision stored only the single most-recent `lastAttempt`, so
// attempt #1's own economics silently disappeared the moment attempt #2
// existed.

// Never fabricates a cost as zero when unknown (ADR requirement): an
// attempt that exists always has at least its conservative maximum as a
// real, non-zero bound, even when the actual cost is not yet known
// (e.g. the provider never returned usage telemetry).
export function attemptDebitUsd(attempt: ExtractionAttemptSummary | null): string | null {
  if (!attempt) {
    return null;
  }

  return attempt.actualCostUsd ?? attempt.conservativeMaxCostUsd;
}

export type CumulativeExtractionEconomics = {
  attempt1DebitUsd: string | null;
  attempt2DebitUsd: string | null;
  // true when attempt2DebitUsd is a PROJECTION (the quoted per-attempt
  // conservative maximum for a retry that has not been claimed/run yet)
  // rather than attempt #2's own real conservative/actual figure --
  // the UI must label this "potential," never present it as fact.
  attempt2IsPotential: boolean;
  cumulativeDebitUsd: string | null;
};

export function computeCumulativeExtractionEconomics(
  attemptOne: ExtractionAttemptSummary | null,
  attemptTwo: ExtractionAttemptSummary | null,
  quotedPerAttemptConservativeMaxCostUsd: string | null
): CumulativeExtractionEconomics {
  const attempt1DebitUsd = attemptDebitUsd(attemptOne);
  const realAttempt2DebitUsd = attemptDebitUsd(attemptTwo);
  const attempt2IsPotential = realAttempt2DebitUsd === null;
  const attempt2DebitUsd = realAttempt2DebitUsd ?? quotedPerAttemptConservativeMaxCostUsd;

  const cumulativeDebitUsd =
    attempt1DebitUsd !== null && attempt2DebitUsd !== null
      ? new Decimal(attempt1DebitUsd).plus(attempt2DebitUsd).toFixed()
      : attempt1DebitUsd;

  return {
    attempt1DebitUsd,
    attempt2DebitUsd,
    attempt2IsPotential: attempt2IsPotential && attempt2DebitUsd !== null,
    cumulativeDebitUsd
  };
}
