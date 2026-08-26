// Milestone 7 -- provider attempt telemetry contract (ADR Decision 18).
// M7 makes zero real provider calls, so this defines the TypeScript/Zod
// interface only -- `model_call_attempts` is not created until M8/M10 has
// a real write path. Unavailable failed-attempt token/cost fields are
// null, never fabricated zero.

import { z } from "zod";
import type { ProviderErrorCategory } from "./errors";

export const providerErrorCategorySchema = z.enum([
  "TIMEOUT",
  "TRANSIENT_NETWORK",
  "PROVIDER_5XX",
  "RATE_LIMITED",
  "AUTHENTICATION",
  "INVALID_PROVIDER_REQUEST",
  "INVALID_PROVIDER_RESPONSE",
  "MODEL_INELIGIBLE",
  "PRICING_UNAVAILABLE",
  "PRICING_UNREPRESENTABLE",
  "UNKNOWN"
]) satisfies z.ZodType<ProviderErrorCategory>;

export const modelCallAttemptSchema = z.object({
  logicalParticipantId: z.string(),
  configuredModelId: z.string(),
  canonicalModelId: z.string().nullable(),
  providerEndpointTag: z.string().nullable(),
  providerDisplayName: z.string().nullable(),
  attemptNumber: z.number().int().min(1).max(2),
  status: z.enum(["SUCCESS", "FAILED"]),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  totalTokens: z.number().int().nullable(),
  // Decimal strings, never JS numbers, matching PricingSnapshot's public
  // serialization (ADR Decision 9/10).
  pricingSnapshot: z
    .object({
      promptPricePerToken: z.string(),
      completionPricePerToken: z.string(),
      requestPriceUsd: z.string(),
      effectiveInputPricePerToken: z.string(),
      observedAt: z.string()
    })
    .nullable(),
  actualProviderCostUsd: z.string().nullable(),
  derivedComparisonCostUsd: z.string().nullable(),
  latencyMs: z.number().int().nullable(),
  providerRequestId: z.string().nullable(),
  normalizedError: providerErrorCategorySchema.nullable()
});

export type ModelCallAttempt = z.infer<typeof modelCallAttemptSchema>;
