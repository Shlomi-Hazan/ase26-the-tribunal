import type {
  CaseSourceType,
  ChargeSheet,
  ParticipantId,
  PersonalitySource
} from "../schemas/tribunalSetup";

export type RunCaseRequest =
  | { kind: "existing"; caseId: string }
  | {
      kind: "new";
      case: ChargeSheet & { sourceType: CaseSourceType; sourceFilename?: string };
    };

export type RunParticipantRequest = {
  participantId: ParticipantId;
  profileName?: string;
  personality: string;
  personalitySource: PersonalitySource;
  personalitySourceFilename?: string;
  modelId: string;
};

export type CreateRunRequest = {
  clientRequestId: string;
  case: RunCaseRequest;
  executionMode: "shared" | "separate";
  participants: RunParticipantRequest[];
};

export type PersistedRunParticipant = {
  participantId: ParticipantId;
  role: "ADVOCATE" | "JUDGE";
  side: "PRO" | "CON" | null;
  profileName: string | null;
  personality: string;
  personalitySource: PersonalitySource;
  personalitySourceFilename: string | null;
  modelId: string;
  promptVersion: string;
};

export type StoredRun = {
  id: string;
  caseId: string;
  executionMode: "shared" | "separate";
  status: string;
  createdAt: string;
  participants: PersistedRunParticipant[];
};

type RunResponse = {
  run: StoredRun;
};

type ErrorResponse = {
  error?: string;
  errors?: string[];
};

export class RunApiError extends Error {
  readonly status: number;
  readonly errorCode: string;
  readonly errors: string[];

  constructor(status: number, errorCode: string, errors: string[]) {
    super(errors.length ? errors.join(" ") : errorCode);
    this.name = "RunApiError";
    this.status = status;
    this.errorCode = errorCode;
    this.errors = errors;
  }
}

export async function convene(request: CreateRunRequest): Promise<StoredRun> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });

  return parseRunResponse(response);
}

export async function getRun(runId: string): Promise<StoredRun | null> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);

  if (response.status === 404) {
    return null;
  }

  return parseRunResponse(response);
}

async function parseRunResponse(response: Response): Promise<StoredRun> {
  const payload = (await response.json().catch(() => ({}))) as
    | RunResponse
    | ErrorResponse;

  if (!response.ok) {
    const errorPayload = payload as ErrorResponse;

    throw new RunApiError(
      response.status,
      errorPayload.error ?? "run_request_failed",
      errorPayload.errors ?? []
    );
  }

  return (payload as RunResponse).run;
}
