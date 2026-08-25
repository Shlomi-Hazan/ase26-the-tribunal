import type { HandlerEvent, HandlerResponse } from "@netlify/functions";
import {
  ImportValidationError,
  importJsonResponse
} from "./importParsers";

export type ImportRequestBody = {
  filename: string;
  contentBase64: string;
};

export function parseImportRequest(event: HandlerEvent): ImportRequestBody {
  if (!event.body) {
    throw new ImportValidationError(["Request body is required."]);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(event.body);
  } catch {
    throw new ImportValidationError(["Request body must be valid JSON."]);
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as ImportRequestBody).filename !== "string" ||
    typeof (parsed as ImportRequestBody).contentBase64 !== "string"
  ) {
    throw new ImportValidationError([
      "Request body must include filename and contentBase64."
    ]);
  }

  return parsed as ImportRequestBody;
}

// Base64 expands raw bytes by 4/3; reject an oversized encoded payload
// before paying for the allocation/decode of a large request body.
export function decodeBase64Content(
  contentBase64: string,
  maxBytes: number
): Uint8Array {
  const maxEncodedLength = Math.ceil(maxBytes / 3) * 4 + 4;

  if (contentBase64.length > maxEncodedLength) {
    throw new ImportValidationError([
      `Uploaded file exceeds ${Math.floor(maxBytes / 1024)} KiB.`
    ]);
  }

  try {
    return Buffer.from(contentBase64, "base64");
  } catch {
    throw new ImportValidationError(["File content must be base64 encoded."]);
  }
}

export function methodNotAllowed(): HandlerResponse {
  return importJsonResponse(405, { error: "method_not_allowed" });
}

export function importErrorResponse(error: unknown): HandlerResponse {
  if (error instanceof ImportValidationError) {
    return importJsonResponse(400, {
      error: "invalid_import",
      errors: error.errors
    });
  }

  return importJsonResponse(500, { error: "import_failed" });
}
