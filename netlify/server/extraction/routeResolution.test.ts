// Milestone 7A -- extraction-specific route eligibility tests (ADR 0004
// Decisions 9, 10). Proves the 65,000-token output floor is what gates
// eligibility -- never the 1000/1200 advocate/judge caps, and never the
// Tribunal FREE/BUDGET/PREMIUM tier classifier (which is never even
// imported here).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";
import { EXTRACTION_OUTPUT_CAP_TOKENS } from "./constants";
import { resolveExtractionModelRoute } from "./routeResolution";

const thisTestFile = fileURLToPath(import.meta.url);

const model: RawOpenRouterModel = { id: "vendor/model", canonical_slug: "vendor/model-canonical" };

function endpoint(overrides: Partial<RawOpenRouterEndpoint> = {}): RawOpenRouterEndpoint {
  return {
    tag: "vendor/model/endpoint-a",
    supported_parameters: ["response_format", "max_completion_tokens"],
    max_completion_tokens: EXTRACTION_OUTPUT_CAP_TOKENS,
    context_length: 200_000,
    max_prompt_tokens: 190_000,
    pricing: { prompt: "0.000001", completion: "0.000002" },
    ...overrides
  };
}

describe("resolveExtractionModelRoute", () => {
  it("is eligible when max_completion_tokens meets the 65,000 extraction floor", () => {
    const result = resolveExtractionModelRoute({
      configuredModelId: "vendor/model",
      models: [model],
      endpoints: [endpoint()],
      estimatedInputTokens: 1000,
      observedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(result.eligible).toBe(true);
  });

  it("is ineligible when max_completion_tokens is below 65,000, even though it would satisfy the advocate (1000) or judge (1200) caps", () => {
    const result = resolveExtractionModelRoute({
      configuredModelId: "vendor/model",
      models: [model],
      endpoints: [endpoint({ max_completion_tokens: 1200 })],
      estimatedInputTokens: 1000,
      observedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reasonCodes).toContain("BOUNDED_OUTPUT_UNSUPPORTED");
    }
  });

  it("is ineligible when context_length cannot fit estimatedInputTokens + EXTRACTION_OUTPUT_CAP_TOKENS", () => {
    const result = resolveExtractionModelRoute({
      configuredModelId: "vendor/model",
      models: [model],
      endpoints: [endpoint({ context_length: EXTRACTION_OUTPUT_CAP_TOKENS })],
      estimatedInputTokens: 1000,
      observedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reasonCodes).toContain("CONTEXT_TOO_SMALL");
    }
  });

  it("blocks a tilde-alias model as MODEL_ALIAS_NOT_PINNED, never reaching pricing/endpoint checks", () => {
    const result = resolveExtractionModelRoute({
      configuredModelId: "vendor/~model-latest",
      models: [],
      endpoints: [],
      estimatedInputTokens: 1000,
      observedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(result.eligible).toBe(false);
    if (!result.eligible) {
      expect(result.reasonCodes).toEqual(["MODEL_ALIAS_NOT_PINNED"]);
    }
  });

  it("selects the lowest-cost eligible endpoint deterministically among multiple eligible candidates", () => {
    const cheap = endpoint({ tag: "vendor/model/cheap", pricing: { prompt: "0.0000001", completion: "0.0000002" } });
    const expensive = endpoint({ tag: "vendor/model/expensive", pricing: { prompt: "0.00001", completion: "0.00002" } });

    const result = resolveExtractionModelRoute({
      configuredModelId: "vendor/model",
      models: [model],
      endpoints: [expensive, cheap],
      estimatedInputTokens: 1000,
      observedAt: "2026-01-01T00:00:00.000Z"
    });

    expect(result.eligible).toBe(true);
    if (result.eligible) {
      expect(result.route.providerEndpointTag).toBe("vendor/model/cheap");
    }
  });

  it("never inspects a Tribunal tier classification -- eligibility is a pure function of THIS request's own inputs", () => {
    // Structural proof, not a runtime assertion: this module imports
    // nothing from routeTierEconomics.ts or pricing.ts's classifyPriceTier.
    const sourcePath = thisTestFile.replace(/\.test\.ts$/, ".ts");
    const source = readFileSync(sourcePath, "utf8");

    expect(source).not.toMatch(/classifyPriceTier|routeTierEconomics/);
  });
});
