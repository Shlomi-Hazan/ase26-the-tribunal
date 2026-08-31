// Milestone 10 -- economics policy versioning (Issue #23 second review
// pass). Locks the exact permanent V1 mapping and proves it is isolated
// from the current, mutable runtime economics constants.
//
// Corrected (independent source audit, Finding 2): the previous version
// of this file imported the CURRENT, mutable `economicsConstants.ts` and
// asserted its values equal V1's historical literals -- exactly the
// future coupling this registry exists to avoid (a legitimate future
// runtime policy change would have broken this historical fixture test
// for no real reason). Removed. This file now only pins V1's own literal
// values, proves the module never imports economicsConstants.ts at all
// (structural independence), and proves the registry is materially
// immutable at runtime (Object.freeze), not merely `const`-bound.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ECONOMICS_POLICY_V1,
  resolveEconomicsPolicyForProtocolSchemaVersion
} from "./economicsPolicyVersions";

describe("economics policy versioning (Milestone 10, Issue #23)", () => {
  it("tribunal-protocol-v1 resolves to exactly tribunal-economics-policy-v1", () => {
    const policy = resolveEconomicsPolicyForProtocolSchemaVersion("tribunal-protocol-v1");

    expect(policy?.economicsPolicyVersion).toBe("tribunal-economics-policy-v1");
  });

  it("ECONOMICS_POLICY_V1 means exactly the historical M8/M9 admission policy -- a fixed literal, never derived", () => {
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

  it("source-boundary proof: economicsPolicyVersions.ts never IMPORTS economicsConstants.ts (mentioning it in a comment is fine)", () => {
    const source = readFileSync(path.resolve(__dirname, "economicsPolicyVersions.ts"), "utf8");

    expect(source).not.toMatch(/from\s+["'].*economicsConstants["']/);
  });

  it("is materially immutable at runtime, not merely const-bound: Object.isFrozen is true", () => {
    expect(Object.isFrozen(ECONOMICS_POLICY_V1)).toBe(true);
  });

  it("an attempted mutation never changes the historical values (throws in strict mode; value is unchanged either way)", () => {
    const before = { ...ECONOMICS_POLICY_V1 };

    expect(() => {
      // @ts-expect-error -- readonly at the type level too; this line
      // exists specifically to prove the runtime freeze also holds.
      ECONOMICS_POLICY_V1.hardBudgetUsd = "50.00";
    }).toThrow();

    expect(ECONOMICS_POLICY_V1).toEqual(before);
    expect(ECONOMICS_POLICY_V1.hardBudgetUsd).toBe("5.00");
  });

  it("resolveEconomicsPolicyForProtocolSchemaVersion returns a frozen object for a recognized version", () => {
    const policy = resolveEconomicsPolicyForProtocolSchemaVersion("tribunal-protocol-v1");

    expect(policy).toBeDefined();
    expect(Object.isFrozen(policy)).toBe(true);
  });
});
