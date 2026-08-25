import {
  allParticipants,
  defaultPersonalityByParticipant,
  mockModels,
  type ExecutionMode,
  type ParticipantId
} from "../../mocks/tribunalMockData";

export const chargeSheetLimits = {
  defendant: 200,
  act: 6000,
  exactQuestion: 1000
} as const;

export const personalityLimit = 4000;

type ChargeSheet = {
  defendant: string;
  act: string;
  exactQuestion: string;
};

type ParticipantConfig = {
  personality: string;
  modelId: string;
};

export type SetupState = {
  chargeSheet: ChargeSheet;
  executionMode: ExecutionMode;
  sharedModelId: string;
  participants: Record<ParticipantId, ParticipantConfig>;
};

export type SetupAction =
  | { type: "setChargeField"; field: keyof ChargeSheet; value: string }
  | { type: "setExecutionMode"; mode: ExecutionMode }
  | { type: "setSharedModel"; modelId: string }
  | { type: "setParticipantPersonality"; participantId: ParticipantId; value: string }
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
      personality: defaultPersonalityByParticipant[participant.id],
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
        }
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
    case "setParticipantPersonality":
      return {
        ...state,
        participants: {
          ...state.participants,
          [action.participantId]: {
            ...state.participants[action.participantId],
            personality: action.value
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

export function isChargeSheetValid(chargeSheet: ChargeSheet) {
  return Object.values(validateChargeSheet(chargeSheet)).every((error) => !error);
}

function areParticipantPersonalitiesValid(
  state: SetupState,
  participantIds: ParticipantId[]
) {
  return participantIds.every(
    (participantId) =>
      !validateParticipantPersonality(state.participants[participantId].personality)
  );
}

export function areAdvocatePersonalitiesValid(state: SetupState) {
  return areParticipantPersonalitiesValid(
    state,
    allParticipants
      .filter((participant) => participant.kind === "advocate")
      .map((participant) => participant.id)
  );
}

export function areJudgePersonalitiesValid(state: SetupState) {
  return areParticipantPersonalitiesValid(
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
