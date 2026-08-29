// Milestone 7A -- semantic fingerprint tests (ADR 0004 Decision 15).

import { describe, expect, it } from "vitest";
import { computeExtractionFingerprint } from "./fingerprint";

const base = {
  normalizedDossierText: "Dossier content.",
  promptVersion: "package-extraction-v1",
  configuredModelId: "openrouter/some-model"
};

describe("computeExtractionFingerprint", () => {
  it("produces a 64-character lowercase hex SHA-256 digest", () => {
    const fingerprint = computeExtractionFingerprint(base);

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for identical input", () => {
    expect(computeExtractionFingerprint(base)).toBe(computeExtractionFingerprint({ ...base }));
  });

  it("changes when the dossier content changes", () => {
    const other = computeExtractionFingerprint({ ...base, normalizedDossierText: "Different." });

    expect(other).not.toBe(computeExtractionFingerprint(base));
  });

  it("changes when the prompt version changes", () => {
    const other = computeExtractionFingerprint({ ...base, promptVersion: "package-extraction-v2" });

    expect(other).not.toBe(computeExtractionFingerprint(base));
  });

  it("changes when the configured model changes", () => {
    const other = computeExtractionFingerprint({ ...base, configuredModelId: "openrouter/other-model" });

    expect(other).not.toBe(computeExtractionFingerprint(base));
  });

  it("source.kind has no fingerprint parameter at all -- two logically distinct inputs (a .txt upload vs. pasted text) that normalize to the SAME dossier text produce the SAME fingerprint", () => {
    // computeExtractionFingerprint's signature structurally cannot accept
    // a source.kind argument -- this test documents/proves that by
    // computing the fingerprint from the same normalizedDossierText twice
    // (as if it came from two different source kinds) and asserting they
    // are identical, since there is no parameter through which the two
    // could ever diverge.
    const asIfFromPastedText = computeExtractionFingerprint(base);
    const asIfFromTxtUpload = computeExtractionFingerprint({ ...base });

    expect(asIfFromPastedText).toBe(asIfFromTxtUpload);
  });
});
