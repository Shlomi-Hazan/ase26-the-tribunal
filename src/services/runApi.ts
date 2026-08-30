import type {
  CaseSourceType,
  ChargeSheet,
  ParticipantId,
  PersonalitySource
} from "../schemas/tribunalSetup";
import { withUserOpenRouterKeyHeader } from "./openRouterCredential";

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

export type ParticipantAttemptStatus = "PENDING" | "RUNNING" | "RETRYING" | "SUCCESS" | "FAILED";

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
  // Milestone 8
  attemptStatus: ParticipantAttemptStatus;
  speech: string | null;
  verdict: "GUILTY" | "NOT_GUILTY" | null;
  reasoning: string | null;
};

export type StoredRun = {
  id: string;
  caseId: string;
  executionMode: "shared" | "separate";
  status: string;
  createdAt: string;
  // Milestone 8 -- null on a still-READY run.
  startedAt: string | null;
  completedAt: string | null;
  majorityVerdict: "GUILTY" | "NOT_GUILTY" | null;
  failureCode: string | null;
  failureMessage: string | null;
  totalCostUsd: string | null;
  advocateCostUsd: string | null;
  judgeCostUsd: string | null;
  participants: PersistedRunParticipant[];
};

type RunResponse = {
  run: StoredRun;
  // Milestone 8: present only on the POST /api/runs response -- true only
  // when this exact request's synchronous preflight passed and the
  // Background Function was actually invoked (never inferred from the
  // run's own possibly-not-yet-updated status, since the worker's own
  // claim happens asynchronously after this response).
  executionTriggered?: boolean;
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

// Milestone 8: forwards the connected user's OpenRouter credential
// (sessionStorage-only, request-scoped) as a header -- attaches nothing
// when not connected, in which case the server freezes the run but never
// triggers execution (SPEC.md/M7A BYOK boundary, reused unchanged).
export type ConveneResult = { run: StoredRun; executionTriggered: boolean };

export async function convene(request: CreateRunRequest): Promise<ConveneResult> {
  const response = await fetch("/api/runs", {
    method: "POST",
    headers: withUserOpenRouterKeyHeader({
      "content-type": "application/json"
    }),
    body: JSON.stringify(request)
  });

  const payload = await parseRunPayload(response);

  return { run: payload.run, executionTriggered: Boolean(payload.executionTriggered) };
}

export async function getRun(runId: string): Promise<StoredRun | null> {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`);

  if (response.status === 404) {
    return null;
  }

  return (await parseRunPayload(response)).run;
}

async function parseRunPayload(response: Response): Promise<RunResponse> {
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

  return payload as RunResponse;
}
