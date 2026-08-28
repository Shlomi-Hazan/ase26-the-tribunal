// Milestone 7 -- structured-output schemas for advocate speeches and judge
// verdicts (SPEC.md OUT-001..OUT-008). Application-side runtime validation
// (Zod) and the provider-facing JSON Schema sent as
// `response_format.json_schema` must stay aligned -- both are defined here,
// side by side, so a future edit to one is hard to make without noticing
// the other.

import { z } from "zod";

// ---------------------------------------------------------------------
// Advocate speech (SPEC.md OUT-001, OUT-002, OUT-006).
// ---------------------------------------------------------------------

export const advocateSpeechSchema = z
  .object({
    speech: z.string().trim().min(1, "Speech must not be empty.")
  })
  .strict();

export type AdvocateSpeech = z.infer<typeof advocateSpeechSchema>;

export const advocateSpeechJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["speech"],
  properties: {
    speech: { type: "string", minLength: 1 }
  }
} as const;

// ---------------------------------------------------------------------
// Judge verdict (SPEC.md OUT-003, OUT-004, OUT-005, OUT-006).
// ---------------------------------------------------------------------

export const judgeVerdictSchema = z
  .object({
    verdict: z.enum(["GUILTY", "NOT_GUILTY"]),
    reasoning: z.string().trim().min(1, "Reasoning must not be empty.")
  })
  .strict();

export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;

export const judgeVerdictJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "reasoning"],
  properties: {
    verdict: { type: "string", enum: ["GUILTY", "NOT_GUILTY"] },
    reasoning: { type: "string", minLength: 1 }
  }
} as const;
