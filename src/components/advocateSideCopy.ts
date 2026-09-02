// PRO/CON semantic correction (Issue #30) -- the locked, current
// human-facing explanation of what PRO/CON mean, shared by every setup
// UI surface (ParticipantCard, ReviewPage) so wording never diverges
// between screens. docs/ui-spec.md requires this meaning be written in
// text, never signaled by color alone -- PRO/CON structural identifiers
// are preserved; only their explanation is added here.
//
// This is the CURRENT-only meaning (advocate-v2). It must never be used
// to caption a historical run's participant -- see
// src/components/describeHistoricalAdvocateSide.ts for the version-aware,
// fail-closed policy historical surfaces (RunPage) use instead.

export type AdvocateSide = "PRO" | "CON";

export const CURRENT_ADVOCATE_SIDE_HEADING: Record<AdvocateSide, string> = {
  PRO: "PRO — Defense",
  CON: "CON — Opposition"
};

export const CURRENT_ADVOCATE_SIDE_DESCRIPTION: Record<AdvocateSide, string> = {
  PRO: "Supports the defendant · argues NOT_GUILTY",
  CON: "Argues against the defendant · argues GUILTY"
};
