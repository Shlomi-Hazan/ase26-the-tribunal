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
import type { HandlerDeadline } from "./deadline";

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

// Corrected this pass (independent pre-live audit, Section 17):
// `Buffer.from(value, "base64")` is permissive -- it silently skips
// characters outside the Base64 alphabet rather than reliably throwing
// for malformed input, so a caller-supplied string containing garbage
// bytes could previously decode "successfully" into unintended content.
// Validated strictly against the canonical Base64 grammar (RFC 4648
// Sec 4: groups of 4 characters from [A-Za-z0-9+/], with 0, 1, or 2
// trailing `=` padding characters only in the final group) before any
// decode is attempted.
// A single-pass, O(n), non-regex scanner -- not a regex literal (a
// backtracking-capable regex against a multi-megabyte string was
// observed during implementation to raise "Maximum call stack size
// exceeded" in V8's regex engine for this exact validation shape; a
// plain character-code loop has no such limit regardless of input size,
// the same reasoning netlify/server/runs.ts's containsControlCharacter
// already applies to a different control-character check). Validates
// the canonical Base64 grammar (RFC 4648 Sec 4): length a multiple of 4,
// every character in [A-Za-z0-9+/], with 0, 1, or 2 trailing `=`
// padding characters confined to the final group.
function isStrictBase64(value: string): boolean {
  const length = value.length;

  if (length === 0 || length % 4 !== 0) {
    return false;
  }

  let paddingCount = 0;

  for (let index = 0; index < length; index += 1) {
    const code = value.charCodeAt(index);
    const isUpper = code >= 0x41 && code <= 0x5a; // A-Z
    const isLower = code >= 0x61 && code <= 0x7a; // a-z
    const isDigit = code >= 0x30 && code <= 0x39; // 0-9
    const isPlus = code === 0x2b; // +
    const isSlash = code === 0x2f; // /
    const isPad = code === 0x3d; // =

    if (isPad) {
      paddingCount += 1;

      if (index < length - 2) {
        return false; // padding only ever allowed in the final 2 positions.
      }

      continue;
    }

    if (paddingCount > 0) {
      return false; // a real character can never follow padding.
    }

    if (!isUpper && !isLower && !isDigit && !isPlus && !isSlash) {
      return false;
    }
  }

  return paddingCount <= 2;
}

function decodeBase64(contentBase64: string): Uint8Array {
  if (!isStrictBase64(contentBase64)) {
    throw new ExtractionError("INPUT_INVALID", "Invalid file content encoding.");
  }

  const buffer = Buffer.from(contentBase64, "base64");

  if (buffer.length === 0) {
    throw new ExtractionError("INPUT_INVALID", "Uploaded file is empty.");
  }

  return new Uint8Array(buffer);
}

// Corrected this pass (independent pre-live audit, Section 7): the prior
// revision only called `checkDeadline()` BETWEEN high-level pdfjs
// operations -- a single long `await` (document load, one page's
// getTextContent) could still run past the 55s handler deadline before
// the next check ever executed. `withPdfDeadline` races each individual
// pdfjs await against the freshly recomputed remaining handler time and,
// on timeout, destroys the loading task (pdfjs's own documented
// cancellation/cleanup API) before throwing.
//
// Honest limitation, disclosed rather than hidden: this repository runs
// pdfjs-dist's Node "fake worker" mode, which executes synchronously on
// the SAME thread as this race's timer (empirically verified during
// implementation -- no real Worker is spawned). `Promise.race` can only
// preempt an operation that itself yields the event loop between
// internal steps (which pdfjs's own async document/page/text-content
// resolution genuinely does in normal operation -- each is its own
// resolved promise, not one long synchronous call) -- it cannot forcibly
// interrupt a single pathological, purely synchronous parse that never
// yields before finishing. A hard preemptive guarantee against that
// narrower case would require isolating PDF parsing in a real
// `worker_threads` worker (terminable via `Worker#terminate()`), which
// is a larger architectural change out of scope for this correction
// pass -- flagged explicitly here and in the implementation report
// rather than silently claimed as fully solved.
class PdfDeadlineExceededError extends Error {
  constructor() {
    super("PDF processing exceeded the remaining handler deadline.");
    this.name = "PdfDeadlineExceededError";
  }
}

async function withPdfDeadline<T>(
  operation: Promise<T>,
  deadline: HandlerDeadline
): Promise<T> {
  const remainingMs = deadline.remainingMs();

  if (remainingMs <= 0) {
    throw new PdfDeadlineExceededError();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PdfDeadlineExceededError()), remainingMs);
  });

  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}

async function extractPdfTextLayer(
  bytes: Uint8Array,
  deadline: HandlerDeadline
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

    const document = await withPdfDeadline(loadingTask.promise, deadline);

    if (document.numPages > PACKAGE_EXTRACTION_PDF_MAX_PAGES) {
      throw new ExtractionError(
        "INPUT_TOO_LARGE_FOR_MODEL",
        `PDF has more than ${PACKAGE_EXTRACTION_PDF_MAX_PAGES} pages.`
      );
    }

    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      deadline.assertMinimumWindow();

      const page = await withPdfDeadline(document.getPage(pageNumber), deadline);
      const content = await withPdfDeadline(page.getTextContent(), deadline);
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

    if (error instanceof PdfDeadlineExceededError) {
      throw new ExtractionError(
        "INPUT_PROCESSING_TIMEOUT",
        "PDF processing exceeded the remaining handler deadline."
      );
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
    // Cancels/cleans up pdfjs's own internal work -- the documented
    // cancellation API this Node architecture actually supports (see the
    // honest limitation noted above).
    await loadingTask?.destroy();
  }
}

export type NormalizedDossier = {
  normalizedText: string;
  sourceKind: DossierSourceKind;
  sourceFilename: string | null;
};

// The single entry point every caller (preflight, initial, retry) uses.
// `deadline` is checked before any PDF-specific per-page work, between
// pages, and races each individual pdfjs await (see withPdfDeadline
// above) -- callers pass the same HandlerDeadline instance the handler
// already constructed (Decision 8).
export async function resolveNormalizedDossier(
  source: DossierSource,
  deadline: HandlerDeadline
): Promise<NormalizedDossier> {
  if (source.kind === "text") {
    deadline.assertMinimumWindow();

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

  deadline.assertMinimumWindow();

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

    const rawPdfText = await extractPdfTextLayer(bytes, deadline);
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
