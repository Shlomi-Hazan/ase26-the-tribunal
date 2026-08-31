// Milestone 10 -- the immutable historical economics-policy registry
// (Issue #23, "Economics Policy Versioning" -- second independent review
// correction). A COMPLETED run's admission decision was made once, at
// execution time, against the run's OWN policy -- but the actual bound
// compared against `$5.00` at that moment was never persisted as a single
// value (only each participant's own conservative reserve was, on
// `model_call_attempts.conservative_max_cost_usd`). To let a reviewer
// reconstruct that decision from the Result screen alone -- not by
// locating a historical source commit -- this module fixes, permanently,
// what "the policy" meant for every run admitted under a given
// `protocols.schema_version`.
//
// DELIBERATE ISOLATION (locked, Issue #23): this module must NEVER import
// `./economicsConstants` (or read from it in any other way). That module
// holds the CURRENT, mutable runtime policy -- what a NEW run is admitted
// under today. This module holds the HISTORICAL, frozen record of what
// EXISTING completed runs were admitted under. The two are allowed to
// diverge the instant a future milestone changes the current constants;
// this module's job is to make sure that divergence never silently
// changes how an already-completed run's admission is explained. Every
// entry below is a permanently frozen literal, deliberately re-typed by
// hand rather than imported from anywhere that could ever change.
//
// FORWARD RULE (locked): a future semantic change to
// MAX_RUN_COST_USD/BUDGET_SAFETY_FACTOR/MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL
// must mint a NEW policy version here (e.g. `tribunal-economics-policy-v2`)
// with its own new entry, and new completed runs must carry an
// unambiguous new selector distinguishing them from V1 runs -- either a
// new protocol schema version (if the protocol schema also changes) or a
// future, separately-persisted economics-policy selector (if the
// protocol schema stays structurally identical). That forward write-path
// design is explicitly out of scope for Milestone 10 -- this module only
// ever grows by addition; `ECONOMICS_POLICY_V1`'s three values below must
// never be edited once a real run exists under them.

export type EconomicsPolicy = {
  economicsPolicyVersion: "tribunal-economics-policy-v1";
  hardBudgetUsd: string;
  budgetSafetyFactor: string;
  maxProviderAttemptsPerLogicalCall: number;
};

// Permanently frozen. Every M8/M9 COMPLETED run (and every M10-forward
// run whose `protocols.schema_version` is still `"tribunal-protocol-v1"`)
// was admitted under exactly this policy -- matches
// `economicsConstants.ts`'s CURRENT values at the time of writing only by
// coincidence of timing, never by reference.
export const ECONOMICS_POLICY_V1: EconomicsPolicy = {
  economicsPolicyVersion: "tribunal-economics-policy-v1",
  hardBudgetUsd: "5.00",
  budgetSafetyFactor: "1.10",
  maxProviderAttemptsPerLogicalCall: 2
};

// The only selector that exists today: `protocols.schema_version`, already
// persisted on every completed run. Resolving an unrecognized/future
// schema version returns `undefined` -- callers must fail closed
// (`admission: Unavailable`), never silently assume V1.
const ECONOMICS_POLICY_BY_PROTOCOL_SCHEMA_VERSION: Readonly<Record<string, EconomicsPolicy>> = {
  "tribunal-protocol-v1": ECONOMICS_POLICY_V1
};

export function resolveEconomicsPolicyForProtocolSchemaVersion(
  protocolSchemaVersion: string
): EconomicsPolicy | undefined {
  return ECONOMICS_POLICY_BY_PROTOCOL_SCHEMA_VERSION[protocolSchemaVersion];
}
