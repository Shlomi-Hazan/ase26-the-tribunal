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
  | { type: "setParticipantModel"; participantId: ParticipantId; modelId: string };

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
  participants: initialParticipants
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
        ) as SetupState["participants"]
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
    default:
      return state;
  }
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
