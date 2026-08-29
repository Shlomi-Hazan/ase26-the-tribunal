// Milestone 8 -- independent audit correction (Issue #17 blocker 1).
// Reuses the existing M7 GET /api/models endpoint (netlify/functions/
// models.ts, netlify/server/openrouter/modelDiscovery.ts) -- no second
// model-discovery backend. Zero-cost metadata only.

export type PriceTier = "FREE" | "BUDGET" | "PREMIUM" | "ABOVE_PREMIUM";

export type EligibleModel = {
  id: string;
  canonicalModelId: string;
  name: string;
  providerName: string;
  contextLength: number;
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  isFree: boolean;
  priceTier: PriceTier;
  conservativeFullTribunalEstimateUsd: string;
  supportsStructuredOutput: boolean;
};

export class ModelsApiError extends Error {
  constructor(readonly status: number) {
    super(`Failed to load the eligible model catalog (HTTP ${status}).`);
    this.name = "ModelsApiError";
  }
}

export async function fetchEligibleModels(): Promise<EligibleModel[]> {
  const response = await fetch("/api/models");

  if (!response.ok) {
    throw new ModelsApiError(response.status);
  }

  const payload = (await response.json().catch(() => ({}))) as { models?: EligibleModel[] };

  return payload.models ?? [];
}
