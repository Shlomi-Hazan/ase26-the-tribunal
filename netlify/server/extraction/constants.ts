// Milestone 7A -- all locked numeric/monetary extraction constants (ADR
// 0004 Decisions 3, 8, 9, 11, 13, 19). Kept in one module, mirroring M7's
// economicsConstants.ts, so every consumer references the exact same
// value -- never a locally re-declared copy.

import Decimal from "decimal.js";

// ---------------------------------------------------------------------
// Input contract (Decision 3).
// ---------------------------------------------------------------------

export const SMART_EXTRACTION_TEXT_MAX_RAW_BYTES = 256 * 1024; // .txt/.md
export const SMART_EXTRACTION_PDF_MAX_RAW_BYTES = 4 * 1024 * 1024; // 4 MiB
export const NORMALIZED_DOSSIER_TEXT_MAX_CHARS = 40_000;

// Implementation-time decision B (Issue #15): generous bound on any
// realistic Tribunal dossier while keeping worst-case PDF processing
// bounded. If the page cap is reached before the document ends, the
// extraction is treated as incomplete (INPUT_TOO_LARGE_FOR_MODEL) --
// never silently returned as if it were the complete text.
export const PACKAGE_EXTRACTION_PDF_MAX_PAGES = 200;

// ---------------------------------------------------------------------
// One logical call, retry, timeout (Decision 8).
// ---------------------------------------------------------------------

export const PACKAGE_EXTRACTION_PROVIDER_TIMEOUT_MS = 45_000;
export const PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS = 55_000;
export const PACKAGE_EXTRACTION_MIN_PROVIDER_WINDOW_MS = 5_000;
export const MAX_PACKAGE_EXTRACTION_ATTEMPTS_PER_LOGICAL_CALL = 2;

// ---------------------------------------------------------------------
// Economics (Decision 9).
// ---------------------------------------------------------------------

export const EXTRACTION_HARD_CEILING_USD = new Decimal("0.50");
export const EXTRACTION_BUDGET_SAFETY_FACTOR = new Decimal("1.10");

// ---------------------------------------------------------------------
// Token / context bound (Decision 11).
// ---------------------------------------------------------------------

export const EXTRACTION_OUTPUT_CAP_TOKENS = 65_000;

// ---------------------------------------------------------------------
// Persistence / stale-claim reconciliation (Decision 13).
// ---------------------------------------------------------------------

export const STALE_EXTRACTION_CLAIM_AFTER_MS = 120_000;

// ---------------------------------------------------------------------
// Rate limiting / admission control (Decision 19, SECURITY.md Sec 10).
// Implementation-time thresholds for the two operationally-bounded (but
// not billable-start) endpoints, chosen as looser than the 3-per-180s
// new-start limit per the ADR's explicit allowance -- both loose enough
// not to interfere with a normal single-user retry/preflight flow, both
// still bounded (never unlimited).
// ---------------------------------------------------------------------

export const EXTRACTION_NEW_START_RATE_LIMIT = {
  maxAcceptedRequests: 3,
  windowMs: 180_000
} as const;

export const EXTRACTION_RETRY_RATE_LIMIT = {
  maxAcceptedRequests: 10,
  windowMs: 180_000
} as const;

export const EXTRACTION_PREFLIGHT_RATE_LIMIT = {
  maxAcceptedRequests: 20,
  windowMs: 180_000
} as const;
