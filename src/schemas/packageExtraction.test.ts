// Milestone 7A -- structured extraction schema tests (ADR 0004 Decisions
// 5, 6, 11).

import { describe, expect, it } from "vitest";
import { chargeSheetLimits, packageSeats, personalityLimit } from "./tribunalSetup";
import {
  deriveExtractionStatus,
  extractionFieldPathSchema,
  extractionWarningSchema,
  MAX_EXTRACTION_WARNINGS,
  packageExtractionJsonSchema,
  packageExtractionSchema,
  safeExtractionText,
  type PackageExtractionResult
} from "./packageExtraction";

function emptyDraft(): PackageExtractionResult {
  return {
    chargeSheet: { defendant: null, act: null, exactQuestion: null },
    participants: Object.fromEntries(
      packageSeats.map((seat) => [seat, { profileName: null, personality: null }])
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

describe("packageExtractionSchema", () => {
  it("accepts a fully-null draft with zero warnings", () => {
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
    const draft = emptyDraft();

    draft.chargeSheet.defendant = "x".repeat(chargeSheetLimits.defendant + 1);

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);

    const overLongPersonality = emptyDraft();

    overLongPersonality.participants.PRO_1.personality = "x".repeat(personalityLimit + 1);

    expect(packageExtractionSchema.safeParse(overLongPersonality).success).toBe(false);
  });

  it("bounds warnings at MAX_EXTRACTION_WARNINGS (40)", () => {
    const draft = emptyDraft();

    draft.warnings = Array.from({ length: MAX_EXTRACTION_WARNINGS }, () => ({
      code: "MISSING_FIELD" as const,
      field: "chargeSheet.defendant" as const
    }));

    expect(packageExtractionSchema.safeParse(draft).success).toBe(true);

    draft.warnings.push({ code: "MISSING_FIELD", field: "chargeSheet.act" });

    expect(packageExtractionSchema.safeParse(draft).success).toBe(false);
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
    const draft = emptyDraft();

    // profileName is optional -- null with zero warnings is simply success.
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
