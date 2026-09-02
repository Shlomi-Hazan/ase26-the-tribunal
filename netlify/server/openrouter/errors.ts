// Milestone 7 -- normalized provider error taxonomy (ADR Decision 11).
//
// M7 normalizes provider/transport failures into a stable category set.
// M7 does not retry (SPEC.md Sec 10.1's 1-retry-per-logical-call policy
// is M8 execution scope). Raw provider error detail (status text, response
// bodies, stack traces) is never exposed to the browser -- only the
// normalized category and a safe message.

export type ProviderErrorCategory =
  | "TIMEOUT"
  | "TRANSIENT_NETWORK"
  | "PROVIDER_5XX"
  | "RATE_LIMITED"
  | "AUTHENTICATION"
  | "INVALID_PROVIDER_REQUEST"
  | "INVALID_PROVIDER_RESPONSE"
  | "MODEL_INELIGIBLE"
  | "PRICING_UNAVAILABLE"
  | "PRICING_UNREPRESENTABLE"
  | "UNKNOWN";

// ADR Decision 4A adds ENDPOINT_NOT_PINNABLE; ADR Decisions 7A/7B expand
// PRICING_UNREPRESENTABLE's scope to cover non-empty pricing.overrides,
// malformed pricing.discount, and unclassifiable cache-pricing fields.
export type PreflightReasonCode =
  | "MODEL_NOT_FOUND"
  | "MODEL_ALIAS_NOT_PINNED"
  | "DYNAMIC_MODEL_UNSUPPORTED"
  | "ENDPOINT_UNAVAILABLE"
  | "ENDPOINT_NOT_PINNABLE"
  | "STRUCTURED_OUTPUT_UNSUPPORTED"
  | "BOUNDED_OUTPUT_UNSUPPORTED"
  // M8 reasoning-compatibility correction (Issue #17): the exact
  // endpoint advertises the unified `reasoning` request parameter, but
  // the MODEL's own reasoning metadata does not identify a safe M8 V1
  // effort value ("minimal" or "low") to send -- never conflated with
  // STRUCTURED_OUTPUT_UNSUPPORTED/BOUNDED_OUTPUT_UNSUPPORTED, which are
  // endpoint-capability gaps, not a model-reasoning-semantics gap.
  | "REASONING_CONTROL_UNSUPPORTED"
  | "CONTEXT_TOO_SMALL"
  | "PRICING_UNAVAILABLE"
  | "PRICING_UNREPRESENTABLE"
  | "BUDGET_EXCEEDED"
  | "PROMPT_VERSION_UNASSIGNED"
  // PRO/CON semantic correction (Issue #30): distinct from
  // PROMPT_VERSION_UNASSIGNED, which is reserved for the true pre-M7
  // placeholder (PROMPT_VERSION_PLACEHOLDER) only. A participant whose
  // promptVersion is assigned to some real, non-current value (an older
  // version, an unrecognized value, or anything else the eligibility
  // check alone cannot distinguish) is reported this neutral, honest
  // reason instead -- never "unassigned," which would be materially
  // false for a value that genuinely was assigned.
  | "PROMPT_VERSION_MISMATCH";

// Potentially retryable (subject to M8's budget guard also permitting the
// retry) vs. never retryable -- documented here for forward reference only;
// M7 does not implement retry execution (ADR Decision 11).
const RETRYABLE_CATEGORIES: ReadonlySet<ProviderErrorCategory> = new Set([
  "TIMEOUT",
  "TRANSIENT_NETWORK",
  "PROVIDER_5XX",
  "RATE_LIMITED"
]);

export function isPotentiallyRetryable(category: ProviderErrorCategory): boolean {
  return RETRYABLE_CATEGORIES.has(category);
}

export class ProviderError extends Error {
  readonly category: ProviderErrorCategory;

  constructor(category: ProviderErrorCategory, message: string) {
    super(message);
    this.name = "ProviderError";
    this.category = category;
  }
}

// Normalizes a fetch-layer failure (network error, non-2xx HTTP status, or
// a response body that fails schema validation) into a ProviderError. Never
// includes response body content in the thrown message -- callers that need
// safe diagnostic detail should log server-side only, never forward it to
// an HTTP response body.
export function normalizeHttpFailure(
  status: number | null,
  cause: "network" | "http" | "invalid_response" | "timeout"
): ProviderError {
  if (cause === "timeout") {
    return new ProviderError("TIMEOUT", "Provider request timed out.");
  }

  if (cause === "network") {
    return new ProviderError(
      "TRANSIENT_NETWORK",
      "Provider request failed due to a transient network error."
    );
  }

  if (cause === "invalid_response") {
    return new ProviderError(
      "INVALID_PROVIDER_RESPONSE",
      "Provider response failed schema validation."
    );
  }

  if (status === 401 || status === 403) {
    return new ProviderError(
      "AUTHENTICATION",
      "Provider request was not authenticated."
    );
  }

  if (status === 429) {
    return new ProviderError("RATE_LIMITED", "Provider rate limit exceeded.");
  }

  if (status !== null && status >= 500) {
    return new ProviderError(
      "PROVIDER_5XX",
      "Provider returned a server error."
    );
  }

  if (status !== null && status >= 400) {
    return new ProviderError(
      "INVALID_PROVIDER_REQUEST",
      "Provider rejected the request as invalid."
    );
  }

  return new ProviderError("UNKNOWN", "Provider request failed.");
}
