// Milestone 10 -- deterministic Tribunal protocol validation and read-time
// resolution (Issue #23, "Protocol Decision"). `protocols.protocol_json`
// is arbitrary persisted JSONB -- it must be validated against a strict
// runtime schema before any of it is exposed, exactly like any other
// external/persisted data this application never blindly trusts. The
// resolved view then combines the validated protocol with its REFERENCED
// evidence (canonical case via caseId, judge reasonings via runId,
// economics summary via runId) -- SPEC.md Sec 13's "include or reference"
// contract, satisfied by resolving those references at read time rather
// than embedding them inline in the immutable, already-real
// `protocol_json` rows (Issue #23 Sec 11).
//
// This module never mutates a stored protocol row and never makes a
// model call. A mismatch between the protocol's own fields and the
// containing run's fields (runId/caseId/executionMode/majorityVerdict)
// or between `protocols.schema_version` and `protocol_json.schemaVersion`
// is treated as an audit inconsistency and fails closed -- never
// "repaired."

import { z } from "zod";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";

const protocolSpeechSchema = z.object({
  participantId: z.enum(participantIds),
  side: z.enum(["PRO", "CON"]),
  speech: z.string().min(1)
});

const protocolJudgeVerdictSchema = z.object({
  participantId: z.enum(participantIds),
  verdict: z.enum(["GUILTY", "NOT_GUILTY"])
});

const protocolParticipantSchema = z.object({
  participantId: z.enum(participantIds),
  role: z.enum(["ADVOCATE", "JUDGE"]),
  side: z.enum(["PRO", "CON"]).nullable(),
  modelId: z.string().min(1),
  promptVersion: z.string().min(1)
});

// Matches exactly what execution.ts's `protocol` object literal builds --
// see netlify/server/tribunal/execution.ts, end of executeTribunalRun.
// Only the `"tribunal-protocol-v1"` shape is understood; a future schema
// version needs its own schema/branch here, never a loosened superset.
export const protocolJsonV1Schema = z.object({
  schemaVersion: z.literal("tribunal-protocol-v1"),
  runId: z.string().uuid(),
  caseId: z.string().uuid(),
  executionMode: z.enum(["shared", "separate"]),
  majorityVerdict: z.enum(["GUILTY", "NOT_GUILTY"]),
  speeches: z.array(protocolSpeechSchema).length(4),
  judgeVerdicts: z.array(protocolJudgeVerdictSchema).length(3),
  participants: z.array(protocolParticipantSchema).length(7)
});

export type ProtocolJsonV1 = z.infer<typeof protocolJsonV1Schema>;

export type ResolvedProtocolChargeSheet = {
  defendant: string;
  act: string;
  exactQuestion: string;
};

export type ResolvedProtocolParticipant = {
  participantId: ParticipantId;
  role: "ADVOCATE" | "JUDGE";
  side: "PRO" | "CON" | null;
  profileName: string | null;
  personality: string;
  modelId: string;
  promptVersion: string;
};

export type ResolvedProtocolAdvocate = {
  participantId: ParticipantId;
  side: "PRO" | "CON";
  speech: string;
};

export type ResolvedProtocolJudge = {
  participantId: ParticipantId;
  verdict: "GUILTY" | "NOT_GUILTY";
  reasoning: string;
};

export type ResolvedProtocolEconomicsReference = {
  logicalCallCount: number;
  providerAttemptCount: number;
  totalTokens: number | null;
  totalCostUsd: string | null;
};

export type ResolvedProtocol = {
  schemaVersion: string;
  runId: string;
  caseId: string;
  executionMode: "shared" | "separate";
  majorityVerdict: "GUILTY" | "NOT_GUILTY";
  chargeSheet: ResolvedProtocolChargeSheet;
  participants: ResolvedProtocolParticipant[];
  advocates: ResolvedProtocolAdvocate[];
  judges: ResolvedProtocolJudge[];
  economics: ResolvedProtocolEconomicsReference;
};

export type ResolveProtocolInput = {
  storedSchemaVersion: string;
  protocolJsonRaw: unknown;
  run: {
    id: string;
    caseId: string;
    executionMode: "shared" | "separate";
    majorityVerdict: "GUILTY" | "NOT_GUILTY" | null;
  };
  chargeSheet: ResolvedProtocolChargeSheet;
  // Frozen participant configuration/personality (already loaded by the
  // repository for the existing participants[] response) -- reused here
  // rather than re-queried.
  participantsByParticipantId: Map<
    ParticipantId,
    { profileName: string | null; personality: string }
  >;
  // Persisted judge reasonings (already loaded via judge_verdicts) --
  // keyed by participantId, reused rather than re-queried.
  reasoningByParticipantId: Map<ParticipantId, string>;
  economics: ResolvedProtocolEconomicsReference;
};

export type ResolveProtocolResult =
  | { ok: true; protocol: ResolvedProtocol }
  | { ok: false; reason: string };

export function resolveProtocol(input: ResolveProtocolInput): ResolveProtocolResult {
  const parsed = protocolJsonV1Schema.safeParse(input.protocolJsonRaw);

  if (!parsed.success) {
    return { ok: false, reason: "Stored protocol_json failed schema validation." };
  }

  const protocol = parsed.data;

  if (protocol.schemaVersion !== input.storedSchemaVersion) {
    return {
      ok: false,
      reason: "protocols.schema_version does not agree with protocol_json.schemaVersion."
    };
  }

  if (protocol.runId !== input.run.id) {
    return { ok: false, reason: "Stored protocol's runId does not match the requested run." };
  }

  if (protocol.caseId !== input.run.caseId) {
    return { ok: false, reason: "Stored protocol's caseId does not match the run's caseId." };
  }

  if (protocol.executionMode !== input.run.executionMode) {
    return { ok: false, reason: "Stored protocol's executionMode does not match the run's executionMode." };
  }

  if (protocol.majorityVerdict !== input.run.majorityVerdict) {
    return {
      ok: false,
      reason: "Stored protocol's majorityVerdict does not match the run's persisted majority verdict."
    };
  }

  const resolvedParticipants: ResolvedProtocolParticipant[] = protocol.participants.map((entry) => {
    const frozen = input.participantsByParticipantId.get(entry.participantId);

    return {
      participantId: entry.participantId,
      role: entry.role,
      side: entry.side,
      profileName: frozen?.profileName ?? null,
      personality: frozen?.personality ?? "",
      modelId: entry.modelId,
      promptVersion: entry.promptVersion
    };
  });

  const resolvedAdvocates: ResolvedProtocolAdvocate[] = protocol.speeches.map((entry) => ({
    participantId: entry.participantId,
    side: entry.side,
    speech: entry.speech
  }));

  const resolvedJudges: ResolvedProtocolJudge[] = protocol.judgeVerdicts.map((entry) => {
    const reasoning = input.reasoningByParticipantId.get(entry.participantId);

    if (!reasoning) {
      // Should be structurally impossible for a COMPLETED run (the same
      // persist_judge_verdict call that wrote protocol.judgeVerdicts also
      // wrote judge_verdicts.reasoning), but never fabricate a value if
      // it somehow is missing.
      return { participantId: entry.participantId, verdict: entry.verdict, reasoning: "" };
    }

    return { participantId: entry.participantId, verdict: entry.verdict, reasoning };
  });

  return {
    ok: true,
    protocol: {
      schemaVersion: protocol.schemaVersion,
      runId: protocol.runId,
      caseId: protocol.caseId,
      executionMode: protocol.executionMode,
      majorityVerdict: protocol.majorityVerdict,
      chargeSheet: input.chargeSheet,
      participants: resolvedParticipants,
      advocates: resolvedAdvocates,
      judges: resolvedJudges,
      economics: input.economics
    }
  };
}
