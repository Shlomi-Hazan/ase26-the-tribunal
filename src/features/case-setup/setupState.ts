import {
  allParticipants,
  defaultPersonalityByParticipant,
  mockModels,
  type ExecutionMode
} from "../../mocks/tribunalMockData";
import {
  chargeSheetLimits,
  personalityLimit,
  profileNameLimit,
  type CaseSourceType,
  type ChargeSheet,
  type ParticipantId,
  type PersonalitySource,
  type TribunalSetupDraft
} from "../../schemas/tribunalSetup";

export { chargeSheetLimits, personalityLimit, profileNameLimit };

type ParticipantConfig = {
  profileName: string;
  personality: string;
  personalitySource: PersonalitySource;
  personalitySourceFilename?: string;
  modelId: string;
};

// Milestone 6: identity of the last successfully saved case, recorded so
// Convene can decide whether to reuse it (case.kind = "existing") or save
// a fresh one (case.kind = "new") -- see
// docs/adr/0002-participant-configuration-freeze.md Decision 8 and
// isSavedCaseCurrent below. This is browser-side UX convenience only; the
// server always independently validates whichever branch it receives.
export type SavedCaseIdentity = {
  id: string;
  chargeSheet: ChargeSheet;
  caseSource: {
    type: CaseSourceType;
    filename?: string;
  };
};

// Setup stepper indices, in the fixed linear order the workflow always
// follows: Charge Sheet -> Advocates -> Judges -> Review. Shared between
// SetupStepper (rendering) and the pages that dispatch "advanceFurthestStep"
// on a genuine forward transition, so neither has to hard-code magic
// numbers independently.
export const SETUP_STEP_INDEX = {
  CHARGE_SHEET: 0,
  ADVOCATES: 1,
  JUDGES: 2,
  REVIEW: 3
} as const;

export type SetupState = {
  chargeSheet: ChargeSheet;
  caseSource: {
    type: CaseSourceType;
    filename?: string;
  };
  importNotice: string;
  executionMode: ExecutionMode;
  sharedModelId: string;
  participants: Record<ParticipantId, ParticipantConfig>;
  savedCase: SavedCaseIdentity | null;
  // Highest setup-step index the user has actually REACHED via a genuine
  // forward transition (a validated Continue/Review Tribunal click, or a
  // successful Full Tribunal Package import) -- never via route position
  // alone. This is "reached," not "completed": the instant Continue to
  // Advocates fires, this becomes ADVOCATES even though Advocates' own
  // data has never itself been confirmed by leaving it forward. A step
  // only counts as *completed* once some LATER step has been reached
  // (SetupStepper compares with strict "<", not "<="), so pressing Back
  // immediately after reaching a step -- without ever confirming it --
  // correctly does not mark it Complete. Distinct from "this step's
  // current data is valid": the SetupStepper's Complete badge requires the
  // step to have been left forward, to still be currently valid, and to
  // not be the active step, so it cannot show Complete merely because
  // default participant data happens to already be valid, and it stays
  // accurate if previously-valid data is edited into an invalid state and
  // back again. Only ever increases (never reset by back-navigation), so
  // completion history survives normal setup back-navigation.
  furthestReachedStepIndex: number;
};

export type SetupAction =
  | { type: "setChargeField"; field: keyof ChargeSheet; value: string }
  | { type: "applyChargeSheetImport"; chargeSheet: ChargeSheet; filename: string }
  | { type: "applyTribunalPackageImport"; draft: TribunalSetupDraft }
  | { type: "clearImportNotice" }
  | { type: "setExecutionMode"; mode: ExecutionMode }
  | { type: "setSharedModel"; modelId: string }
  | { type: "setParticipantProfileName"; participantId: ParticipantId; value: string }
  | { type: "setParticipantPersonality"; participantId: ParticipantId; value: string }
  | {
      type: "applyParticipantPersonalityImport";
      participantId: ParticipantId;
      personality: string;
      filename: string;
    }
  | { type: "setParticipantModel"; participantId: ParticipantId; modelId: string }
  | { type: "recordSavedCase"; id: string }
  | { type: "advanceFurthestStep"; index: number };

export type SetupContextValue = {
  state: SetupState;
  dispatch: React.Dispatch<SetupAction>;
};

const defaultModelId = mockModels[0].id;

const initialParticipants = allParticipants.reduce(
  (configs, participant, index) => ({
    ...configs,
    [participant.id]: {
      profileName: "",
      personality: defaultPersonalityByParticipant[participant.id],
      personalitySource: "manual",
      modelId: mockModels[index % mockModels.length].id
    }
  }),
  {} as SetupState["participants"]
);

export const initialSetupState: SetupState = {
  chargeSheet: {
    defendant: "",
    act: "",
    exactQuestion: ""
  },
  caseSource: {
    type: "MANUAL"
  },
  importNotice: "",
  executionMode: "shared",
  sharedModelId: defaultModelId,
  participants: initialParticipants,
  savedCase: null,
  // Charge Sheet (index 0) is the starting page, trivially "reached", but
  // -- being the currently active step -- never shows Complete regardless.
  // Nothing past it has been reached yet on a fresh setup, even though the
  // default advocate/judge personalities are already valid.
  furthestReachedStepIndex: SETUP_STEP_INDEX.CHARGE_SHEET
};

export function setupReducer(state: SetupState, action: SetupAction): SetupState {
  switch (action.type) {
    case "setChargeField":
      return {
        ...state,
        chargeSheet: {
          ...state.chargeSheet,
          [action.field]: action.value
        },
        caseSource: {
          type: "MANUAL"
        },
        importNotice: ""
      };
    case "applyChargeSheetImport":
      return {
        ...state,
        chargeSheet: action.chargeSheet,
        caseSource: {
          type: "CHARGE_SHEET_FILE",
          filename: action.filename
        },
        importNotice: "Imported Charge Sheet — review the fields before continuing."
      };
    case "applyTribunalPackageImport":
      return {
        ...state,
        chargeSheet: action.draft.chargeSheet,
        caseSource: action.draft.importSource,
        importNotice:
          "Imported Tribunal package — review all extracted fields before convening.",
        participants: Object.fromEntries(
          allParticipants.map((participant) => {
            const imported = action.draft.participants[participant.id];

            return [
              participant.id,
              {
                ...state.participants[participant.id],
                profileName: imported.profileName ?? "",
                personality: imported.personality,
                personalitySource: imported.personalitySource,
                personalitySourceFilename: imported.personalitySourceFilename
              }
            ];
          })
        ) as SetupState["participants"],
        // A successful package import validly populates the Charge Sheet
        // and all seven participants and lands the user on Review -- the
        // same forward-progression outcome as walking Continue -> Continue
        // -> Review Tribunal by hand, so it marks the same steps reached.
        // An import that fails never reaches this reducer case at all (the
        // page only dispatches on success), so an invalid package cannot
        // advance completion.
        furthestReachedStepIndex: Math.max(
          state.furthestReachedStepIndex,
          SETUP_STEP_INDEX.REVIEW
        )
      };
    case "clearImportNotice":
      return {
        ...state,
        importNotice: ""
      };
    case "setExecutionMode":
      return {
        ...state,
        executionMode: action.mode
      };
    case "setSharedModel":
      return {
        ...state,
        sharedModelId: action.modelId
      };
    case "setParticipantProfileName":
      return {
        ...state,
        participants: {
          ...state.participants,
          [action.participantId]: {
            ...state.participants[action.participantId],
            profileName: action.value
          }
        }
      };
    case "setParticipantPersonality":
      return {
        ...state,
        participants: {
          ...state.participants,
          [action.participantId]: {
            ...state.participants[action.participantId],
            personality: action.value,
            personalitySource: "manual",
            personalitySourceFilename: undefined
          }
        }
      };
    case "applyParticipantPersonalityImport":
      return {
        ...state,
        participants: {
          ...state.participants,
          [action.participantId]: {
            ...state.participants[action.participantId],
            personality: action.personality,
            personalitySource: "individual_file",
            personalitySourceFilename: action.filename
          }
        }
      };
    case "setParticipantModel":
      return {
        ...state,
        participants: {
          ...state.participants,
          [action.participantId]: {
            ...state.participants[action.participantId],
            modelId: action.modelId
          }
        }
      };
    case "recordSavedCase":
      return {
        ...state,
        savedCase: {
          id: action.id,
          chargeSheet: state.chargeSheet,
          caseSource: state.caseSource
        }
      };
    case "advanceFurthestStep":
      // Only ever grows -- dispatched exclusively from validated forward
      // transitions (see SETUP_STEP_INDEX callers), never from route
      // position, so simply visiting a route directly can never advance
      // it, and normal back-navigation never regresses it.
      return {
        ...state,
        furthestReachedStepIndex: Math.max(
          state.furthestReachedStepIndex,
          action.index
        )
      };
    default:
      return state;
  }
}

// Milestone 6: a saved case is only safe to reuse (case.kind = "existing")
// while the currently-displayed Charge Sheet/source metadata exactly
// matches what was actually saved. Any edit to those fields since the
// last successful Save Case -- including a fresh Charge Sheet or Full
// Tribunal Package import, which both update chargeSheet/caseSource --
// makes this return false automatically, with no separate invalidation
// action required. Participant/personality/model edits never affect
// this, since they do not change case identity/content.
export function isSavedCaseCurrent(state: SetupState): boolean {
  if (!state.savedCase) {
    return false;
  }

  return (
    state.savedCase.chargeSheet.defendant === state.chargeSheet.defendant &&
    state.savedCase.chargeSheet.act === state.chargeSheet.act &&
    state.savedCase.chargeSheet.exactQuestion === state.chargeSheet.exactQuestion &&
    state.savedCase.caseSource.type === state.caseSource.type &&
    state.savedCase.caseSource.filename === state.caseSource.filename
  );
}

export function validateChargeSheet(chargeSheet: ChargeSheet) {
  return {
    defendant: validateTextField(
      "Defendant",
      chargeSheet.defendant,
      chargeSheetLimits.defendant
    ),
    act: validateTextField("Act", chargeSheet.act, chargeSheetLimits.act),
    exactQuestion: validateTextField(
      "Exact Question",
      chargeSheet.exactQuestion,
      chargeSheetLimits.exactQuestion
    )
  };
}

export function validateParticipantPersonality(value: string) {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return "Personality is required.";
  }

  if (trimmed.length > personalityLimit) {
    return `Personality must be ${personalityLimit.toLocaleString()} characters or fewer.`;
  }

  return "";
}

export function validateParticipantProfileName(value: string) {
  const trimmed = value.trim();

  if (trimmed.length > profileNameLimit) {
    return `Profile name must be ${profileNameLimit.toLocaleString()} characters or fewer.`;
  }

  return "";
}

export function isChargeSheetValid(chargeSheet: ChargeSheet) {
  return Object.values(validateChargeSheet(chargeSheet)).every((error) => !error);
}

function areParticipantsValid(
  state: SetupState,
  participantIds: ParticipantId[]
) {
  return participantIds.every(
    (participantId) =>
      !validateParticipantPersonality(
        state.participants[participantId].personality
      ) &&
      !validateParticipantProfileName(
        state.participants[participantId].profileName
      )
  );
}

export function areAdvocatePersonalitiesValid(state: SetupState) {
  return areParticipantsValid(
    state,
    allParticipants
      .filter((participant) => participant.kind === "advocate")
      .map((participant) => participant.id)
  );
}

export function areJudgePersonalitiesValid(state: SetupState) {
  return areParticipantsValid(
    state,
    allParticipants
      .filter((participant) => participant.kind === "judge")
      .map((participant) => participant.id)
  );
}

export function isMockSetupReady(state: SetupState) {
  return (
    isChargeSheetValid(state.chargeSheet) &&
    areAdvocatePersonalitiesValid(state) &&
    areJudgePersonalitiesValid(state)
  );
}

function validateTextField(label: string, value: string, limit: number) {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return `${label} is required.`;
  }

  if (trimmed.length > limit) {
    return `${label} must be ${limit.toLocaleString()} characters or fewer.`;
  }

  return "";
}
