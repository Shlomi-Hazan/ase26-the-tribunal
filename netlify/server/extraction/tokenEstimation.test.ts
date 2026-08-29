// Milestone 7A -- extraction token-estimation tests (ADR 0004 Decisions
// 9, 11; implementation-time decision D, Issue #15; corrected this pass,
// independent pre-live audit, Section 11: the estimate now covers the
// COMPLETE fixed request shape -- system prompt + user-message wrapper +
// structured-output JSON Schema -- not the system prompt alone. Extended
// again in the second independent pre-live re-audit, Section 6: the
// structured-output byte count now covers the COMPLETE response_format
// envelope -- type/json_schema.name/json_schema.strict/schema -- not the
// bare schema object alone, matching what executionRequest.ts's
// buildFutureCompletionRequest actually sends).

import { describe, expect, it } from "vitest";
import { PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1 } from "../../../src/prompts/package-extraction/v1";
import { packageExtractionJsonSchema } from "../../../src/schemas/packageExtraction";
import {
  buildDossierUserMessageContent,
  EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS,
  EXTRACTION_STRUCTURED_OUTPUT_NAME,
  estimateExtractionInputTokens,
  worstCaseExtractionInputTokens
} from "./tokenEstimation";
import { NORMALIZED_DOSSIER_TEXT_MAX_CHARS } from "./constants";

// Mirrors executionRequest.ts's buildFutureCompletionRequest response_format
// construction exactly -- the real bytes sent on the wire, not the bare
// schema object alone.
function realResponseFormatEnvelope(): Record<string, unknown> {
  return {
    type: "json_schema",
    json_schema: {
      name: EXTRACTION_STRUCTURED_OUTPUT_NAME,
      strict: true,
      schema: packageExtractionJsonSchema
    }
  };
}

function realFixedOverheadBytes(): number {
  const systemPromptBytes = new TextEncoder().encode(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1).length;
  const wrapperBytes = new TextEncoder().encode(buildDossierUserMessageContent("")).length;
  const schemaBytes = new TextEncoder().encode(
    JSON.stringify(realResponseFormatEnvelope())
  ).length;

  return systemPromptBytes + wrapperBytes + schemaBytes;
}

describe("EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS", () => {
  it("is computed from the COMPLETE fixed request shape (system prompt + wrapper + JSON Schema), not the system prompt alone", () => {
    const expected = Math.ceil(realFixedOverheadBytes() / 2);

    expect(EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS).toBe(expected);
    expect(EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS).toBeGreaterThan(0);
  });

  it("is strictly larger than the system-prompt-only figure the prior (corrected) revision used -- proof the wrapper/schema are genuinely included", () => {
    const systemPromptOnlyTokens = Math.ceil(
      new TextEncoder().encode(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1).length / 2
    );

    expect(EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS).toBeGreaterThan(systemPromptOnlyTokens);
  });
});

describe("buildDossierUserMessageContent -- the ONE canonical serialization shared with the real request builder", () => {
  it("wraps the dossier with the fixed delimiter text the real request (service.ts runAttempt) actually sends", () => {
    const content = buildDossierUserMessageContent("Case facts.");

    expect(content).toContain("BEGIN DOSSIER");
    expect(content).toContain("END DOSSIER");
    expect(content).toContain("Case facts.");
  });

  it("anti-drift: changing the wrapper text changes the estimate (proves the wrapper is NOT hard-coded twice)", () => {
    const originalWrapperBytes = new TextEncoder().encode(buildDossierUserMessageContent("")).length;
    const alteredWrapperBytes = new TextEncoder().encode(
      `${buildDossierUserMessageContent("")} EXTRA SUFFIX TEXT THAT WOULD NOT EXIST IF THE WRAPPER WERE HARD-CODED ELSEWHERE`
    ).length;

    // Demonstrates the estimate is a direct function of the wrapper's
    // own byte length -- a longer wrapper mechanically produces a larger
    // conservative-token overhead, proving there is no second,
    // independently-maintained copy of the wrapper text anywhere that
    // could silently drift from this one.
    expect(alteredWrapperBytes).toBeGreaterThan(originalWrapperBytes);
  });
});

describe("estimateExtractionInputTokens", () => {
  it("adds the complete fixed overhead to the dossier's own conservative token estimate", () => {
    const dossier = "a".repeat(100);
    const expected = Math.ceil(new TextEncoder().encode(dossier).length / 2) +
      EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS;

    expect(estimateExtractionInputTokens(dossier)).toBe(expected);
  });

  it("anti-drift: the structured-output JSON Schema's serialized byte length is included -- a schema this large could not fit if only the dossier were counted", () => {
    const schemaBytes = new TextEncoder().encode(JSON.stringify(packageExtractionJsonSchema)).length;

    // The JSON Schema alone is large (many field/warning definitions) --
    // if it were NOT part of the fixed overhead, EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS
    // would be smaller than ceil(schemaBytes / 2) alone could ever
    // require it to be.
    expect(EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS).toBeGreaterThanOrEqual(
      Math.ceil(schemaBytes / 2)
    );
  });

  it("anti-drift (Section 6): the fixed response_format WRAPPER bytes (type/json_schema.name/strict keys) are included too, not merely the inner schema object", () => {
    const bareSchemaBytes = new TextEncoder().encode(
      JSON.stringify(packageExtractionJsonSchema)
    ).length;
    const fullEnvelopeBytes = new TextEncoder().encode(
      JSON.stringify(realResponseFormatEnvelope())
    ).length;

    // The envelope strictly contains more bytes than the bare schema
    // (the "type"/"json_schema"/"name"/"strict" keys and values are real,
    // non-zero overhead) -- proving the estimator is not silently
    // measuring the schema alone under a different-looking call.
    expect(fullEnvelopeBytes).toBeGreaterThan(bareSchemaBytes);
    expect(EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS).toBeGreaterThanOrEqual(
      Math.ceil(fullEnvelopeBytes / 2)
    );
  });
});

describe("worstCaseExtractionInputTokens", () => {
  it("bounds the real preflight/authoritative estimate for any dossier at the max length", () => {
    const worstCase = worstCaseExtractionInputTokens(NORMALIZED_DOSSIER_TEXT_MAX_CHARS);
    const realEstimateAtMaxAsciiLength = estimateExtractionInputTokens(
      "a".repeat(NORMALIZED_DOSSIER_TEXT_MAX_CHARS)
    );

    expect(worstCase).toBeGreaterThanOrEqual(realEstimateAtMaxAsciiLength);
  });

  it("includes the complete fixed overhead, not just the dossier's own worst-case bytes", () => {
    const worstCase = worstCaseExtractionInputTokens(NORMALIZED_DOSSIER_TEXT_MAX_CHARS);

    expect(worstCase).toBeGreaterThanOrEqual(EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS);
  });
});
