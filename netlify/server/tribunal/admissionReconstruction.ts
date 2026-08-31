// Milestone 10 -- COMPLETED-run historical admission reconstruction
// (Issue #23). Pure, deterministic, read-time-only: reconstructs the
// exact whole-run admission bound a COMPLETED run's preflight computed at
// execution time, from persisted per-participant `conservative_max_cost_usd`
// values plus the immutable historical policy the run's own
// `protocols.schema_version` selects (economicsPolicyVersions.ts).
//
// Makes ZERO OpenRouter/model-discovery/provider calls -- it never
// consults current pricing, the current model catalog, or the current
// (mutable) runtime economics constants. Everything it needs is already
// on disk. If required evidence is missing or internally inconsistent,
// it returns `unavailable` rather than fabricating or silently
// substituting a value -- this is the FAILED-during-Advocates gap Issue
// #23's Option-1 decision explicitly leaves honest, not fixed.

import Decimal from "decimal.js";
import { participantIds, type ParticipantId } from "../../../src/schemas/tribunalSetup";
import { resolveEconomicsPolicyForProtocolSchemaVersion } from "./economicsPolicyVersions";

export type AdmissionReserveEvidence = {
  participantId: ParticipantId;
  // Every attempt row's own `conservative_max_cost_usd` for this
  // participant -- callers pass every retry row, not a pre-deduplicated
  // one, so this module can itself assert agreement (never trust the
  // caller to have already reconciled retries).
  conservativeMaxCostUsdByAttempt: Array<string | null>;
};

export type AdmissionReconstructionResult =
  | {
      available: true;
      economicsPolicyVersion: string;
      participantReserveSum: string;
      budgetSafetyFactor: string;
      authoritativeHistoricalBound: string;
      hardBudgetUsd: string;
      withinBudget: boolean;
    }
  | { available: false; reason: string };

export function reconstructCompletedRunAdmission(
  protocolSchemaVersion: string,
  reserveEvidence: AdmissionReserveEvidence[]
): AdmissionReconstructionResult {
  const policy = resolveEconomicsPolicyForProtocolSchemaVersion(protocolSchemaVersion);

  if (!policy) {
    return {
      available: false,
      reason: `No historical economics policy is registered for protocol schema version "${protocolSchemaVersion}".`
    };
  }

  // Require exactly the seven fixed logical participants -- never fewer
  // (a genuinely incomplete COMPLETED run's evidence is corrupt, not a
  // case to average around) and never more (a caller bug, not real data).
  const byParticipant = new Map(reserveEvidence.map((entry) => [entry.participantId, entry]));

  if (byParticipant.size !== participantIds.length) {
    return {
      available: false,
      reason: `Expected exactly ${participantIds.length} distinct logical participants with reserve evidence, found ${byParticipant.size}.`
    };
  }

  let participantReserveSum = new Decimal(0);

  for (const participantId of participantIds) {
    const entry = byParticipant.get(participantId);

    if (!entry || entry.conservativeMaxCostUsdByAttempt.length === 0) {
      return {
        available: false,
        reason: `No persisted admission reserve found for participant "${participantId}".`
      };
    }

    // Every retry row for this participant must agree on the reserve it
    // was claimed under (execution.ts's runLogicalCall passes the exact
    // same conservativeMaxCostUsd, unchanged, to both attempt #1 and #2's
    // claim -- so a disagreement is a genuine audit inconsistency, never
    // something to silently pick one value from).
    const distinctValues = new Set(entry.conservativeMaxCostUsdByAttempt);

    if (distinctValues.size !== 1 || entry.conservativeMaxCostUsdByAttempt[0] === null) {
      return {
        available: false,
        reason: `Participant "${participantId}"'s attempt rows do not agree on a single persisted admission reserve.`
      };
    }

    // One value per logical participant -- never summed once per attempt
    // row, which would double-count a retried participant's reserve.
    participantReserveSum = participantReserveSum.plus(
      new Decimal(entry.conservativeMaxCostUsdByAttempt[0] as string)
    );
  }

  const budgetSafetyFactor = new Decimal(policy.budgetSafetyFactor);
  const hardBudgetUsd = new Decimal(policy.hardBudgetUsd);
  const authoritativeHistoricalBound = participantReserveSum.times(budgetSafetyFactor);

  return {
    available: true,
    economicsPolicyVersion: policy.economicsPolicyVersion,
    participantReserveSum: participantReserveSum.toFixed(),
    budgetSafetyFactor: budgetSafetyFactor.toFixed(),
    authoritativeHistoricalBound: authoritativeHistoricalBound.toFixed(),
    hardBudgetUsd: hardBudgetUsd.toFixed(),
    withinBudget: authoritativeHistoricalBound.lte(hardBudgetUsd)
  };
}
