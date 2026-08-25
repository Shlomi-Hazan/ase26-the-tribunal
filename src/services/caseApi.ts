import type { CaseSourceType, ChargeSheet } from "../schemas/tribunalSetup";

export type StoredCase = {
  id: string;
  defendant: string;
  act: string;
  exactQuestion: string;
  sourceType: CaseSourceType;
  sourceFilename: string | null;
  createdAt: string;
};

export type SaveCaseInput = ChargeSheet & {
  sourceType: CaseSourceType;
  sourceFilename?: string;
};

type CaseResponse = {
  case: StoredCase;
};

type CasesResponse = {
  cases: StoredCase[];
};

type ErrorResponse = {
  errors?: string[];
  error?: string;
};

export class CaseApiError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "CaseApiError";
    this.errors = errors;
  }
}

export async function saveCase(input: SaveCaseInput) {
  const response = await fetch("/api/cases", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });

  return parseCaseResponse(response);
}

export async function listCases() {
  const response = await fetch("/api/cases");
  const payload = await parseJson<CasesResponse>(response);

  return payload.cases;
}

export async function getCase(caseId: string) {
  const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}`);

  if (response.status === 404) {
    return null;
  }

  return parseCaseResponse(response);
}

async function parseCaseResponse(response: Response) {
  const payload = await parseJson<CaseResponse>(response);

  return payload.case;
}

async function parseJson<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as ErrorResponse;

  if (!response.ok) {
    throw new CaseApiError(
      payload.errors?.length
        ? payload.errors
        : [payload.error ?? "Case request failed."]
    );
  }

  return payload as T;
}
