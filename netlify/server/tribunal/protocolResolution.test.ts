// Milestone 10 -- deterministic Tribunal protocol validation and
// read-time resolution (Issue #23). Never mutates persistence, never
// makes a model call; a mismatch fails closed rather than being repaired.
//
// Corrected (independent source audit, Finding 1): exhaustive fail-closed
// coverage -- missing judge reasoning, missing frozen participant,
// duplicate/missing speech or verdict or participant identity, a Judge ID
// in speeches, an Advocate ID in judgeVerdicts, wrong PRO/CON side, wrong
// role, an unexpected extra JSON property (strict schema), and a
// persisted judge verdict disagreeing with the protocol's own recorded
// verdict. Valid real-shaped fixtures still resolve.

import { describe, expect, it } from "vitest";
import { resolveProtocol, protocolJsonV1Schema, type ResolveProtocolInput } from "./protocolResolution";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CASE_ID = "22222222-2222-4222-8222-222222222222";

function validProtocolJson() {
  return {
    schemaVersion: "tribunal-protocol-v1" as const,
    runId: RUN_ID,
    caseId: CASE_ID,
    executionMode: "shared" as const,
    majorityVerdict: "GUILTY" as const,
    speeches: [
      { participantId: "advocate-pro-1", side: "PRO", speech: "PRO I speech." },
      { participantId: "advocate-pro-2", side: "PRO", speech: "PRO II speech." },
      { participantId: "advocate-con-1", side: "CON", speech: "CON I speech." },
      { participantId: "advocate-con-2", side: "CON", speech: "CON II speech." }
    ],
    judgeVerdicts: [
      { participantId: "judge-1", verdict: "GUILTY" },
      { participantId: "judge-2", verdict: "GUILTY" },
      { participantId: "judge-3", verdict: "NOT_GUILTY" }
    ],
    participants: participantIds.map((participantId) => ({
      participantId,
      role: participantId.startsWith("judge") ? "JUDGE" : "ADVOCATE",
      side: participantId.startsWith("advocate-pro")
        ? "PRO"
        : participantId.startsWith("advocate-con")
          ? "CON"
          : null,
      modelId: "openai/gpt-5-nano",
      promptVersion: participantId.startsWith("judge") ? "judge-v1" : "advocate-v1"
    }))
  };
}

// Mirrors validProtocolJson()'s own per-participant role/side/modelId/
// promptVersion exactly, so the "valid" fixture's frozen evidence agrees
// with its protocol_json by construction -- individual tests below
// deliberately diverge one field at a time to prove the cross-check.
function frozenParticipant(
  id: ParticipantId
): { role: "ADVOCATE" | "JUDGE"; side: "PRO" | "CON" | null; profileName: string | null; personality: string; modelId: string; promptVersion: string } {
  return {
    role: id.startsWith("judge") ? "JUDGE" : "ADVOCATE",
    side: id.startsWith("advocate-pro") ? "PRO" : id.startsWith("advocate-con") ? "CON" : null,
    profileName: null,
    personality: "A measured demeanor.",
    modelId: "openai/gpt-5-nano",
    promptVersion: id.startsWith("judge") ? "judge-v1" : "advocate-v1"
  };
}

function baseInput(overrides: Partial<ResolveProtocolInput> = {}): ResolveProtocolInput {
  const participantsByParticipantId = new Map(participantIds.map((id) => [id, frozenParticipant(id)]));
  const judgeEvidenceByParticipantId = new Map<ParticipantId, { verdict: "GUILTY" | "NOT_GUILTY"; reasoning: string }>([
    ["judge-1", { verdict: "GUILTY", reasoning: "Judge I reasoning." }],
    ["judge-2", { verdict: "GUILTY", reasoning: "Judge II reasoning." }],
    ["judge-3", { verdict: "NOT_GUILTY", reasoning: "Judge III reasoning." }]
  ]);

  return {
    storedSchemaVersion: "tribunal-protocol-v1",
    protocolJsonRaw: validProtocolJson(),
    run: { id: RUN_ID, caseId: CASE_ID, executionMode: "shared", majorityVerdict: "GUILTY" },
    chargeSheet: { defendant: "Alex Rowan", act: "Sold a mislabeled cake.", exactQuestion: "Did Alex know?" },
    participantsByParticipantId,
    judgeEvidenceByParticipantId,
    economics: { logicalCallCount: 7, providerAttemptCount: 7, totalTokens: 1234, totalCostUsd: "0.0014619" },
    ...overrides
  };
}

describe("protocolJsonV1Schema (Milestone 10, Issue #23)", () => {
  it("accepts a well-formed protocol matching execution.ts's real shape", () => {
    expect(protocolJsonV1Schema.safeParse(validProtocolJson()).success).toBe(true);
  });

  it("rejects a schemaVersion other than tribunal-protocol-v1", () => {
    const malformed = { ...validProtocolJson(), schemaVersion: "tribunal-protocol-v2" };

    expect(protocolJsonV1Schema.safeParse(malformed).success).toBe(false);
  });

  it("rejects other than exactly 4 speeches / 3 verdicts / 7 participants", () => {
    const missingSpeech = { ...validProtocolJson(), speeches: validProtocolJson().speeches.slice(0, 3) };

    expect(protocolJsonV1Schema.safeParse(missingSpeech).success).toBe(false);
  });

  it("3: rejects a duplicate speech participant (even if the array is still length 4)", () => {
    const json = validProtocolJson();
    // Two entries for advocate-pro-1, none for advocate-con-2.
    json.speeches = [json.speeches[0], json.speeches[0], json.speeches[1], json.speeches[2]] as never;

    expect(protocolJsonV1Schema.safeParse(json).success).toBe(false);
  });

  it("4: rejects a Judge ID appearing in speeches", () => {
    const json = validProtocolJson();
    json.speeches = [
      { participantId: "judge-1", side: "PRO", speech: "not a real advocate" },
      json.speeches[1],
      json.speeches[2],
      json.speeches[3]
    ] as never;

    expect(protocolJsonV1Schema.safeParse(json).success).toBe(false);
  });

  it("5: rejects a speech with the wrong PRO/CON side for its participant", () => {
    const json = validProtocolJson();
    json.speeches = [
      { ...json.speeches[0], side: "CON" }, // advocate-pro-1 is PRO, not CON
      json.speeches[1],
      json.speeches[2],
      json.speeches[3]
    ] as never;

    expect(protocolJsonV1Schema.safeParse(json).success).toBe(false);
  });

  it("6: rejects a duplicate judge-verdict participant", () => {
    const json = validProtocolJson();
    json.judgeVerdicts = [json.judgeVerdicts[0], json.judgeVerdicts[0], json.judgeVerdicts[1]] as never;

    expect(protocolJsonV1Schema.safeParse(json).success).toBe(false);
  });

  it("7: rejects an Advocate ID appearing in judgeVerdicts", () => {
    const json = validProtocolJson();
    json.judgeVerdicts = [
      { participantId: "advocate-pro-1", verdict: "GUILTY" },
      json.judgeVerdicts[1],
      json.judgeVerdicts[2]
    ] as never;

    expect(protocolJsonV1Schema.safeParse(json).success).toBe(false);
  });

  it("8: rejects a duplicate participant snapshot", () => {
    const json = validProtocolJson();
    json.participants = [json.participants[0], json.participants[0], ...json.participants.slice(2)] as never;

    expect(protocolJsonV1Schema.safeParse(json).success).toBe(false);
  });

  it("9: rejects a participant snapshot with the wrong role for its identity", () => {
    const json = validProtocolJson();
    json.participants = json.participants.map((p) =>
      p.participantId === "judge-1" ? { ...p, role: "ADVOCATE" } : p
    ) as never;

    expect(protocolJsonV1Schema.safeParse(json).success).toBe(false);
  });

  it("10: rejects a participant snapshot with the wrong side for its identity", () => {
    const json = validProtocolJson();
    json.participants = json.participants.map((p) =>
      p.participantId === "advocate-con-1" ? { ...p, side: "PRO" } : p
    ) as never;

    expect(protocolJsonV1Schema.safeParse(json).success).toBe(false);
  });

  it("11: rejects an unexpected extra JSON property at the top level and within a speech (strict schema)", () => {
    const jsonWithExtraTopLevel = { ...validProtocolJson(), unexpectedField: "should be rejected" };

    expect(protocolJsonV1Schema.safeParse(jsonWithExtraTopLevel).success).toBe(false);

    const jsonWithExtraSpeechField = validProtocolJson();
    jsonWithExtraSpeechField.speeches = [
      { ...jsonWithExtraSpeechField.speeches[0], unexpected: "nope" },
      jsonWithExtraSpeechField.speeches[1],
      jsonWithExtraSpeechField.speeches[2],
      jsonWithExtraSpeechField.speeches[3]
    ] as never;

    expect(protocolJsonV1Schema.safeParse(jsonWithExtraSpeechField).success).toBe(false);
  });
});

describe("resolveProtocol (Milestone 10, Issue #23)", () => {
  it("resolves a valid protocol into a readable view combining referenced case/reasoning/economics", () => {
    const result = resolveProtocol(baseInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.protocol.chargeSheet.defendant).toBe("Alex Rowan");
    expect(result.protocol.judges.find((j) => j.participantId === "judge-1")?.reasoning).toBe(
      "Judge I reasoning."
    );
    expect(result.protocol.advocates).toHaveLength(4);
    expect(result.protocol.participants).toHaveLength(7);
    expect(result.protocol.economics.totalCostUsd).toBe("0.0014619");
  });

  it("fails closed on malformed protocol_json rather than partially rendering it", () => {
    const result = resolveProtocol(baseInput({ protocolJsonRaw: { not: "a protocol" } }));

    expect(result.ok).toBe(false);
  });

  it("fails closed when protocols.schema_version disagrees with protocol_json.schemaVersion", () => {
    const result = resolveProtocol(baseInput({ storedSchemaVersion: "tribunal-protocol-v2" }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/schema_version/i);
  });

  it("fails closed when the protocol's runId does not match the requested run", () => {
    const result = resolveProtocol(
      baseInput({ run: { id: "99999999-9999-4999-8999-999999999999", caseId: CASE_ID, executionMode: "shared", majorityVerdict: "GUILTY" } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/runId/i);
  });

  it("fails closed when the protocol's caseId does not match the run's caseId", () => {
    const result = resolveProtocol(
      baseInput({ run: { id: RUN_ID, caseId: "99999999-9999-4999-8999-999999999999", executionMode: "shared", majorityVerdict: "GUILTY" } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/caseId/i);
  });

  it("fails closed when the protocol's executionMode does not match the run's executionMode", () => {
    const result = resolveProtocol(
      baseInput({ run: { id: RUN_ID, caseId: CASE_ID, executionMode: "separate", majorityVerdict: "GUILTY" } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/executionMode/i);
  });

  it("fails closed when the protocol's majority verdict does not match the run's persisted majority", () => {
    const result = resolveProtocol(
      baseInput({ run: { id: RUN_ID, caseId: CASE_ID, executionMode: "shared", majorityVerdict: "NOT_GUILTY" } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/majority/i);
  });

  it("1: fails closed when a referenced judge's reasoning was not persisted -- never fabricates an empty reasoning", () => {
    const judgeEvidenceByParticipantId = new Map<ParticipantId, { verdict: "GUILTY" | "NOT_GUILTY"; reasoning: string }>([
      ["judge-1", { verdict: "GUILTY", reasoning: "Judge I reasoning." }],
      ["judge-2", { verdict: "GUILTY", reasoning: "Judge II reasoning." }]
      // judge-3's reasoning is missing entirely.
    ]);

    const result = resolveProtocol(baseInput({ judgeEvidenceByParticipantId }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/judge-3/);
    expect(result.reason).toMatch(/reasoning/i);
  });

  it("1b: fails closed when a referenced judge's persisted reasoning is present but blank", () => {
    const judgeEvidenceByParticipantId = new Map<ParticipantId, { verdict: "GUILTY" | "NOT_GUILTY"; reasoning: string }>([
      ["judge-1", { verdict: "GUILTY", reasoning: "Judge I reasoning." }],
      ["judge-2", { verdict: "GUILTY", reasoning: "Judge II reasoning." }],
      ["judge-3", { verdict: "NOT_GUILTY", reasoning: "   " }]
    ]);

    const result = resolveProtocol(baseInput({ judgeEvidenceByParticipantId }));

    expect(result.ok).toBe(false);
  });

  it("2: fails closed when a referenced participant's frozen configuration was not persisted", () => {
    const participantsByParticipantId = new Map(
      participantIds.filter((id) => id !== "advocate-pro-1").map((id) => [id, frozenParticipant(id)])
    );

    const result = resolveProtocol(baseInput({ participantsByParticipantId }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/advocate-pro-1/);
  });

  it("12: fails closed when the persisted judge verdict disagrees with the protocol's own recorded verdict", () => {
    const judgeEvidenceByParticipantId = new Map<ParticipantId, { verdict: "GUILTY" | "NOT_GUILTY"; reasoning: string }>([
      ["judge-1", { verdict: "GUILTY", reasoning: "Judge I reasoning." }],
      ["judge-2", { verdict: "GUILTY", reasoning: "Judge II reasoning." }],
      // The protocol records judge-3 as NOT_GUILTY; persisted evidence
      // disagrees.
      ["judge-3", { verdict: "GUILTY", reasoning: "Judge III reasoning." }]
    ]);

    const result = resolveProtocol(baseInput({ judgeEvidenceByParticipantId }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/judge-3/);
    expect(result.reason).toMatch(/disagrees/i);
  });

  it("13: fails closed when the protocol's modelId disagrees with the persisted frozen participant's modelId", () => {
    const participantsByParticipantId = new Map(
      participantIds.map((id) => [
        id,
        id === "advocate-pro-1"
          ? { ...frozenParticipant(id), modelId: "openai/gpt-4.1-nano" }
          : frozenParticipant(id)
      ])
    );

    const result = resolveProtocol(baseInput({ participantsByParticipantId }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/advocate-pro-1/);
    expect(result.reason).toMatch(/model/i);
  });

  it("14: fails closed when the protocol's promptVersion disagrees with the persisted frozen participant's promptVersion", () => {
    const participantsByParticipantId = new Map(
      participantIds.map((id) => [
        id,
        id === "judge-1" ? { ...frozenParticipant(id), promptVersion: "judge-v2" } : frozenParticipant(id)
      ])
    );

    const result = resolveProtocol(baseInput({ participantsByParticipantId }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/judge-1/);
    expect(result.reason).toMatch(/prompt version/i);
  });

  it("15: fails closed when the protocol's role disagrees with the persisted frozen participant's role", () => {
    const participantsByParticipantId = new Map(
      participantIds.map((id) => [
        id,
        id === "advocate-con-1" ? { ...frozenParticipant(id), role: "JUDGE" as const } : frozenParticipant(id)
      ])
    );

    const result = resolveProtocol(baseInput({ participantsByParticipantId }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/advocate-con-1/);
    expect(result.reason).toMatch(/role/i);
  });

  it("16: fails closed when the protocol's side disagrees with the persisted frozen participant's side", () => {
    const participantsByParticipantId = new Map(
      participantIds.map((id) => [
        id,
        id === "advocate-pro-2" ? { ...frozenParticipant(id), side: "CON" as const } : frozenParticipant(id)
      ])
    );

    const result = resolveProtocol(baseInput({ participantsByParticipantId }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toMatch(/advocate-pro-2/);
    expect(result.reason).toMatch(/side/i);
  });

  it("17: a valid protocol whose full frozen evidence agrees on role/side/modelId/promptVersion still resolves", () => {
    const result = resolveProtocol(baseInput());

    expect(result.ok).toBe(true);
  });

  it("never mutates the input protocolJsonRaw object", () => {
    const input = baseInput();
    const before = JSON.stringify(input.protocolJsonRaw);

    resolveProtocol(input);

    expect(JSON.stringify(input.protocolJsonRaw)).toBe(before);
  });
});
