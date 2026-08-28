// Milestone 7A -- deterministic dossier input pipeline tests (ADR 0004
// Decisions 3, 4, 8).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { ExtractionError } from "./errors";
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

function noopDeadline() {
  // no-op -- most tests never approach the deadline.
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
      noopDeadline
    );

    expect(result.normalizedText).toBe("Hello dossier.");
    expect(result.sourceKind).toBe("text");
    expect(result.sourceFilename).toBeNull();
  });

  it("rejects empty pasted text", async () => {
    await expect(
      resolveNormalizedDossier({ kind: "text", text: "   " }, noopDeadline)
    ).rejects.toMatchObject({ code: "NORMALIZED_TEXT_EMPTY" });
  });

  it("rejects pasted text exceeding the raw byte cap -- never truncates", async () => {
    const oversized = "a".repeat(SMART_EXTRACTION_TEXT_MAX_RAW_BYTES + 1);

    await expect(
      resolveNormalizedDossier({ kind: "text", text: oversized }, noopDeadline)
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects normalized text exceeding NORMALIZED_DOSSIER_TEXT_MAX_CHARS -- never truncates", async () => {
    const oversized = "a".repeat(NORMALIZED_DOSSIER_TEXT_MAX_CHARS + 1);

    await expect(
      resolveNormalizedDossier({ kind: "text", text: oversized }, noopDeadline)
    ).rejects.toMatchObject({ code: "INPUT_TOO_LARGE_FOR_MODEL" });
  });
});

describe("resolveNormalizedDossier -- .txt/.md files", () => {
  it("accepts a valid .txt file", async () => {
    const result = await resolveNormalizedDossier(
      { kind: "file", filename: "dossier.txt", contentBase64: toBase64("Case facts.") },
      noopDeadline
    );

    expect(result.normalizedText).toBe("Case facts.");
    expect(result.sourceKind).toBe("file");
    expect(result.sourceFilename).toBe("dossier.txt");
  });

  it("accepts a valid .md file", async () => {
    const result = await resolveNormalizedDossier(
      { kind: "file", filename: "dossier.md", contentBase64: toBase64("# Case") },
      noopDeadline
    );

    expect(result.sourceFilename).toBe("dossier.md");
  });

  it("rejects invalid UTF-8", async () => {
    const invalidUtf8 = Buffer.from([0xff, 0xfe, 0xfd]).toString("base64");

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: invalidUtf8 },
        noopDeadline
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects an empty file", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: "" },
        noopDeadline
      )
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects a .txt/.md file exceeding the raw byte cap", async () => {
    const oversized = toBase64("a".repeat(SMART_EXTRACTION_TEXT_MAX_RAW_BYTES + 1));

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.txt", contentBase64: oversized },
        noopDeadline
      )
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects an unsupported file type before reading content", async () => {
    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.docx", contentBase64: toBase64("x") },
        noopDeadline
      )
    ).rejects.toMatchObject({ code: "UNSUPPORTED_FILE_TYPE" });
  });
});

describe("resolveNormalizedDossier -- .pdf files (real pdfjs-dist text-layer extraction)", () => {
  it("extracts text from a valid single-page PDF", async () => {
    const result = await resolveNormalizedDossier(
      { kind: "file", filename: "dossier.pdf", contentBase64: pdfBase64("Hello World") },
      noopDeadline
    );

    expect(result.normalizedText).toContain("Hello World");
    expect(result.sourceFilename).toBe("dossier.pdf");
  });

  it("rejects a malformed/invalid PDF", async () => {
    const invalid = Buffer.from("not a pdf at all", "utf8").toString("base64");

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.pdf", contentBase64: invalid },
        noopDeadline
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
        noopDeadline
      )
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("checks the deadline before starting PDF page extraction", async () => {
    let deadlineCalls = 0;
    const throwingDeadline = () => {
      deadlineCalls += 1;
      throw new ExtractionError("INPUT_PROCESSING_TIMEOUT", "deadline exhausted");
    };

    await expect(
      resolveNormalizedDossier(
        { kind: "file", filename: "dossier.pdf", contentBase64: pdfBase64("Hello World") },
        throwingDeadline
      )
    ).rejects.toMatchObject({ code: "INPUT_PROCESSING_TIMEOUT" });

    expect(deadlineCalls).toBeGreaterThan(0);
  });

  it("real fixture file round-trip: writes and reads a temp PDF the same way the pipeline would receive it over HTTP", async () => {
    const tempPath = path.join(os.tmpdir(), `m7a-test-${Date.now()}.pdf`);

    writeFileSync(tempPath, buildMinimalPdf("Temp Fixture Text"));
    const roundTripBase64 = readFileSync(tempPath).toString("base64");

    const result = await resolveNormalizedDossier(
      { kind: "file", filename: "dossier.pdf", contentBase64: roundTripBase64 },
      noopDeadline
    );

    expect(result.normalizedText).toContain("Temp Fixture Text");
  });
});
