import { allParticipants } from "../mocks/tribunalMockData";
import type { ParticipantId } from "../schemas/tribunalSetup";

// Human product decision (PR #34, product-wide correction, prompted by
// observing the M12 Jon Snow live gate but NOT specific to it): for
// EVERY real Tribunal run, a participant's persisted profileName --
// already part of PersistedRunParticipant, src/services/runApi.ts -- is
// the primary human-visible identity whenever it is meaningfully set;
// the structural seat (e.g. "PRO I", "Judge I") is secondary context,
// never dropped. This is the single, centralized rule -- every real-run
// participant-identity display site (the live grid, completed advocate
// speeches, judge votes, judge reasoning, attempt audit) calls this same
// function rather than repeating `profileName || label` ad hoc.
//
// Historical compatibility (no schema/persistence change): a run frozen
// before profileName was ever collected, or one where it was left
// blank, has profileName === null or "" -- both, and any whitespace-only
// value, fall back to the existing generic seat label as the sole
// (primary, no secondary) identity, exactly as every run displayed
// before this correction.
export type ParticipantIdentity = {
  primary: string;
  // null when there is no meaningful profileName to distinguish from
  // the primary -- callers must never render a redundant second line
  // duplicating the same text as primary in that case.
  secondarySeatLabel: string | null;
};

export function resolveParticipantIdentity(
  profileName: string | null | undefined,
  seatLabel: string
): ParticipantIdentity {
  const trimmed = profileName?.trim();

  if (trimmed) {
    return { primary: trimmed, secondarySeatLabel: seatLabel };
  }

  return { primary: seatLabel, secondarySeatLabel: null };
}

// Final independent-review correction: the human seat label ("PRO I",
// "Judge I", ...) -- never the raw technical participantId
// ("advocate-pro-1") -- is the correct secondary identity for a real
// participant. Centralized here (reusing allParticipants, the SAME
// canonical seat list already used elsewhere for exactly this purpose,
// never a second/duplicated mapping) so every call site resolves a
// participantId to its seat label the same way.
const SEAT_LABEL_BY_PARTICIPANT_ID: Record<ParticipantId, string> = Object.fromEntries(
  allParticipants.map((entry) => [entry.id, entry.label])
) as Record<ParticipantId, string>;

export function getSeatLabel(participantId: ParticipantId): string {
  return SEAT_LABEL_BY_PARTICIPANT_ID[participantId];
}
