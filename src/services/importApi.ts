import type { ChargeSheet, TribunalSetupDraft } from "../schemas/tribunalSetup";

type ImportRequestPayload = {
  filename: string;
  contentBase64: string;
};

type ChargeSheetImportResponse = {
  chargeSheet: ChargeSheet;
  filename: string;
};

type PersonalityImportResponse = {
  personality: string;
  filename: string;
};

type TribunalPackageImportResponse = {
  draft: TribunalSetupDraft;
};

type ErrorResponse = {
  errors?: string[];
};

export class ImportApiError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super(errors.join(" "));
    this.name = "ImportApiError";
    this.errors = errors;
  }
}

export async function importChargeSheetFile(file: File) {
  return postImport<ChargeSheetImportResponse>("/api/import/charge-sheet", file);
}

export async function importPersonalityFile(file: File) {
  return postImport<PersonalityImportResponse>("/api/import/personality", file);
}

export async function importTribunalPackageFile(file: File) {
  return postImport<TribunalPackageImportResponse>(
    "/api/import/tribunal-package",
    file
  );
}

async function postImport<T>(path: string, file: File): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(await fileToPayload(file))
  });

  const payload = (await response.json().catch(() => ({}))) as ErrorResponse;

  if (!response.ok) {
    throw new ImportApiError(
      payload.errors?.length ? payload.errors : ["Import failed."]
    );
  }

  return payload as T;
}

async function fileToPayload(file: File): Promise<ImportRequestPayload> {
  return {
    filename: file.name,
    contentBase64: arrayBufferToBase64(await file.arrayBuffer())
  };
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";

  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary);
}
