// Milestone 7A -- stable extraction error taxonomy (ADR 0004 Decision
// 16). Hard failures (no draft produced), successful-needs-review
// outcomes, and the audit-only UNKNOWN_OUTCOME terminal state are kept
// as three distinct categories, mirroring the ADR's own structure.

export const EXTRACTION_HARD_FAILURE_CODES = [
  "INPUT_INVALID",
  "UNSUPPORTED_FILE_TYPE",
  "FILE_TOO_LARGE",
  "PDF_TEXT_UNAVAILABLE",
  "PDF_ENCRYPTED_OR_INVALID",
  "NORMALIZED_TEXT_EMPTY",
  "INPUT_TOO_LARGE_FOR_MODEL",
  "MODEL_NOT_ELIGIBLE",
  "PRICING_UNAVAILABLE",
  "BLOCKED_BUDGET",
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "INVALID_STRUCTURED_OUTPUT",
  "IDEMPOTENCY_CONFLICT",
  "INPUT_PROCESSING_TIMEOUT",
  "RATE_LIMITED",
  "PROMPT_VERSION_UNAVAILABLE"
] as const;

export type ExtractionHardFailureCode = (typeof EXTRACTION_HARD_FAILURE_CODES)[number];

// Audit-only terminal state, distinct from every hard-failure code above
// (Decision 13): "the application lost authoritative knowledge of a
// specific provider attempt after claiming it," never a definite,
// directly-observed outcome.
export const UNKNOWN_OUTCOME = "UNKNOWN_OUTCOME" as const;

export type ExtractionAttemptStatus =
  | "CLAIMED"
  | ExtractionHardFailureCode
  | "SUCCESS"
  | "EXTRACTION_INCOMPLETE"
  | "EXTRACTION_AMBIGUOUS"
  | typeof UNKNOWN_OUTCOME;

export class ExtractionError extends Error {
  readonly code: ExtractionHardFailureCode;

  constructor(code: ExtractionHardFailureCode, message: string) {
    super(message);
    this.name = "ExtractionError";
    this.code = code;
  }
}

// Categories that legitimately permit a second provider attempt if the
// retry-budget guard still passes (mirrors M7's RETRYABLE_CATEGORIES
// concept, but scoped to the app-level extraction codes rather than the
// lower-level ProviderErrorCategory).
const RETRYABLE_EXTRACTION_CODES: ReadonlySet<ExtractionHardFailureCode> = new Set([
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "INVALID_STRUCTURED_OUTPUT"
]);

export function isRetryableExtractionFailure(code: ExtractionHardFailureCode): boolean {
  return RETRYABLE_EXTRACTION_CODES.has(code);
}
