import { z } from "zod";

export const chargeSheetLimits = {
  defendant: 200,
  act: 6000,
  exactQuestion: 1000
} as const;

export const personalityLimit = 4000;
export const profileNameLimit = 120;

export const participantIds = [
  "advocate-pro-1",
  "advocate-pro-2",
  "advocate-con-1",
  "advocate-con-2",
  "judge-1",
  "judge-2",
  "judge-3"
] as const;

export type ParticipantId = (typeof participantIds)[number];

export const packageSeatToParticipantId = {
  PRO_1: "advocate-pro-1",
  PRO_2: "advocate-pro-2",
  CON_1: "advocate-con-1",
  CON_2: "advocate-con-2",
  JUDGE_1: "judge-1",
  JUDGE_2: "judge-2",
  JUDGE_3: "judge-3"
} as const satisfies Record<string, ParticipantId>;

export type PackageSeat = keyof typeof packageSeatToParticipantId;

export const packageSeats = Object.keys(
  packageSeatToParticipantId
) as PackageSeat[];

export const participantIdToPackageSeat = Object.fromEntries(
  packageSeats.map((seat) => [packageSeatToParticipantId[seat], seat])
) as Record<ParticipantId, PackageSeat>;

export const sourceTypeSchema = z.enum([
  "MANUAL",
  "CHARGE_SHEET_FILE",
  "TRIBUNAL_PACKAGE_FILE"
]);

export type CaseSourceType = z.infer<typeof sourceTypeSchema>;

export const personalitySourceSchema = z.enum([
  "manual",
  "individual_file",
  "tribunal_package"
]);

export type PersonalitySource = z.infer<typeof personalitySourceSchema>;

export const chargeSheetSchema = z.object({
  defendant: z
    .string()
    .trim()
    .min(1, "Defendant is required.")
    .max(chargeSheetLimits.defendant, "Defendant exceeds 200 characters."),
  act: z
    .string()
    .trim()
    .min(1, "Act is required.")
    .max(chargeSheetLimits.act, "Act exceeds 6000 characters."),
  exactQuestion: z
    .string()
    .trim()
    .min(1, "Exact Question is required.")
    .max(
      chargeSheetLimits.exactQuestion,
      "Exact Question exceeds 1000 characters."
    )
});

export type ChargeSheet = z.infer<typeof chargeSheetSchema>;

export const profileNameSchema = z
  .string()
  .trim()
  .max(profileNameLimit, "Profile name exceeds 120 characters.");

export const participantDraftSchema = z.object({
  profileName: profileNameSchema.optional(),
  personality: z
    .string()
    .trim()
    .min(1, "Personality is required.")
    .max(personalityLimit, "Personality exceeds 4000 characters."),
  personalitySource: personalitySourceSchema,
  personalitySourceFilename: z.string().trim().optional()
});

export type ParticipantDraft = z.infer<typeof participantDraftSchema>;

export const tribunalSetupDraftSchema = z.object({
  chargeSheet: chargeSheetSchema,
  participants: z.record(z.enum(participantIds), participantDraftSchema),
  importSource: z.object({
    type: sourceTypeSchema,
    filename: z.string().trim().optional()
  })
});

export type TribunalSetupDraft = z.infer<typeof tribunalSetupDraftSchema>;
