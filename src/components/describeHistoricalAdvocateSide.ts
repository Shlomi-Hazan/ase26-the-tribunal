// PRO/CON semantic correction (Issue #30) -- the exhaustive, fail-closed
// historical display policy. Applied wherever a historical run's stored
// side (PRO/CON) is shown alongside its meaning: RunPage's participant/
// running display, the Advocate speech headings, the Protocol advocate
// list, and the Frozen Participant display.
//
// Locked contract (Issue #30 "Historical Display Decision"): a
// participant's persisted promptVersion is the sole selection key.
// advocate-v1 gets the LEGACY meaning; advocate-v2 gets the CORRECTED
// meaning; the true pre-M7 placeholder and any other unrecognized value
// get an explicit "semantics unavailable" fail-closed result -- NEVER a
// silent default to either meaning. This is a presentation-only concern:
// no stored side/speech/verdict/promptVersion is ever touched.
//
// Deliberately an exhaustive switch with a named branch per known
// version plus an explicit default, NOT a two-way
// `promptVersion === "advocate-v1" ? legacy : current` check and NOT an
// inverted `promptVersion !== "advocate-v1" -> current` check -- either
// of those would silently treat every other value (including the
// placeholder and any future/unknown version) as the current meaning.

export type AdvocateSide = "PRO" | "CON";

export type AdvocateSideDescription =
  | { kind: "legacy"; heading: string; description: string }
  | { kind: "current"; heading: string; description: string }
  | { kind: "unavailable"; message: string };

const CURRENT_HEADING: Record<AdvocateSide, string> = {
  PRO: "PRO — Defense",
  CON: "CON — Opposition"
};

const CURRENT_DESCRIPTION: Record<AdvocateSide, string> = {
  PRO: "Supports the defendant · argues NOT_GUILTY",
  CON: "Argues against the defendant · argues GUILTY"
};

const LEGACY_HEADING: Record<AdvocateSide, string> = {
  PRO: "PRO — Legacy semantics (advocate-v1)",
  CON: "CON — Legacy semantics (advocate-v1)"
};

const LEGACY_DESCRIPTION: Record<AdvocateSide, string> = {
  PRO: "Historical: assigned to argue for the charge (GUILTY)",
  CON: "Historical: assigned to argue against the charge (NOT_GUILTY)"
};

export function describeAdvocateSide(
  side: AdvocateSide,
  promptVersion: string
): AdvocateSideDescription {
  switch (promptVersion) {
    case "advocate-v1":
      return {
        kind: "legacy",
        heading: LEGACY_HEADING[side],
        description: LEGACY_DESCRIPTION[side]
      };
    case "advocate-v2":
      return {
        kind: "current",
        heading: CURRENT_HEADING[side],
        description: CURRENT_DESCRIPTION[side]
      };
    default:
      // Covers PROMPT_VERSION_PLACEHOLDER ("unassigned-pre-m7") and any
      // other unrecognized/future/corrupt value identically -- fail
      // closed, never inferred as either advocate-v1 or advocate-v2.
      return {
        kind: "unavailable",
        message: `Semantic mapping unavailable for prompt version "${promptVersion}".`
      };
  }
}
