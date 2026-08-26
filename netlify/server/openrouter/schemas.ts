// Milestone 7 -- raw OpenRouter runtime schemas.
//
// Provider metadata is untrusted (SECURITY.md): every field this module
// exposes is a Zod-validated string/number, never trusted structurally
// until parsed. Only the fields M7 actually consumes are declared here --
// docs/adr/0003-openrouter-infrastructure.md's "Additional verification"
// sections cite the exact OpenAPI descriptions these schemas mirror.
//
// Pricing rate fields are STRINGS (decimal strings, to avoid float
// precision loss) -- z.string() here, never z.number() or z.coerce.number().
// `usage.cost` on a completion response is the one genuinely different,
// JSON-number representation (see ChatUsageSchema, below) -- Decision 9.

import { z } from "zod";

// ---------------------------------------------------------------------
// PublicPricing / PricingOverride (ADR Decisions 7, 7A, 7B).
// ---------------------------------------------------------------------

export const pricingOverrideSchema = z.object({
  min_prompt_tokens: z.number().optional(),
  utc_days: z.array(z.number()).optional(),
  utc_start: z.number().optional(),
  utc_end: z.number().optional(),
  prompt: z.string().optional(),
  completion: z.string().optional(),
  request: z.string().optional(),
  image: z.string().optional(),
  web_search: z.string().optional(),
  internal_reasoning: z.string().optional(),
  input_cache_read: z.string().optional(),
  input_cache_write: z.string().optional(),
  input_cache_write_1h: z.string().optional()
});

export type RawPricingOverride = z.infer<typeof pricingOverrideSchema>;

export const publicPricingSchema = z.object({
  prompt: z.string(),
  completion: z.string(),
  request: z.string().optional(),
  image: z.string().optional(),
  image_output: z.string().optional(),
  image_token: z.string().optional(),
  audio: z.string().optional(),
  audio_output: z.string().optional(),
  input_audio_cache: z.string().optional(),
  web_search: z.string().optional(),
  internal_reasoning: z.string().optional(),
  input_cache_read: z.string().optional(),
  input_cache_write: z.string().optional(),
  input_cache_write_1h: z.string().optional(),
  overrides: z.array(pricingOverrideSchema).optional(),
  discount: z.number().optional()
});

export type RawPublicPricing = z.infer<typeof publicPricingSchema>;

// ---------------------------------------------------------------------
// GET /models -- coarse discovery metadata (ADR Decision 2).
// ---------------------------------------------------------------------

export const rawOpenRouterModelSchema = z.object({
  id: z.string().min(1),
  canonical_slug: z.string().min(1).optional(),
  name: z.string().optional(),
  context_length: z.number().optional(),
  supported_parameters: z.array(z.string()).optional(),
  pricing: publicPricingSchema.optional()
});

export type RawOpenRouterModel = z.infer<typeof rawOpenRouterModelSchema>;

export const modelListResponseSchema = z.object({
  data: z.array(rawOpenRouterModelSchema)
});

// ---------------------------------------------------------------------
// GET /models/{author}/{slug}/endpoints -- exact per-endpoint metadata
// (ADR Decision 2). `tag` is the provider-routing slug -- never
// automatically an exact single-endpoint pin (ADR Decision 4A).
// ---------------------------------------------------------------------

export const rawOpenRouterEndpointSchema = z.object({
  tag: z.string().min(1),
  provider_name: z.string().optional(),
  name: z.string().optional(),
  context_length: z.number().optional(),
  max_prompt_tokens: z.number().nullable().optional(),
  max_completion_tokens: z.number().nullable().optional(),
  supported_parameters: z.array(z.string()).optional(),
  quantization: z.string().nullable().optional(),
  status: z.union([z.string(), z.number()]).optional(),
  pricing: publicPricingSchema
});

export type RawOpenRouterEndpoint = z.infer<typeof rawOpenRouterEndpointSchema>;

export const endpointListResponseSchema = z.object({
  data: z.object({
    id: z.string().optional(),
    canonical_slug: z.string().optional(),
    endpoints: z.array(rawOpenRouterEndpointSchema)
  })
});

// ---------------------------------------------------------------------
// POST /chat/completions -- request/response infrastructure (Section 8:
// M7 may IMPLEMENT this; M7 must never INVOKE it for real).
// ---------------------------------------------------------------------

export const providerPreferencesSchema = z.object({
  order: z.array(z.string()).optional(),
  only: z.array(z.string()).optional(),
  allow_fallbacks: z.boolean().optional(),
  require_parameters: z.boolean().optional(),
  max_price: z
    .object({
      prompt: z.number().optional(),
      completion: z.number().optional(),
      request: z.number().optional()
    })
    .optional()
});

export type ProviderPreferences = z.infer<typeof providerPreferencesSchema>;

// `usage.cost` is a JSON number (double) -- a genuinely different
// representation than the string-typed catalog/endpoint pricing rate
// fields above (ADR Decision 9). Converted to Decimal exactly once, at
// receipt, in pricing.ts -- never round-tripped through further
// authoritative float arithmetic.
export const chatUsageSchema = z.object({
  prompt_tokens: z.number(),
  completion_tokens: z.number(),
  total_tokens: z.number(),
  cost: z.number().optional()
});

export type RawChatUsage = z.infer<typeof chatUsageSchema>;

export const chatCompletionResponseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string().optional(),
        content: z.string().nullable().optional()
      })
    })
  ),
  usage: chatUsageSchema.optional()
});

export type RawChatCompletionResponse = z.infer<
  typeof chatCompletionResponseSchema
>;
