// Milestone 8 -- deterministic majority (SPEC.md Sec 12, OUT-007/OUT-008).
// Plain code, no model call. Callers must only invoke this once exactly
// three valid judge verdicts exist -- the type signature enforces the
// count; there is no "partial majority" concept.

export type Verdict = "GUILTY" | "NOT_GUILTY";

export function computeMajorityVerdict(verdicts: [Verdict, Verdict, Verdict]): Verdict {
  const guiltyCount = verdicts.filter((verdict) => verdict === "GUILTY").length;

  return guiltyCount >= 2 ? "GUILTY" : "NOT_GUILTY";
}
