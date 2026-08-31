// Milestone 10 -- deterministic Tribunal protocol validation and read-time
// resolution (Issue #23, "Protocol Decision"). `protocols.protocol_json`
// is arbitrary persisted JSONB -- it must be validated against a strict
// runtime schema before any of it is exposed, exactly like any other
// external/persisted data this application never blindly trusts. The
// resolved view then combines the validated protocol with its REFERENCED
// evidence -- canonical case via caseId, judge reasonings via runId,
// economics summary via runId (SPEC.md Sec 13's "include or reference"
// contract). Cross-checks the protocol's own runId/caseId/executionMode/
// majorityVerdict against the containing run and protocols.schema_version
// against protocol_json.schemaVersion -- any mismatch fails closed as an
// audit inconsistency, never repaired.
//
// Corrected (independent source audit, Finding 1): every failure mode
// below now returns `{ ok: false, reason }` rather than silently
// substituting a fabricated value -- missing judge reasoning, a missing
// frozen participant snapshot, a persisted judge verdict that disagrees
// with the protocol's own recorded verdict, a duplicate/missing
// participant identity, a speech under the wrong side, a Judge ID inside
// `speeches`, an Advocate ID inside `judgeVerdicts`, or an unexpected
// extra JSON property anywhere in the persisted shape (every object-level
// schema is now `z.strictObject`, not `z.object`). This module never
// mutates a stored protocol row and never makes a model call.

import { z } from "zod";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";

// Local, self-contained canonical identity map -- deliberately not
// imported from runs.ts (which imports resolveProtocol from this module;
// importing back would be a cycle). Matches the same fixed mapping
// execution.ts and runs.ts each already define locally for the same
// reason.
const ROLE_BY_PARTICIPANT_ID: Record<ParticipantId, "ADVOCATE" | "JUDGE"> = {
  "advocate-pro-1": "ADVOCATE",
  "advocate-pro-2": "ADVOCATE",
  "advocate-con-1": "ADVOCATE",
  "advocate-con-2": "ADVOCATE",
  "judge-1": "JUDGE",
  "judge-2": "JUDGE",
  "judge-3": "JUDGE"
};

const SIDE_BY_PARTICIPANT_ID: Record<ParticipantId, "PRO" | "CON" | null> = {
  "advocate-pro-1": "PRO",
  "advocate-pro-2": "PRO",
  "advocate-con-1": "CON",
  "advocate-con-2": "CON",
  "judge-1": null,
  "judge-2": null,
  "judge-3": null
};

const ADVOCATE_IDS: ParticipantId[] = participantIds.filter((id) => ROLE_BY_PARTICIPANT_ID[id] === "ADVOCATE");
const JUDGE_IDS: ParticipantId[] = participantIds.filter((id) => ROLE_BY_PARTICIPANT_ID[id] === "JUDGE");

const protocolSpeechSchema = z.strictObject({
  participantId: z.enum(participantIds),
  side: z.enum(["PRO", "CON"]),
  speech: z.string().min(1)
});

const protocolJudgeVerdictSchema = z.strictObject({
  participantId: z.enum(participantIds),
  verdict: z.enum(["GUILTY", "NOT_GUILTY"])
});

const protocolParticipantSchema = z.strictObject({
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
//
// `.superRefine` proves the SEMANTIC fixed Tribunal shape, not merely
// array lengths (independent source audit, Finding 1): speeches are
// exactly the 4 fixed Advocate IDs, each once, on their own correct
// side; judgeVerdicts are exactly the 3 fixed Judge IDs, each once;
// participants are exactly all 7 canonical IDs, each once, with
// role/side agreeing with that participant's own fixed identity. None of
// this is a caller-supplied assumption -- every expected ID/role/side is
// this same local, hand-written canonical map every other module in this
// codebase already uses.
export const protocolJsonV1Schema = z
  .strictObject({
    schemaVersion: z.literal("tribunal-protocol-v1"),
    runId: z.string().uuid(),
    caseId: z.string().uuid(),
    executionMode: z.enum(["shared", "separate"]),
    majorityVerdict: z.enum(["GUILTY", "NOT_GUILTY"]),
    speeches: z.array(protocolSpeechSchema).length(4),
    judgeVerdicts: z.array(protocolJudgeVerdictSchema).length(3),
    participants: z.array(protocolParticipantSchema).length(7)
  })
  .superRefine((value, ctx) => {
    const seenSpeechIds = new Set<ParticipantId>();

    for (const speech of value.speeches) {
      if (!ADVOCATE_IDS.includes(speech.participantId)) {
        ctx.addIssue({
          code: "custom",
          path: ["speeches"],
          message: `${speech.participantId} is not a valid Advocate participant -- no Judge ID may appear in speeches.`
        });
        continue;
      }

      if (seenSpeechIds.has(speech.participantId)) {
        ctx.addIssue({ code: "custom", path: ["speeches"], message: `Duplicate speech for ${speech.participantId}.` });
      }

      seenSpeechIds.add(speech.participantId);

      if (SIDE_BY_PARTICIPANT_ID[speech.participantId] !== speech.side) {
        ctx.addIssue({
          code: "custom",
          path: ["speeches"],
          message: `${speech.participantId}'s speech carries the wrong side.`
        });
      }
    }

    for (const id of ADVOCATE_IDS) {
      if (!seenSpeechIds.has(id)) {
        ctx.addIssue({ code: "custom", path: ["speeches"], message: `Missing speech for ${id}.` });
      }
    }

    const seenJudgeVerdictIds = new Set<ParticipantId>();

    for (const verdict of value.judgeVerdicts) {
      if (!JUDGE_IDS.includes(verdict.participantId)) {
        ctx.addIssue({
          code: "custom",
          path: ["judgeVerdicts"],
          message: `${verdict.participantId} is not a valid Judge participant -- no Advocate ID may appear in judgeVerdicts.`
        });
        continue;
      }

      if (seenJudgeVerdictIds.has(verdict.participantId)) {
        ctx.addIssue({
          code: "custom",
          path: ["judgeVerdicts"],
          message: `Duplicate verdict for ${verdict.participantId}.`
        });
      }

      seenJudgeVerdictIds.add(verdict.participantId);
    }

    for (const id of JUDGE_IDS) {
      if (!seenJudgeVerdictIds.has(id)) {
        ctx.addIssue({ code: "custom", path: ["judgeVerdicts"], message: `Missing verdict for ${id}.` });
      }
    }

    const seenParticipantIds = new Set<ParticipantId>();

    for (const participant of value.participants) {
      if (seenParticipantIds.has(participant.participantId)) {
        ctx.addIssue({
          code: "custom",
          path: ["participants"],
          message: `Duplicate participant snapshot for ${participant.participantId}.`
        });
      }

      seenParticipantIds.add(participant.participantId);

      const expectedRole = ROLE_BY_PARTICIPANT_ID[participant.participantId];
      const expectedSide = SIDE_BY_PARTICIPANT_ID[participant.participantId];

      if (participant.role !== expectedRole) {
        ctx.addIssue({
          code: "custom",
          path: ["participants"],
          message: `${participant.participantId} has the wrong role (expected ${expectedRole}).`
        });
      }

      if (participant.side !== expectedSide) {
        ctx.addIssue({
          code: "custom",
          path: ["participants"],
          message: `${participant.participantId} has the wrong side (expected ${expectedSide ?? "null"}).`
        });
      }
    }

    for (const id of participantIds) {
      if (!seenParticipantIds.has(id)) {
        ctx.addIssue({ code: "custom", path: ["participants"], message: `Missing participant snapshot for ${id}.` });
      }
    }
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
  // Frozen participant configuration (already loaded by the repository
  // for the existing participants[] response) -- reused here rather than
  // re-queried. Every participant the protocol references must have an
  // entry here, or resolution fails closed (Finding 1).
  //
  // Corrected (final source re-review, "Frozen Participant Micro-
  // Correction"): carries the FULL frozen row -- role/side/modelId/
  // promptVersion alongside profileName/personality -- not only the
  // latter two. protocol_json.participants[] duplicates role/side/
  // modelId/promptVersion (it has to, since the protocol is a
  // self-contained historical record), which means those fields can
  // silently drift from what participant_configs actually says unless
  // the resolver cross-checks them. profileName/personality are never
  // duplicated inside protocol_json V1 at all -- they are resolved from
  // this map by reference only, exactly as SPEC.md Sec 13 intends.
  participantsByParticipantId: Map<
    ParticipantId,
    {
      role: "ADVOCATE" | "JUDGE";
      side: "PRO" | "CON" | null;
      profileName: string | null;
      personality: string;
      modelId: string;
      promptVersion: string;
    }
  >;
  // Corrected (independent source audit, Finding 1): carries the
  // persisted judge_verdicts row's OWN verdict alongside its reasoning
  // (previously reasoning-only), so the resolver can cross-check the
  // protocol's recorded verdict against what was actually persisted --
  // not merely supply display text. Reused from the same already-loaded
  // judge_verdicts query, never re-queried.
  judgeEvidenceByParticipantId: Map<ParticipantId, { verdict: "GUILTY" | "NOT_GUILTY"; reasoning: string }>;
  economics: ResolvedProtocolEconomicsReference;
};

export type ResolveProtocolResult =
  | { ok: true; protocol: ResolvedProtocol }
  | { ok: false; reason: string };

export function resolveProtocol(input: ResolveProtocolInput): ResolveProtocolResult {
  const parsed = protocolJsonV1Schema.safeParse(input.protocolJsonRaw);

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "invalid shape";

    return { ok: false, reason: `Stored protocol_json failed schema validation: ${firstIssue}` };
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

  // Cross-evidence (independent source audit, Finding 1; extended by the
  // final "Frozen Participant Micro-Correction"): every participant the
  // protocol references must have real, persisted frozen-configuration
  // evidence -- never a silent `profileName: null, personality: ""`
  // substitution when the lookup unexpectedly misses -- AND the
  // protocol's own role/side/modelId/promptVersion for that participant
  // must agree with what participant_configs actually persisted. Neither
  // side is silently preferred over the other; a disagreement is an
  // audit inconsistency, full stop.
  for (const entry of protocol.participants) {
    const frozen = input.participantsByParticipantId.get(entry.participantId);

    if (!frozen) {
      return {
        ok: false,
        reason: `No persisted frozen participant configuration found for ${entry.participantId}.`
      };
    }

    if (frozen.role !== entry.role) {
      return {
        ok: false,
        reason: `Persisted frozen role for ${entry.participantId} disagrees with the protocol's recorded role.`
      };
    }

    if (frozen.side !== entry.side) {
      return {
        ok: false,
        reason: `Persisted frozen side for ${entry.participantId} disagrees with the protocol's recorded side.`
      };
    }

    if (frozen.modelId !== entry.modelId) {
      return {
        ok: false,
        reason: `Persisted frozen model for ${entry.participantId} disagrees with the protocol's recorded model.`
      };
    }

    if (frozen.promptVersion !== entry.promptVersion) {
      return {
        ok: false,
        reason: `Persisted frozen prompt version for ${entry.participantId} disagrees with the protocol's recorded prompt version.`
      };
    }
  }

  // Cross-evidence: every judge verdict the protocol references must
  // have real persisted reasoning, AND the persisted verdict itself must
  // agree with what the protocol recorded -- a disagreement is an audit
  // inconsistency, not something to silently prefer one side of.
  for (const entry of protocol.judgeVerdicts) {
    const evidence = input.judgeEvidenceByParticipantId.get(entry.participantId);

    if (!evidence || evidence.reasoning.trim().length === 0) {
      return { ok: false, reason: `No persisted judge reasoning found for ${entry.participantId}.` };
    }

    if (evidence.verdict !== entry.verdict) {
      return {
        ok: false,
        reason: `Persisted judge verdict for ${entry.participantId} disagrees with the protocol's recorded verdict.`
      };
    }
  }

  // Every lookup below is now guaranteed present by the cross-evidence
  // checks above -- no `?? null`/`?? ""` fallback is reachable.
  const resolvedParticipants: ResolvedProtocolParticipant[] = protocol.participants.map((entry) => {
    const frozen = input.participantsByParticipantId.get(entry.participantId)!;

    return {
      participantId: entry.participantId,
      role: entry.role,
      side: entry.side,
      profileName: frozen.profileName,
      personality: frozen.personality,
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
    const evidence = input.judgeEvidenceByParticipantId.get(entry.participantId)!;

    return { participantId: entry.participantId, verdict: entry.verdict, reasoning: evidence.reasoning };
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
