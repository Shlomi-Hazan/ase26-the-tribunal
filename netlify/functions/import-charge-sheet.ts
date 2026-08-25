import type { Handler } from "@netlify/functions";
import {
  importFileLimits,
  parseChargeSheetImport,
  sanitizeFilename
} from "../server/importParsers";
import {
  decodeBase64Content,
  importErrorResponse,
  methodNotAllowed,
  parseImportRequest
} from "../server/importRequest";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowed();
  }

  try {
    const request = parseImportRequest(event);
    const chargeSheet = parseChargeSheetImport(
      request.filename,
      decodeBase64Content(request.contentBase64, importFileLimits.chargeSheetBytes)
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      },
      body: JSON.stringify({
        chargeSheet,
        filename: sanitizeFilename(request.filename)
      })
    };
  } catch (error) {
    return importErrorResponse(error);
  }
};
