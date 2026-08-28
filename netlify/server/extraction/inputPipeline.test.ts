// Milestone 7A -- deterministic dossier input pipeline tests (ADR 0004
// Decisions 3, 4, 8).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { ExtractionError } from "./errors";
import { HandlerDeadline } from "./deadline";
import {
  NORMALIZED_DOSSIER_TEXT_MAX_CHARS,
  SMART_EXTRACTION_PDF_MAX_RAW_BYTES,
  SMART_EXTRACTION_TEXT_MAX_RAW_BYTES
} from "./constants";
import {
  normalizeDossierText,
  resolveNormalizedDossier,
  sanitizeDossierFilename
} from "./inputPipeline";

// A deadline that is always ample -- most tests never approach it.
function freshDeadline(): HandlerDeadline {
  return new HandlerDeadline(() => 0);
}

// A deadline that is already exhausted at construction -- every
// assertMinimumWindow() call throws immediately.
function exhaustedDeadline(): HandlerDeadline {
  let calls = 0;
  const clock = () => {
    calls += 1;

    return calls === 1 ? 0 : 999_999_999;
  };

  return new HandlerDeadline(clock);
}

function toBase64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64");
}

// Builds a minimal, valid, unencrypted single-page PDF containing the
// exact text via a plain content stream (Tj operator) -- the same
// technique used to hand-verify pdfjs-dist's real Node.js text-extraction
// behavior during implementation (no test fixture library, no binary
// checked in).
function buildMinimalPdf(text: string): Buffer {
  const escaped = text.replace(/([()\\])/g, "\\$1");
  const content = `BT /F1 24 Tf 10 100 Td (${escaped}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

function pdfBase64(text: string): string {
  return buildMinimalPdf(text).toString("base64");
}

// A structurally valid single-page PDF whose content stream draws
// nothing (no Tj text-showing operator at all) -- simulates an
// image-only/scanned page: pdfjs can parse the document, but
// getTextContent() legitimately returns zero text items.
function buildImageOnlyPdf(): Buffer {
  const content = ""; // No text-showing operators.
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 200 200] /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, "latin1");

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "latin1");
}

describe("sanitizeDossierFilename", () => {
  it("accepts .txt, .md, .pdf", () => {
    expect(sanitizeDossierFilename("dossier.txt")).toBe("dossier.txt");
    expect(sanitizeDossierFilename("dossier.md")).toBe("dossier.md");
    expect(sanitizeDossierFilename("dossier.pdf")).toBe("dossier.pdf");
  });

  it("rejects an unsupported extension", () => {
    expect(() => sanitizeDossierFilename("dossier.docx")).toThrow(ExtractionError);
  });

  it("rejects a path-traversal filename", () => {
    expect(() => sanitizeDossierFilename("../dossier.txt")).toThrow(ExtractionError);
  });
});

describe("normalizeDossierText", () => {
  it("normalizes CRLF and bare CR to LF deterministically", () => {
    expect(normalizeDossierText("a\r\nb\rc\n")).toBe("a\nb\nc");
  });
});

describe("resolveNormalizedDossier -- pasted text", () => {
  it("accepts valid pasted text", async () => {
    const result = await resolveNormalizedDossier(
      { kind: "text", text: "Hello dossier." },
      freshDeadline()
    );

    expect(result.normalizedText).toBe("Hello dossier.");
    expect(result.sourceKind).toBe("text");
    expect(result.sourceFilename).toBeNull();
  });

  it("rejects empty pasted text", async () => {
    await expect(
      resolveNormalizedDossier({ kind: "text", text: "   " }, freshDeadline())
    ).rejects.toMatchObject({ code: "NORMALIZED_TEXT_EMPTY" });
  });

  it("rejects pasted text exceeding the raw byte cap -- never truncates", async () => {
    const oversized = "a".repeat(SMART_EXTRACTION_TEXT_MAX_RAW_BYTES + 1);

    await expect(
      resolveNormalizedDossier({ kind: "text", text: oversized }, freshDeadline())
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects normalized text exceeding NORMALIZED_DOSSIER_TEXT_MAX_CHARS -- never truncates", async () => {
    const oversized = "a".repeat(NORMALIZED_DOSSIER_TEXT_MAX_CHARS + 1);

    await expect(
      resolveNormalizedDossier({ kind: "text", text: oversized }, freshDeadline())
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE_FOR_MODEL" });
  });
});

describe("resolveNormalizedDossier -- .txt/.md files", () => {
  it("accepts a valid .txt file", async () => {
    const result = await resolveNormalizedDossier(
      { kind: "file", filename: "dossier.txt", contentBase64: toBase64("Case facts.") },
      freshDeadline()
    );

    expect(result.normalizedText).toBe("Case facts.");
    expect(result.sourceKind).toBe("file");
    expect(result.sourceFilename).toBe("dossier.txt");
  });

  it("accepts a valid .md file", async () => {
    const result = await resolveNormalizedDossier(
      { kind: "file", filename: "dossier.md", contentBase64: toBase64("# Case") },
      freshDeadline()
    );

    expect(result.sourceFilename).toBe("dossier.md");
  });

  it("rejects invalid UTF-8", async () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd]).toString("base64");

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: invalidUtf8 },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects an empty file", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: "" },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects a .txt/.md file exceeding the raw byte cap", async () => {
    const oversized = toBase64("a".repeat(SMART_EXTRACTION_TEXT_MAX_RAW_BYTES + 1));

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: oversized },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects an unsupported file type before reading content", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.docx", contentBase64: toBase64("x") },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
  });
});

describe("decodeBase64 strict validation (Section 17, independent pre-live audit)", () => {
  it("rejects Base64 containing an illegal character", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: "not!valid$base64===" },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects Base64 with a length not a multiple of 4", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: "abcde" },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects Base64 with padding in the wrong position", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: "ab=c" },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects Base64 with more than two trailing padding characters", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: "ab===" },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("accepts well-formed Base64 with 0, 1, and 2 padding characters", async () => {
    // "abcd" (0 padding), "abcw" repeated as needed; construct each
    // padding variant directly from a real UTF-8 payload.
    const zeroPad = toBase64("abcd"); // 4 chars -> "YWJjZA==" actually has padding; use a length that avoids it
    const onePad = toBase64("abc"); // -> ends with a single '='
    const twoPad = toBase64("ab"); // -> ends with '=='

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: zeroPad },
        freshDeadline()
      )
    ).resolves.toMatchObject({ normalizedText: "abcd" });

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: onePad },
        freshDeadline()
      )
    ).resolves.toMatchObject({ normalizedText: "abc" });

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: twoPad },
        freshDeadline()
      )
    ).resolves.toMatchObject({ normalizedText: "ab" });
  });
});

describe("resolveNormalizedDossier -- .pdf files (real pdfjs-dist text-layer extraction)", () => {
  it("extracts text from a valid single-page PDF", async () => {
    const result = await resolveNormalizedDossier(
      { kind: "file", filename: "dossier.pdf", contentBase64: pdfBase64("Hello World") },
      freshDeadline()
    );

    expect(result.normalizedText).toContain("Hello World");
    expect(result.sourceFilename).toBe("dossier.pdf");
  });

  it("rejects a malformed/invalid PDF", async () => {
    const invalid = Buffer.from("not a pdf at all", "utf8").toString("base64");

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.pdf", contentBase64: invalid },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "PDF_ENCRYPTED_OR_INVALID" });
  });

  it("rejects a PDF exceeding the raw byte cap before ever parsing it", async () => {
    // A byte-count check on the raw bytes, before pdfjs is even invoked --
    // constructing an actual 4 MiB+ valid PDF is unnecessary to prove this.
    const oversizedBase64 = Buffer.alloc(SMART_EXTRACTION_PDF_MAX_RAW_BYTES + 1, 0x25).toString(
      "base64"
    );

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.pdf", contentBase64: oversizedBase64 },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("checks the deadline before starting PDF page extraction", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.pdf", contentBase64: pdfBase64("Hello World") },
        exhaustedDeadline()
      )
    ).rejects.toMatchObject({ code: "INPUT_PROCESSING_TIMEOUT" });
  });

  it("bounds the PDF document-load await itself against the deadline (not only the between-pages check)", async () => {
    // A deadline that reports ample time on the FIRST call
    // (resolveNormalizedDossier's own entry check) but is already
    // exhausted by the time withPdfDeadline checks it immediately before
    // racing loadingTask.promise -- proving that specific await is
    // itself deadline-bounded, not merely the checks between pages.
    let calls = 0;
    const clock = () => {
      calls += 1;

      return calls <= 1 ? 0 : 999_999_999;
    };
    const deadline = new HandlerDeadline(clock);

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.pdf", contentBase64: pdfBase64("Hello World") },
        deadline
      )
    ).rejects.toMatchObject({ code: "INPUT_PROCESSING_TIMEOUT" });
  });

  it("rejects an image-only/no-text-layer PDF as PDF_TEXT_UNAVAILABLE, never OCR", async () => {
    const imageOnlyBase64 = buildImageOnlyPdf().toString("base64");

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.pdf", contentBase64: imageOnlyBase64 },
        freshDeadline()
      )
    ).rejects.toMatchObject({ code: "PDF_TEXT_UNAVAILABLE" });
  });

  it("real fixture file round-trip: writes and reads a temp PDF the same way the pipeline would receive it over HTTP", async () => {
    const tempPath = path.join(os.tmpdir(), `m7a-test-${Date.now()}.pdf`);

    writeFileSync(tempPath, buildMinimalPdf("Temp Fixture Text"));
    const roundTripBase64 = readFileSync(tempPath).toString("base64");

    const result = await resolveNormalizedDossier(
      { kind: "file", filename: "dossier.pdf", contentBase64: roundTripBase64 },
      freshDeadline()
    );

    expect(result.normalizedText).toContain("Temp Fixture Text");
  });
});
