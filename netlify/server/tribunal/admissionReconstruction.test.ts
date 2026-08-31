// Milestone 10 -- COMPLETED-run historical admission reconstruction
// (Issue #23). Deterministic, zero network calls.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reconstructCompletedRunAdmission, type AdmissionReserveEvidence } from "./admissionReconstruction";
import { participantIds } from "../../../src/schemas/tribunalSetup";

// Mirrors the real M9 live-gate run's shape (7960fc37...): PRO I on a
// distinct model with its own reserve, the other six sharing another
// model's reserve -- proves Shared/Separate parity for the reconstruction
// itself needs no special-casing.
function sevenParticipantEvidence(overrides: Partial<Record<string, string>> = {}): AdmissionReserveEvidence[] {
  const defaultReserve = "0.00098076";

  return participantIds.map((participantId) => ({
    participantId,
    conservativeMaxCostUsdByAttempt: [overrides[participantId] ?? defaultReserve]
  }));
}

describe("reconstructCompletedRunAdmission (Milestone 10, Issue #23)", () => {
  it("reconstructs the exact historical bound for a full seven-participant COMPLETED run", () => {
    const evidence = sevenParticipantEvidence({
      "advocate-pro-1": "0.00108196"
    });

    const result = reconstructCompletedRunAdmission("tribunal-protocol-v1", evidence);

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.economicsPolicyVersion).toBe("tribunal-economics-policy-v1");
    expect(result.hardBudgetUsd).toBe("5");
    expect(result.budgetSafetyFactor).toBe("1.1");
    // 0.00108196 + 6 * 0.00098076 = 0.00696652
    expect(result.participantReserveSum).toBe("0.00696652");
    expect(result.authoritativeHistoricalBound).toBe("0.007663172");
    expect(result.withinBudget).toBe(true);
  });

  it("does not double-count a retried participant's reserve", () => {
    const evidence = sevenParticipantEvidence();
    const proI = evidence.find((entry) => entry.participantId === "advocate-pro-1")!;

    // Same participant, two attempt rows, identical reserve -- exactly
    // how execution.ts's runLogicalCall claims both attempts.
    proI.conservativeMaxCostUsdByAttempt = ["0.00098076", "0.00098076"];

    const result = reconstructCompletedRunAdmission("tribunal-protocol-v1", evidence);

    expect(result.available).toBe(true);
    if (!result.available) return;

    // Still exactly 7 x 0.00098076, not 8x.
    expect(result.participantReserveSum).toBe("0.00686532");
  });

  it("flags disagreeing retry-row reserves as an audit inconsistency, never silently picking one", () => {
    const evidence = sevenParticipantEvidence();
    const proI = evidence.find((entry) => entry.participantId === "advocate-pro-1")!;

    proI.conservativeMaxCostUsdByAttempt = ["0.00098076", "0.00099999"];

    const result = reconstructCompletedRunAdmission("tribunal-protocol-v1", evidence);

    expect(result.available).toBe(false);
    if (result.available) return;

    expect(result.reason).toMatch(/do not agree/i);
  });

  it("returns unavailable when fewer than seven participants have reserve evidence (e.g. FAILED-during-advocates)", () => {
    const evidence = sevenParticipantEvidence().filter(
      (entry) => entry.participantId.startsWith("advocate")
    );

    const result = reconstructCompletedRunAdmission("tribunal-protocol-v1", evidence);

    expect(result.available).toBe(false);
    if (result.available) return;

    expect(result.reason).toMatch(/expected exactly 7/i);
  });

  it("returns unavailable for an unrecognized protocol schema version, never assuming V1", () => {
    const result = reconstructCompletedRunAdmission("tribunal-protocol-v2", sevenParticipantEvidence());

    expect(result.available).toBe(false);
    if (result.available) return;

    expect(result.reason).toMatch(/no historical economics policy/i);
  });

  it("changing the CURRENT runtime economics constants does not change the V1 fixture result", () => {
    // Structural: this module resolves policy exclusively through
    // economicsPolicyVersions.ts, which never imports the mutable runtime
    // constants (proven separately) -- so this test just re-confirms the
    // observable result is the fixed V1 figures regardless of what the
    // current constants module happens to export today.
    const result = reconstructCompletedRunAdmission("tribunal-protocol-v1", sevenParticipantEvidence());

    expect(result.available).toBe(true);
    if (!result.available) return;

    expect(result.hardBudgetUsd).toBe("5");
    expect(result.budgetSafetyFactor).toBe("1.1");
  });

  it("makes zero network/provider calls (structural -- no fetch/global reference in this module)", () => {
    const source = readFileSync(path.resolve(__dirname, "admissionReconstruction.ts"), "utf8");

    expect(source).not.toMatch(/fetch\(|OpenRouterProvider|listModels|listEndpoints/);
  });
});
