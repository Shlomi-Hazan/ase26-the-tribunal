// Milestone 7A -- structured extraction result contract (ADR 0004
// Decisions 5, 6, 11). The model fills the *existing* fixed-seat fields
// M5's deterministic Tribunal Package import already produces
// (src/schemas/tribunalSetup.ts) -- this module never invents a parallel
// case/participant shape. Application-owned identity (side, role, seat
// id, model assignment, endpoint, pricing, prompt version, execution
// mode, run status) is never part of what the model may produce -- the
// schema below has no field for any of it.

import { z } from "zod";
import {
  chargeSheetLimits,
  packageSeats,
  personalityLimit,
  profileNameLimit,
  type PackageSeat
} from "./tribunalSetup";

// ---------------------------------------------------------------------
// safeExtractionText (Decision 5) -- applied to every free-text field the
// model may populate: defendant, act, exactQuestion, profileName,
// personality.
//
// Allowed: any well-formed Unicode string, trimmed, up to maxLength,
// EXCLUDING C0 control characters other than tab (\x09) and newline
// (\x0A), and excluding DEL (\x7F). Carriage return (\x0D) is
// deliberately included in the excluded C0 range -- a bare CR is
// rejected, matching the documented "control characters excluded except
// newline/tab" rule exactly (corrected during planning: an earlier draft
// left CR ambiguously allowed).
// ---------------------------------------------------------------------

// A char-code loop, not a regex literal embedding raw control characters
// (matching netlify/server/runs.ts's containsControlCharacter -- the
// same lint rule against literal control characters in source applies
// here). Tab (\x09) and newline (\x0A) are the only C0 controls
// deliberately allowed; \x0D (CR) is excluded like every other C0
// control; \x7F (DEL) is excluded separately, since it is outside the
// 0x00-0x1F C0 range.
function hasProhibitedControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code === 0x09 || code === 0x0a) {
      continue;
    }

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

// Equivalent to the runtime-available `String.prototype.isWellFormed()`
// (ES2024) without requiring the project's `tsconfig.json` `lib` target
// to move off ES2022 for this one check: a string is well-formed
// Unicode iff every surrogate code unit (U+D800-U+DFFF) is part of a
// valid low/high surrogate pair, never a lone/unpaired one.
function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const isHighSurrogate = code >= 0xd800 && code <= 0xdbff;
    const isLowSurrogate = code >= 0xdc00 && code <= 0xdfff;

    if (isHighSurrogate) {
      const next = value.charCodeAt(index + 1);

      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }

      index += 1; // Skip the paired low surrogate.
      continue;
    }

    if (isLowSurrogate) {
      return false; // A low surrogate with no preceding high surrogate.
    }
  }

  return true;
}

export function safeExtractionText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength, `Value exceeds ${maxLength} characters.`)
    .refine((value) => isWellFormedUnicode(value), {
      message: "Value contains unpaired Unicode surrogates."
    })
    .refine((value) => !hasProhibitedControlCharacter(value), {
      message: "Value contains a prohibited control character."
    });
}

// ---------------------------------------------------------------------
// Warning taxonomy (Decision 6).
// ---------------------------------------------------------------------

// Closed, exact 17-value enum of leaf field paths a warning may point at
// -- never arbitrary free text. Longest value is 32 characters
// ("participants.JUDGE_1.profileName" / "...personality").
export const extractionFieldPathSchema = z.enum([
  "chargeSheet.defendant",
  "chargeSheet.act",
  "chargeSheet.exactQuestion",
  "participants.PRO_1.profileName",
  "participants.PRO_1.personality",
  "participants.PRO_2.profileName",
  "participants.PRO_2.personality",
  "participants.CON_1.profileName",
  "participants.CON_1.personality",
  "participants.CON_2.profileName",
  "participants.CON_2.personality",
  "participants.JUDGE_1.profileName",
  "participants.JUDGE_1.personality",
  "participants.JUDGE_2.profileName",
  "participants.JUDGE_2.personality",
  "participants.JUDGE_3.profileName",
  "participants.JUDGE_3.personality"
]);

export type ExtractionFieldPath = z.infer<typeof extractionFieldPathSchema>;

export const extractionWarningCodeSchema = z.enum([
  "MISSING_FIELD",
  "AMBIGUOUS_FIELD",
  "AMBIGUOUS_PARTICIPANT_MAPPING",
  "UNSUPPORTED_CONTENT_IGNORED",
  "LOW_CONFIDENCE_EXTRACTION"
]);

export type ExtractionWarningCode = z.infer<typeof extractionWarningCodeSchema>;

export const extractionWarningSchema = z
  .object({
    code: extractionWarningCodeSchema,
    // UNSUPPORTED_CONTENT_IGNORED is the one warning that is not
    // field-specific (it describes dossier content the model deliberately
    // did not use at all) -- every other code always names the affected
    // field.
    field: extractionFieldPathSchema.nullable()
  })
  .strict();

export type ExtractionWarning = z.infer<typeof extractionWarningSchema>;

export const MAX_EXTRACTION_WARNINGS = 40;

// ---------------------------------------------------------------------
// packageExtractionSchema (Decision 5) -- reuses tribunalSetup.ts's exact
// numeric limits, never redefines them. Every free-text field is
// nullable: an unresolved/ambiguous value is `null` plus a matching
// warning, never a low-confidence guess silently preserved.
// ---------------------------------------------------------------------

const extractedChargeSheetSchema = z
  .object({
    defendant: safeExtractionText(chargeSheetLimits.defendant).nullable(),
    act: safeExtractionText(chargeSheetLimits.act).nullable(),
    exactQuestion: safeExtractionText(chargeSheetLimits.exactQuestion).nullable()
  })
  .strict();

export type ExtractedChargeSheet = z.infer<typeof extractedChargeSheetSchema>;

const extractedParticipantSchema = z
  .object({
    profileName: safeExtractionText(profileNameLimit).nullable(),
    personality: safeExtractionText(personalityLimit).nullable()
  })
  .strict();

export type ExtractedParticipant = z.infer<typeof extractedParticipantSchema>;

const extractedParticipantsShape = Object.fromEntries(
  packageSeats.map((seat) => [seat, extractedParticipantSchema])
) as Record<PackageSeat, typeof extractedParticipantSchema>;

export const packageExtractionSchema = z
  .object({
    chargeSheet: extractedChargeSheetSchema,
    participants: z.object(extractedParticipantsShape).strict(),
    warnings: z.array(extractionWarningSchema).max(MAX_EXTRACTION_WARNINGS)
  })
  .strict();

export type PackageExtractionResult = z.infer<typeof packageExtractionSchema>;

// ---------------------------------------------------------------------
// Provider-facing JSON Schema, defined side by side with the Zod schema
// above (src/prompts/schemas.ts's existing pairing pattern) so an edit to
// one is hard to make without noticing the other. additionalProperties:
// false everywhere.
// ---------------------------------------------------------------------

const jsonNullableString = (maxLength: number) => ({
  type: ["string", "null"],
  maxLength
});

const participantJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["profileName", "personality"],
  properties: {
    profileName: jsonNullableString(profileNameLimit),
    personality: jsonNullableString(personalityLimit)
  }
} as const;

export const packageExtractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chargeSheet", "participants", "warnings"],
  properties: {
    chargeSheet: {
      type: "object",
      additionalProperties: false,
      required: ["defendant", "act", "exactQuestion"],
      properties: {
        defendant: jsonNullableString(chargeSheetLimits.defendant),
        act: jsonNullableString(chargeSheetLimits.act),
        exactQuestion: jsonNullableString(chargeSheetLimits.exactQuestion)
      }
    },
    participants: {
      type: "object",
      additionalProperties: false,
      required: [...packageSeats],
      properties: Object.fromEntries(
        packageSeats.map((seat) => [seat, participantJsonSchema])
      )
    },
    warnings: {
      type: "array",
      maxItems: MAX_EXTRACTION_WARNINGS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "field"],
        properties: {
          code: { type: "string", enum: [...extractionWarningCodeSchema.options] },
          field: {
            type: ["string", "null"],
            enum: [...extractionFieldPathSchema.options, null]
          }
        }
      }
    }
  }
} as const;

// ---------------------------------------------------------------------
// Derived status (Decision 6/16) -- never a model-reported field.
// EXTRACTION_INCOMPLETE requires >=1 MISSING_FIELD warning;
// EXTRACTION_AMBIGUOUS requires >=1 AMBIGUOUS_FIELD/
// AMBIGUOUS_PARTICIPANT_MAPPING warning. An absent *optional* profileName
// alone never contributes to EXTRACTION_INCOMPLETE (profileName has no
// MISSING_FIELD warning associated with a null value by itself -- only
// personality and the three Charge Sheet fields are ever required).
// ---------------------------------------------------------------------

export type ExtractionDerivedStatus =
  | "success"
  | "needs_review_incomplete"
  | "needs_review_ambiguous";

export function deriveExtractionStatus(
  warnings: ExtractionWarning[]
): ExtractionDerivedStatus {
  const hasMissing = warnings.some((warning) => warning.code === "MISSING_FIELD");
  const hasAmbiguous = warnings.some(
    (warning) =>
      warning.code === "AMBIGUOUS_FIELD" ||
      warning.code === "AMBIGUOUS_PARTICIPANT_MAPPING"
  );

  if (hasMissing) {
    return "needs_review_incomplete";
  }

  if (hasAmbiguous) {
    return "needs_review_ambiguous";
  }

  return "success";
}
