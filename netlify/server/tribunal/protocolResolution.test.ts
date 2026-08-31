// Milestone 10 -- deterministic Tribunal protocol validation and
// read-time resolution (Issue #23). Never mutates persistence, never
// makes a model call; a mismatch fails closed rather than being repaired.

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

function baseInput(overrides: Partial<ResolveProtocolInput> = {}): ResolveProtocolInput {
  const participantsByParticipantId = new Map<ParticipantId, { profileName: string | null; personality: string }>(
    participantIds.map((id) => [id, { profileName: null, personality: "A measured demeanor." }])
  );
  const reasoningByParticipantId = new Map<ParticipantId, string>([
    ["judge-1", "Judge I reasoning."],
    ["judge-2", "Judge II reasoning."],
    ["judge-3", "Judge III reasoning."]
  ]);

  return {
    storedSchemaVersion: "tribunal-protocol-v1",
    protocolJsonRaw: validProtocolJson(),
    run: { id: RUN_ID, caseId: CASE_ID, executionMode: "shared", majorityVerdict: "GUILTY" },
    chargeSheet: { defendant: "Alex Rowan", act: "Sold a mislabeled cake.", exactQuestion: "Did Alex know?" },
    participantsByParticipantId,
    reasoningByParticipantId,
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

  it("never mutates the input protocolJsonRaw object", () => {
    const input = baseInput();
    const before = JSON.stringify(input.protocolJsonRaw);

    resolveProtocol(input);

    expect(JSON.stringify(input.protocolJsonRaw)).toBe(before);
  });
});
