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

import { Worker } from "node:worker_threads";
import {
  NORMALIZED_DOSSIER_TEXT_MAX_CHARS,
  PACKAGE_EXTRACTION_PDF_MAX_PAGES,
  SMART_EXTRACTION_PDF_MAX_RAW_BYTES,
  SMART_EXTRACTION_TEXT_MAX_RAW_BYTES
} from "./constants";
import { ExtractionError, type ExtractionHardFailureCode } from "./errors";
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

// Corrected this pass (independent pre-live audit round 2, Section 2):
// the prior revision's `withPdfDeadline` (Promise.race per pdfjs await)
// was an HONEST but INSUFFICIENT mitigation -- explicitly disclosed at
// the time as unable to preempt a single pathological, non-yielding
// synchronous parse, because pdfjs-dist's Node "fake worker" mode runs
// on the SAME thread as the race's own timer. That limitation is now
// eliminated, not merely documented: the entire pdfjs pipeline (module
// load, getDocument, per-page getPage/getTextContent, the 200-page cap,
// and the pdfjs-specific exception classification this file used to do
// inline) runs inside a real `node:worker_threads` Worker, and the
// PARENT races the worker's completion against the remaining handler
// deadline. `Worker#terminate()` forcibly tears down the worker's V8
// isolate -- unlike `Promise.race`, this genuinely preempts the worker
// even mid a non-yielding synchronous call, because termination does
// not require the worker's own code to cooperate at all.
//
// Empirically verified before writing this (not merely asserted): a
// throwaway probe worker that requires a real node_modules package via
// an eval'd CommonJS source string, then spins synchronously without
// yielding for 5000ms, was torn down by `worker.terminate()` within ~2ms
// of a 200ms parent timer firing -- i.e. terminate() cut the spin short
// by roughly 4800ms rather than waiting for it to finish. A second probe
// confirmed `pdfjs-dist/legacy/build/pdf.mjs` resolves via dynamic
// `import()` from inside such an eval'd worker against this project's
// own node_modules, and a full getDocument/getPage/getTextContent/
// loadingTask.destroy() pass over a real minimal PDF succeeds and
// returns the extracted text via `postMessage`.
//
// The worker source is an INLINE STRING (`new Worker(source, {eval:
// true})`), not a path to a separate compiled `.js` file on disk. This
// is a deliberate deployment-safety choice, not a shortcut: Netlify's
// Function bundler traces and bundles exactly what this module imports
// and contains -- a string constant travels with it automatically. A
// separate worker *file* would need its own, independently-verified
// entry in whatever the bundler ships to the deployed Function's zip;
// getting that wrong would fail SILENTLY at runtime (a working local
// dev server, a broken production Lambda), which is exactly the kind of
// "not falsely claimed as solved" gap this pass exists to close. `eval:
// true` accepts the source-embedded-in-this-file trade-off instead.
type PdfWorkerOutcome =
  | { ok: true; text: string }
  | { ok: false; code: ExtractionHardFailureCode; message: string };

// CommonJS on purpose (`require`, not `import`) -- Node's worker_threads
// `eval: true` mode executes the source as a CommonJS script regardless
// of this project's own `"type": "module"`, and `require` here resolves
// against this project's real node_modules exactly as verified in the
// probes above. `pdfjs-dist` itself is still loaded via a dynamic
// `import()` inside the worker (mirroring exactly how the pre-worker
// implementation loaded it), since pdfjs-dist ships as native ESM.
const PDF_WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");

(async () => {
  let loadingTask = null;

  const post = (outcome) => {
    parentPort.postMessage(outcome);
  };

  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const bytes = new Uint8Array(workerData.arrayBuffer);

    loadingTask = pdfjsLib.getDocument({
      data: bytes,
      disableFontFace: true,
      useSystemFonts: false
    });

    const document = await loadingTask.promise;

    if (document.numPages > workerData.maxPages) {
      post({
        ok: false,
        code: "INPUT_TOO_LARGE_FOR_MODEL",
        message: "PDF has more than " + workerData.maxPages + " pages."
      });
      return;
    }

    const pageTexts = [];

    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => (item && typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .trim();

      pageTexts.push(pageText);
      page.cleanup();
    }

    const combined = pageTexts.join("\\n\\n").trim();

    if (combined.length === 0) {
      post({
        ok: false,
        code: "PDF_TEXT_UNAVAILABLE",
        message: "No extractable text layer found (image-only/scanned PDF is not supported -- no OCR)."
      });
      return;
    }

    post({ ok: true, text: combined });
  } catch (error) {
    const name = error && error.name;

    if (name === "PasswordException") {
      post({ ok: false, code: "PDF_ENCRYPTED_OR_INVALID", message: "PDF is password-protected." });
    } else if (name === "InvalidPDFException") {
      post({ ok: false, code: "PDF_ENCRYPTED_OR_INVALID", message: "PDF is invalid or corrupt." });
    } else {
      post({ ok: false, code: "PDF_ENCRYPTED_OR_INVALID", message: "PDF could not be parsed." });
    }
  } finally {
    if (loadingTask) {
      await loadingTask.destroy().catch(() => {});
    }
  }
})();
`;

// The actual hard-preemption guarantee lives entirely in this generic
// primitive, independent of pdfjs -- it races an eval'd worker's
// completion against `timeoutMs` and forcibly `terminate()`s the worker
// if that timer wins, regardless of what the worker is doing at that
// instant (synchronous or asynchronous). Exported so it can be unit-
// tested directly against a synthetic, deliberately-pathological
// (synchronously-spinning) worker fixture -- proving the mechanism
// itself, in isolation from pdfjs-dist, terminates a non-yielding worker
// promptly rather than waiting for it. `extractPdfTextLayer` below is
// the only production caller.
export class WorkerDeadlineExceededError extends Error {
  constructor() {
    super("Worker did not complete within the allotted time.");
    this.name = "WorkerDeadlineExceededError";
  }
}

export async function runTerminableWorker<T>(
  source: string,
  workerData: unknown,
  timeoutMs: number,
  transferList: readonly ArrayBuffer[] = []
): Promise<T> {
  if (timeoutMs <= 0) {
    throw new WorkerDeadlineExceededError();
  }

  const worker = new Worker(source, {
    eval: true,
    workerData,
    transferList: transferList as ArrayBuffer[]
  });

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    // Every exit path -- a definitive worker message, a worker crash, or
    // the timeout timer -- funnels through here so `worker.terminate()`
    // is ALWAYS called exactly once and nothing is ever left running:
    // terminate() on a worker that is already exiting on its own is a
    // safe no-op, so this is never a double-cleanup hazard, and no path
    // ever leaves an orphaned worker thread behind.
    function finish(effect: () => void): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      effect();
      void worker.terminate();
    }

    const timer = setTimeout(() => {
      finish(() => reject(new WorkerDeadlineExceededError()));
    }, timeoutMs);

    worker.once("message", (message: T) => {
      finish(() => resolve(message));
    });

    worker.once("error", (error: Error) => {
      finish(() => reject(error));
    });
  });
}

async function extractPdfTextLayer(
  bytes: Uint8Array,
  deadline: HandlerDeadline
): Promise<string> {
  const remainingMs = deadline.remainingMs();

  if (remainingMs <= 0) {
    throw new ExtractionError(
      "INPUT_PROCESSING_TIMEOUT",
      "PDF processing exceeded the remaining handler deadline."
    );
  }

  // A fresh, worker-transferable, plain ArrayBuffer copy: `bytes` is a
  // `Uint8Array` whose `.buffer` is typed `ArrayBufferLike` (could in
  // principle be a `SharedArrayBuffer`, which `transferList` rejects at
  // the type level) and may in any case be a VIEW into a larger buffer
  // the caller still holds a reference to (e.g. the decoded Base64
  // payload) -- `transferList` DETACHES the buffer it names, so
  // transferring memory this function does not exclusively own would
  // corrupt what the caller still expects to read. Allocating a fresh
  // buffer and copying into it sidesteps both problems; the copy is
  // bounded by the existing 4 MiB raw PDF cap (checked by the caller
  // before this function is ever reached), so it is cheap and bounded.
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(arrayBuffer).set(bytes);

  let outcome: PdfWorkerOutcome;

  try {
    outcome = await runTerminableWorker<PdfWorkerOutcome>(
      PDF_WORKER_SOURCE,
      { arrayBuffer, maxPages: PACKAGE_EXTRACTION_PDF_MAX_PAGES },
      remainingMs,
      [arrayBuffer]
    );
  } catch (error) {
    if (error instanceof WorkerDeadlineExceededError) {
      throw new ExtractionError(
        "INPUT_PROCESSING_TIMEOUT",
        "PDF processing exceeded the remaining handler deadline."
      );
    }

    // A crash inside the worker BEFORE it could classify its own error
    // (e.g. the eval'd source itself threw synchronously) -- treated the
    // same way the pre-worker implementation treated an unclassified
    // pdfjs exception: a conservative PDF_ENCRYPTED_OR_INVALID, never
    // silently swallowed.
    throw new ExtractionError(
      "PDF_ENCRYPTED_OR_INVALID",
      `PDF worker failed: ${(error as Error).message}`
    );
  }

  if (!outcome.ok) {
    throw new ExtractionError(outcome.code, outcome.message);
  }

  return outcome.text;
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
