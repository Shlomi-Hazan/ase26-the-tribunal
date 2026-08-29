// Milestone 7A -- canonical output-bound regression proof (ADR 0004
// Decision 11). Builds the true maximum schema-valid fixture, serializes
// it via native compact JSON.stringify, and asserts the canonical
// serialized shape fits EXTRACTION_OUTPUT_CAP_TOKENS using the exact
// same conservative bytes/2 estimator the rest of this codebase uses.
// Computed from the ACTUAL implementation -- never a hard-coded number.
//
// A companion test documents that provider lexical over-escaping (RFC
// 8259 permits arbitrary \uXXXX-escaping even when unnecessary) is
// explicitly NOT covered by this canonical-form proof -- the proof
// covers semantic representability, never every possible provider
// encoding.

import { describe, expect, it } from "vitest";
import {
  chargeSheetLimits,
  packageSeats,
  personalityLimit,
  profileNameLimit
} from "./tribunalSetup";
import {
  MAX_EXTRACTION_WARNINGS,
  packageExtractionSchema,
  type PackageExtractionResult
} from "./packageExtraction";

// The same worst-case-bytes-per-UTF-16-code-unit character M7's own
// worst-case estimators use (tokenEstimation.ts), for the identical
// reason: a lone BMP codepoint outside the surrogate range costs 3 UTF-8
// bytes per 1 UTF-16 code unit -- more than any surrogate-pair
// (supplementary-plane) character can cost per code unit.
const WORST_CASE_CHAR = "漢";

// Corrected this pass (independent pre-live audit, Section 10): every
// warning now uses UNSUPPORTED_CONTENT_IGNORED (field: null) rather than
// the longest field-path/code combination. The server-authoritative
// relational validation added this pass requires any OTHER warning code
// to reference a field whose actual value is null -- but the true
// maximum-BYTES fixture wants every one of the 17 free-text fields
// FILLED with worst-case text (non-null), which is only compatible with
// a warning code that references no field at all.
// UNSUPPORTED_CONTENT_IGNORED is exactly that: it does not reduce the
// fixture's field-text bytes at all (nothing is forced null to
// accommodate it), so this remains the genuine maximum, not an
// approximation of it.
function buildMaxFixture(): PackageExtractionResult {
  return {
    chargeSheet: {
      defendant: WORST_CASE_CHAR.repeat(chargeSheetLimits.defendant),
      act: WORST_CASE_CHAR.repeat(chargeSheetLimits.act),
      exactQuestion: WORST_CASE_CHAR.repeat(chargeSheetLimits.exactQuestion)
    },
    participants: Object.fromEntries(
      packageSeats.map((seat) => [
        seat,
        {
          profileName: WORST_CASE_CHAR.repeat(profileNameLimit),
          personality: WORST_CASE_CHAR.repeat(personalityLimit)
        }
      ])
    ) as PackageExtractionResult["participants"],
    warnings: Array.from({ length: MAX_EXTRACTION_WARNINGS }, () => ({
      code: "UNSUPPORTED_CONTENT_IGNORED" as const,
      field: null
    }))
  };
}

describe("canonical output-bound computation (Decision 11)", () => {
  it("the maximum schema-valid fixture is itself schema-valid", () => {
    const fixture = buildMaxFixture();
    const result = packageExtractionSchema.safeParse(fixture);

    expect(result.success).toBe(true);
  });

  it("the canonical compact serialization of the maximum fixture fits EXTRACTION_OUTPUT_CAP_TOKENS", () => {
    const fixture = buildMaxFixture();
    const json = JSON.stringify(fixture);
    const bytes = Buffer.byteLength(json, "utf8");
    const conservativeTokens = Math.ceil(bytes / 2);
    const EXTRACTION_OUTPUT_CAP_TOKENS = 65_000;

    // Reported, not asserted against a hard-coded expectation -- logged
    // so a real discrepancy is visible in CI output rather than silently
    // passing or silently failing. Corrected this pass (independent
    // pre-live audit, Section 10/19): the fixture's warnings now use
    // UNSUPPORTED_CONTENT_IGNORED (field: null) to stay compatible with
    // the newly added relational validation while still maximizing every
    // field's text bytes -- the real recomputed maximum is now
    // 110,604 bytes -> 55,302 conservative tokens (previously reported
    // as 111,884 -> 55,942 under a fixture that is no longer itself
    // schema-valid); still comfortably under the unchanged 65,000 cap,
    // so no approved contract value changes as a result.
    console.info(
      `[Decision 11 canonical output-bound] bytes=${bytes} conservativeTokens=${conservativeTokens} cap=${EXTRACTION_OUTPUT_CAP_TOKENS}`
    );

    expect(conservativeTokens).toBeLessThan(EXTRACTION_OUTPUT_CAP_TOKENS);
  });

  it("a semantically-identical value re-encoded with unnecessary \\uXXXX escaping is explicitly NOT claimed to fit any bound", () => {
    // RFC 8259 permits arbitrary \uXXXX escaping of any character, even
    // when unnecessary -- e.g. the same "漢" character could legally be
    // re-encoded as the 6-ASCII-character sequence 漢 instead of its
    // raw 3-byte UTF-8 form. This test proves the two encodings of an
    // otherwise-identical semantic value are NOT byte-equal, so a
    // provider choosing the inflated encoding is not covered by (and
    // never contradicts) the canonical-form proof above.
    const rawEncoding = JSON.stringify({ value: WORST_CASE_CHAR });
    const inflatedEncoding = JSON.stringify({ value: WORST_CASE_CHAR }).replace(
      WORST_CASE_CHAR,
      `\\u${WORST_CASE_CHAR.charCodeAt(0).toString(16).padStart(4, "0")}`
    );

    expect(Buffer.byteLength(inflatedEncoding, "utf8")).toBeGreaterThan(
      Buffer.byteLength(rawEncoding, "utf8")
    );
    // The proof above only ever serializes fixtures via native
    // JSON.stringify (the canonical compact form) -- it never asserts
    // anything about a provider's own chosen lexical encoding.
  });
});
