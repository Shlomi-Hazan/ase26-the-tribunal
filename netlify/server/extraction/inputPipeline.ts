// Milestone 7A -- deterministic dossier source handling (ADR 0004
// Decisions 3, 4, 8). Server-only. Mirrors M5's importParsers.ts
// discipline (assertFile-style size/type guards, `.replace(/\r\n?/g,
// "\n")` normalization) without duplicating it -- this is a genuinely
// different input contract (free-form prose, not marker-based sections),
// so it is its own module, not a branch inside importParsers.ts.
//
// Rules enforced throughout: reject, never truncate. Raw bytes are
// discarded once normalization succeeds -- only the normalized text is
// returned, and callers must not persist it (Decision 13).

import {
  NORMALIZED_DOSSIER_TEXT_MAX_CHARS,
  PACKAGE_EXTRACTION_PDF_MAX_PAGES,
  SMART_EXTRACTION_PDF_MAX_RAW_BYTES,
  SMART_EXTRACTION_TEXT_MAX_RAW_BYTES
} from "./constants";
import { ExtractionError } from "./errors";

export type DossierSourceKind = "text" | "file";

export type DossierSource =
  | { kind: "text"; text: string }
  | { kind: "file"; filename: string; contentBase64: string };

const allowedFileExtensions = new Set([".txt", ".md", ".pdf"]);

export function sanitizeDossierFilename(filename: string): string {
  const trimmed = filename.trim();
  const lower = trimmed.toLowerCase();

  if (
    !trimmed ||
    trimmed.length > 255 ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    trimmed.includes("\0") ||
    trimmed === "." ||
    trimmed === ".."
  ) {
    throw new ExtractionError("INPUT_INVALID", "Invalid filename.");
  }

  const extension = [...allowedFileExtensions].find((candidate) =>
    lower.endsWith(candidate)
  );

  if (!extension) {
    throw new ExtractionError(
      "UNSUPPORTED_FILE_TYPE",
      "Unsupported file type. Use a .txt, .md, or .pdf file."
    );
  }

  return trimmed;
}

function extensionOf(filename: string): ".txt" | ".md" | ".pdf" {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".pdf")) {
    return ".pdf";
  }

  if (lower.endsWith(".md")) {
    return ".md";
  }

  return ".txt";
}

// Reject, never truncate: normalizes line endings deterministically, then
// checks the length bound -- a too-long dossier fails outright rather
// than silently losing its tail.
export function normalizeDossierText(rawText: string): string {
  return rawText.replace(/\r\n?/g, "\n").trim();
}

function assertNormalizedLength(normalized: string): void {
  if (normalized.length === 0) {
    throw new ExtractionError("NORMALIZED_TEXT_EMPTY", "Dossier text is empty.");
  }

  if (normalized.length > NORMALIZED_DOSSIER_TEXT_MAX_CHARS) {
    throw new ExtractionError(
      "INPUT_TOO_LARGE_FOR_MODEL",
      `Normalized dossier text exceeds ${NORMALIZED_DOSSIER_TEXT_MAX_CHARS} characters.`
    );
  }
}

function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ExtractionError("INPUT_INVALID", "Invalid UTF-8 text.");
  }
}

function decodeBase64(contentBase64: string): Uint8Array {
  let buffer: Buffer;

  try {
    buffer = Buffer.from(contentBase64, "base64");
  } catch {
    throw new ExtractionError("INPUT_INVALID", "Invalid file content encoding.");
  }

  if (buffer.length === 0) {
    throw new ExtractionError("INPUT_INVALID", "Uploaded file is empty.");
  }

  return new Uint8Array(buffer);
}

// A caller-supplied deadline check, invoked between PDF pages. Throws
// (never returns false) so the same monotonic-deadline contract
// (Decision 8) governs every deterministic pre-work step through one
// mechanism -- implementation-time decision C (Issue #15): no separate
// PDF-specific millisecond sub-budget, just periodic rechecks against the
// existing handler-wide deadline.
export type DeadlineCheck = () => void;

async function extractPdfTextLayer(
  bytes: Uint8Array,
  checkDeadline: DeadlineCheck
): Promise<string> {
  // Deferred require (not a top-level import) so this heavy, server-only
  // module is never pulled into any code path the client bundle could
  // reach -- verify-client-bundle.mjs's absence check (Section 5) relies
  // on this staying true.
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");

  let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | null = null;

  try {
    loadingTask = pdfjsLib.getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: false
    });

    const document = await loadingTask.promise;

    if (document.numPages > PACKAGE_EXTRACTION_PDF_MAX_PAGES) {
      throw new ExtractionError(
        "INPUT_TOO_LARGE_FOR_MODEL",
        `PDF has more than ${PACKAGE_EXTRACTION_PDF_MAX_PAGES} pages.`
      );
    }

    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      checkDeadline();

      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      // Deterministic ordering as far as the PDF text layer permits
      // (Decision 6): the order getTextContent().items returns items in
      // -- the document's own content-stream drawing order, never
      // re-sorted here. Never rendering/canvas -- getTextContent reads
      // only the text layer.
      const pageText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();

      pageTexts.push(pageText);
      page.cleanup();
    }

    const combined = pageTexts.join("\n\n").trim();

    if (combined.length === 0) {
      throw new ExtractionError(
        "PDF_TEXT_UNAVAILABLE",
        "No extractable text layer found (image-only/scanned PDF is not supported -- no OCR)."
      );
    }

    return combined;
  } catch (error) {
    if (error instanceof ExtractionError) {
      throw error;
    }

    const name = (error as { name?: string } | null)?.name;

    if (name === "PasswordException") {
      throw new ExtractionError(
        "PDF_ENCRYPTED_OR_INVALID",
        "PDF is password-protected."
      );
    }

    if (name === "InvalidPDFException") {
      throw new ExtractionError("PDF_ENCRYPTED_OR_INVALID", "PDF is invalid or corrupt.");
    }

    throw new ExtractionError(
      "PDF_ENCRYPTED_OR_INVALID",
      "PDF could not be parsed."
    );
  } finally {
    await loadingTask?.destroy();
  }
}

export type NormalizedDossier = {
  normalizedText: string;
  sourceKind: DossierSourceKind;
  sourceFilename: string | null;
};

// The single entry point every caller (preflight, initial, retry) uses.
// `checkDeadline` is invoked at least once before any PDF-specific
// per-page work, and between pages -- callers pass the same pre-claim
// deadline check the handler already computes (Decision 8).
export async function resolveNormalizedDossier(
  source: DossierSource,
  checkDeadline: DeadlineCheck
): Promise<NormalizedDossier> {
  if (source.kind === "text") {
    checkDeadline();

    const byteLength = new TextEncoder().encode(source.text).length;

    if (byteLength === 0) {
      throw new ExtractionError("INPUT_INVALID", "Pasted text is empty.");
    }

    if (byteLength > SMART_EXTRACTION_TEXT_MAX_RAW_BYTES) {
      throw new ExtractionError(
        "FILE_TOO_LARGE",
        `Pasted text exceeds ${Math.floor(SMART_EXTRACTION_TEXT_MAX_RAW_BYTES / 1024)} KiB.`
      );
    }

    const normalized = normalizeDossierText(source.text);

    assertNormalizedLength(normalized);

    return { normalizedText: normalized, sourceKind: "text", sourceFilename: null };
  }

  checkDeadline();

  const safeFilename = sanitizeDossierFilename(source.filename);
  const extension = extensionOf(safeFilename);
  const bytes = decodeBase64(source.contentBase64);

  if (extension === ".pdf") {
    if (bytes.byteLength > SMART_EXTRACTION_PDF_MAX_RAW_BYTES) {
      throw new ExtractionError(
        "FILE_TOO_LARGE",
        `PDF exceeds ${Math.floor(SMART_EXTRACTION_PDF_MAX_RAW_BYTES / (1024 * 1024))} MiB.`
      );
    }

    const rawPdfText = await extractPdfTextLayer(bytes, checkDeadline);
    const normalized = normalizeDossierText(rawPdfText);

    assertNormalizedLength(normalized);

    return {
      normalizedText: normalized,
      sourceKind: "file",
      sourceFilename: safeFilename
    };
  }

  if (bytes.byteLength > SMART_EXTRACTION_TEXT_MAX_RAW_BYTES) {
    throw new ExtractionError(
      "FILE_TOO_LARGE",
      `Uploaded file exceeds ${Math.floor(SMART_EXTRACTION_TEXT_MAX_RAW_BYTES / 1024)} KiB.`
    );
  }

  const text = decodeUtf8Strict(bytes);
  const normalized = normalizeDossierText(text);

  assertNormalizedLength(normalized);

  return { normalizedText: normalized, sourceKind: "file", sourceFilename: safeFilename };
}
