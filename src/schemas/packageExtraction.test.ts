// Milestone 7A -- structured extraction schema tests (ADR 0004 Decisions
// 5, 6, 11), including the server-authoritative relational/null semantic
// validation added during the independent pre-live audit (Section 10).

import { describe, expect, it } from "vitest";
import {
  chargeSheetLimits,
  packageSeats,
  personalityLimit,
  type PackageSeat
} from "./tribunalSetup";
import {
  deriveExtractionStatus,
  extractionFieldPathSchema,
  extractionWarningSchema,
  MAX_EXTRACTION_WARNINGS,
  packageExtractionJsonSchema,
  packageExtractionSchema,
  safeExtractionText,
  type ExtractionWarning,
  type PackageExtractionResult
} from "./packageExtraction";

const REQUIRED_NULL_FIELD_WARNINGS: ExtractionWarning[] = [
  { code: "MISSING_FIELD", field: "chargeSheet.defendant" },
  { code: "MISSING_FIELD", field: "chargeSheet.act" },
  { code: "MISSING_FIELD", field: "chargeSheet.exactQuestion" },
  ...packageSeats.map(
    (seat): ExtractionWarning => ({
      code: "MISSING_FIELD",
      field: `participants.${seat}.personality`
    })
  )
];

// A schema-valid, fully-null draft -- every required field (Charge
// Sheet act/exactQuestion + every seat's personality) carries the
// explaining warning the relational validation now requires; every
// optional profileName stays null with no warning, which is allowed.
function emptyDraft(): PackageExtractionResult {
  return {
    chargeSheet: { defendant: null, act: null, exactQuestion: null },
    participants: Object.fromEntries(
      packageSeats.map((seat) => [seat, { profileName: null, personality: null }])
    ) as PackageExtractionResult["participants"],
    warnings: REQUIRED_NULL_FIELD_WARNINGS
  };
}

// A fully-populated, zero-warning draft -- used to isolate assertions
// (e.g. deriveExtractionStatus) from the required-field-null-needs-
// warning rule entirely.
function fullyPopulatedDraft(): PackageExtractionResult {
  return {
    chargeSheet: {
      defendant: "The Accused",
      act: "Did the thing.",
      exactQuestion: "Did they do the thing?"
    },
    participants: Object.fromEntries(
      packageSeats.map((seat) => [
        seat,
        { profileName: null, personality: `${seat} personality.` }
      ])
    ) as PackageExtractionResult["participants"],
    warnings: []
  };
}

describe("safeExtractionText boundary behavior", () => {
  const schema = safeExtractionText(20);

  it("allows tab and newline", () => {
    expect(schema.safeParse("a\tb\nc").success).toBe(true);
  });

  it("rejects a bare carriage return", () => {
    expect(schema.safeParse("a\rb").success).toBe(false);
  });

  it("rejects NUL", () => {
    expect(schema.safeParse("a\x00b").success).toBe(false);
  });

  it("rejects DEL", () => {
    expect(schema.safeParse("a\x7fb").success).toBe(false);
  });

  it("allows CJK", () => {
    expect(schema.safeParse("漢字").success).toBe(true);
  });

  it("allows a valid surrogate pair (emoji)", () => {
    expect(schema.safeParse("😀").success).toBe(true);
  });

  it("rejects an unpaired/lone surrogate", () => {
    expect(schema.safeParse("a\uD800b").success).toBe(false);
  });

  it("enforces the field-specific max length", () => {
    expect(schema.safeParse("a".repeat(20)).success).toBe(true);
    expect(schema.safeParse("a".repeat(21)).success).toBe(false);
  });

  it("trims surrounding whitespace before length/content checks", () => {
    const result = schema.safeParse("  hello  ");

    expect(result.success).toBe(true);
    expect(result.success && result.data).toBe("hello");
  });
});

describe("extractionFieldPathSchema", () => {
  it("accepts every documented leaf path (17 total)", () => {
    expect(extractionFieldPathSchema.options).toHaveLength(17);

    for (const path of extractionFieldPathSchema.options) {
      expect(extractionFieldPathSchema.safeParse(path).success).toBe(true);
    }
  });

  it("rejects an arbitrary/unknown path", () => {
    expect(extractionFieldPathSchema.safeParse("chargeSheet.unknown").success).toBe(false);
  });

  it("AMBIGUOUS_PARTICIPANT_MAPPING is exactly 29 characters", () => {
    expect("AMBIGUOUS_PARTICIPANT_MAPPING").toHaveLength(29);
  });
});

describe("extractionWarningSchema", () => {
  it("accepts a field-specific warning", () => {
    const result = extractionWarningSchema.safeParse({
      code: "MISSING_FIELD",
      field: "chargeSheet.defendant"
    });

    expect(result.success).toBe(true);
  });

  it("accepts UNSUPPORTED_CONTENT_IGNORED with field: null", () => {
    const result = extractionWarningSchema.safeParse({
      code: "UNSUPPORTED_CONTENT_IGNORED",
      field: null
    });

    expect(result.success).toBe(true);
  });

  it("rejects an additional/unknown property (strict)", () => {
    const result = extractionWarningSchema.safeParse({
      code: "MISSING_FIELD",
      field: "chargeSheet.defendant",
      extra: "nope"
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown warning code", () => {
    const result = extractionWarningSchema.safeParse({
      code: "NOT_A_REAL_CODE",
      field: null
    });

    expect(result.success).toBe(false);
  });
});

describe("packageExtractionSchema -- structural rules", () => {
  it("accepts a fully-null draft when every required field has an explaining warning", () => {
    expect(packageExtractionSchema.safeParse(emptyDraft()).success).toBe(true);
  });

  it("rejects a model-supplied 'side'/'role'/'modelId' field anywhere (strict, additionalProperties: false)", () => {
    const draft = emptyDraft() as unknown as Record<string, unknown>;

    draft.side = "PRO";

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects a missing required seat key", () => {
    const draft = emptyDraft();

    delete (draft.participants as Record<string, unknown>).JUDGE_3;

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects an eighth/unknown seat key", () => {
    const draft = emptyDraft() as unknown as {
      participants: Record<string, unknown>;
    };

    draft.participants.PRO_3 = { profileName: null, personality: null };

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  it("enforces reused tribunalSetup.ts field limits (defendant/act/exactQuestion/personality)", () => {
    const draft = fullyPopulatedDraft();

    draft.chargeSheet.defendant = "x".repeat(chargeSheetLimits.defendant + 1);

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);

    const overLongPersonality = fullyPopulatedDraft();

    overLongPersonality.participants.PRO_1.personality = "x".repeat(personalityLimit + 1);

    expect(packageExtractionSchema.safeParse(overLongPersonality).success).toBe(false);
  });

  it("bounds warnings at MAX_EXTRACTION_WARNINGS (40) -- using UNSUPPORTED_CONTENT_IGNORED, which references no field and is orthogonal to the relational rules", () => {
    const draft = fullyPopulatedDraft();

    draft.warnings = Array.from({ length: MAX_EXTRACTION_WARNINGS }, () => ({
      code: "UNSUPPORTED_CONTENT_IGNORED" as const,
      field: null
    }));

    expect(packageExtractionSchema.safeParse(draft).success).toBe(true);

    draft.warnings.push({ code: "UNSUPPORTED_CONTENT_IGNORED", field: null });

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });
});

describe("packageExtractionSchema -- server-authoritative relational/null semantics (Section 10)", () => {
  it("rejects a fully-null draft with ZERO warnings -- required fields left null must be explained", () => {
    const draft: PackageExtractionResult = { ...emptyDraft(), warnings: [] };

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects MISSING_FIELD used for the optional profileName field", () => {
    const draft = fullyPopulatedDraft();

    draft.warnings = [{ code: "MISSING_FIELD", field: "participants.PRO_1.profileName" }];

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  it("accepts a non-MISSING_FIELD warning (e.g. AMBIGUOUS_FIELD) referencing a null profileName", () => {
    const draft = fullyPopulatedDraft();

    draft.participants.PRO_1.profileName = null; // already null; explicit for clarity
    draft.warnings = [{ code: "AMBIGUOUS_FIELD", field: "participants.PRO_1.profileName" }];

    expect(packageExtractionSchema.safeParse(draft).success).toBe(true);
  });

  it("rejects AMBIGUOUS_PARTICIPANT_MAPPING pointing at a Charge Sheet field (must point to a participant field)", () => {
    const draft = fullyPopulatedDraft();

    draft.chargeSheet.defendant = null;
    draft.warnings = [{ code: "AMBIGUOUS_PARTICIPANT_MAPPING", field: "chargeSheet.defendant" }];

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  it("accepts AMBIGUOUS_PARTICIPANT_MAPPING pointing at a null participant field", () => {
    const draft = fullyPopulatedDraft();

    draft.participants.JUDGE_1.personality = null;
    draft.warnings = [
      { code: "AMBIGUOUS_PARTICIPANT_MAPPING", field: "participants.JUDGE_1.personality" }
    ];

    expect(packageExtractionSchema.safeParse(draft).success).toBe(true);
  });

  it("rejects UNSUPPORTED_CONTENT_IGNORED with a non-null field", () => {
    const draft = fullyPopulatedDraft();

    draft.warnings = [
      { code: "UNSUPPORTED_CONTENT_IGNORED", field: "chargeSheet.defendant" as never }
    ];

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects a warning naming a field whose actual value is NOT null (e.g. AMBIGUOUS_FIELD on a populated field)", () => {
    const draft = fullyPopulatedDraft(); // chargeSheet.act is populated, non-null

    draft.warnings = [{ code: "AMBIGUOUS_FIELD", field: "chargeSheet.act" }];

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  it("rejects a required field left null with NO warning at all, even when other required fields ARE explained", () => {
    const draft = emptyDraft();

    // Remove just the exactQuestion warning -- every other required
    // field remains properly explained.
    draft.warnings = draft.warnings.filter(
      (warning) => warning.field !== "chargeSheet.exactQuestion"
    );

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
  });

  // Second independent pre-live re-audit, Section 11: the Zod issue
  // path for a required-field-left-null-with-no-warning failure was
  // computed via `const [, containerKey, ...rest] = path.split(".")`,
  // which skipped the FIRST split segment (the actual container key) and
  // was off-by-one throughout -- validation still correctly failed
  // either way, but the reported `path` pointed at the wrong (or a
  // nonexistent) field. These assert the exact array, not merely
  // success/failure.
  it("reports the exact Zod issue path for an unexplained null Charge Sheet field: [\"chargeSheet\", \"defendant\"]", () => {
    const draft = fullyPopulatedDraft();

    draft.chargeSheet.defendant = null;

    const result = packageExtractionSchema.safeParse(draft);

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (candidate) => candidate.path[0] === "chargeSheet" && candidate.path[1] === "defendant"
      );

      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["chargeSheet", "defendant"]);
    }
  });

  it("reports the exact Zod issue path for an unexplained null participant field: [\"participants\", \"PRO_1\", \"personality\"]", () => {
    const draft = fullyPopulatedDraft();

    draft.participants.PRO_1.personality = null;

    const result = packageExtractionSchema.safeParse(draft);

    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (candidate) =>
          candidate.path[0] === "participants" &&
          candidate.path[1] === "PRO_1" &&
          candidate.path[2] === "personality"
      );

      expect(issue).toBeDefined();
      expect(issue?.path).toEqual(["participants", "PRO_1", "personality"]);
    }
  });

  it("re-validation of a persisted validated_result applies the exact same relational rules (replay path parity)", () => {
    // Simulates loading a persisted validated_result whose relational
    // invariant was corrupted after the fact (e.g. storage drift) --
    // the SAME packageExtractionSchema the replay path re-validates
    // against must reject it, not just the original write path.
    const corrupted = fullyPopulatedDraft();

    corrupted.chargeSheet.act = null; // now null, but zero warning added

    expect(packageExtractionSchema.safeParse(corrupted).success).toBe(false);
  });
});

describe("packageExtractionJsonSchema", () => {
  it("declares additionalProperties: false at every object level", () => {
    expect(packageExtractionJsonSchema.additionalProperties).toBe(false);
    expect(packageExtractionJsonSchema.properties.chargeSheet.additionalProperties).toBe(false);
    expect(packageExtractionJsonSchema.properties.participants.additionalProperties).toBe(false);

    for (const seat of packageSeats) {
      expect(
        packageExtractionJsonSchema.properties.participants.properties[seat].additionalProperties
      ).toBe(false);
    }
  });

  it("requires exactly the seven fixed seat keys", () => {
    expect(packageExtractionJsonSchema.properties.participants.required).toEqual([...packageSeats]);
  });
});

describe("deriveExtractionStatus", () => {
  it("is success with zero warnings", () => {
    expect(deriveExtractionStatus([])).toBe("success");
  });

  it("is needs_review_incomplete when >=1 MISSING_FIELD warning is present", () => {
    expect(
      deriveExtractionStatus([{ code: "MISSING_FIELD", field: "chargeSheet.defendant" }])
    ).toBe("needs_review_incomplete");
  });

  it("is needs_review_ambiguous when >=1 AMBIGUOUS_* warning is present and no MISSING_FIELD", () => {
    expect(
      deriveExtractionStatus([
        { code: "AMBIGUOUS_PARTICIPANT_MAPPING", field: "participants.PRO_1.personality" }
      ])
    ).toBe("needs_review_ambiguous");
  });

  it("an absent optional profileName alone (no warning at all) never becomes needs_review_incomplete", () => {
    // Isolated from the required-field rule entirely: a fully-populated,
    // zero-warning draft (every REQUIRED field non-null) with every
    // OPTIONAL profileName left null is simply success.
    const draft = fullyPopulatedDraft();

    for (const seat of packageSeats as PackageSeat[]) {
      draft.participants[seat].profileName = null;
    }

    expect(packageExtractionSchema.safeParse(draft).success).toBe(true);
    expect(deriveExtractionStatus(draft.warnings)).toBe("success");
  });

  it("MISSING_FIELD takes precedence over an AMBIGUOUS_* warning when both are present", () => {
    expect(
      deriveExtractionStatus([
        { code: "MISSING_FIELD", field: "chargeSheet.defendant" },
        { code: "AMBIGUOUS_FIELD", field: "chargeSheet.act" }
      ])
    ).toBe("needs_review_incomplete");
  });
});
