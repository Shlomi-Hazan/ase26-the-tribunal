// Milestone 10 -- economics policy versioning (Issue #23 second review
// pass). Locks the exact permanent V1 mapping and proves it is isolated
// from the current, mutable runtime economics constants.

import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import {
  ECONOMICS_POLICY_V1,
  resolveEconomicsPolicyForProtocolSchemaVersion
} from "./economicsPolicyVersions";
import { MAX_RUN_COST_USD, BUDGET_SAFETY_FACTOR } from "../openrouter/economicsConstants";
import { readFileSync } from "node:fs";
import path from "node:path";

describe("economics policy versioning (Milestone 10, Issue #23)", () => {
  it("tribunal-protocol-v1 resolves to exactly tribunal-economics-policy-v1", () => {
    const policy = resolveEconomicsPolicyForProtocolSchemaVersion("tribunal-protocol-v1");

    expect(policy?.economicsPolicyVersion).toBe("tribunal-economics-policy-v1");
  });

  it("ECONOMICS_POLICY_V1 means exactly the historical M8/M9 admission policy", () => {
    expect(ECONOMICS_POLICY_V1).toEqual({
      economicsPolicyVersion: "tribunal-economics-policy-v1",
      hardBudgetUsd: "5.00",
      budgetSafetyFactor: "1.10",
      maxProviderAttemptsPerLogicalCall: 2
    });
  });

  it("an unrecognized protocol schema version fails closed (undefined, never a silent V1 default)", () => {
    expect(resolveEconomicsPolicyForProtocolSchemaVersion("tribunal-protocol-v2")).toBeUndefined();
    expect(resolveEconomicsPolicyForProtocolSchemaVersion("")).toBeUndefined();
  });

  it("ECONOMICS_POLICY_V1 stays fixed even if the CURRENT runtime economics constants change", () => {
    // Structural proof, not a mutation test: the current runtime module's
    // exported values happen to match V1 today, but this module must not
    // be the SOURCE of that agreement -- confirmed by the source-boundary
    // test below (this module's own source never imports
    // economicsConstants.ts at all). This value-level check just pins
    // today's coincidental agreement so a future intentional divergence
    // is visible in review, not silently absorbed.
    expect(new Decimal(ECONOMICS_POLICY_V1.hardBudgetUsd).equals(MAX_RUN_COST_USD)).toBe(true);
    expect(new Decimal(ECONOMICS_POLICY_V1.budgetSafetyFactor).equals(BUDGET_SAFETY_FACTOR)).toBe(true);
  });

  it("source-boundary proof: economicsPolicyVersions.ts never IMPORTS economicsConstants.ts (mentioning it in a comment is fine)", () => {
    const source = readFileSync(path.resolve(__dirname, "economicsPolicyVersions.ts"), "utf8");

    expect(source).not.toMatch(/from\s+["'].*economicsConstants["']/);
  });
});
