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
  // Correction (live integration gate, real-data defect): the official
  // OpenRouter OpenAPI (https://openrouter.ai/openapi.json,
  // components.schemas.PricingOverride.properties.utc_days) declares
  // this an array of STRINGS -- the documented weekday enum
  // ("monday".."sunday"), with `x-speakeasy-unknown-values: allow`
  // explicitly permitting future values outside that enum. The real
  // live GET /models catalog contains string utc_days entries, which
  // the previous z.array(z.number()) declaration rejected outright,
  // failing the *entire* model-list parse for every model whenever any
  // one model used this shape. z.string() (not a weekday enum) is used
  // deliberately: M7 never needs to interpret weekday semantics, since
  // ADR Decision 7A already blocks ANY non-empty pricing.overrides array
  // as PRICING_UNREPRESENTABLE regardless of its contents (see the
  // dedicated regression test below) -- parsing this field is not
  // authorization to price it.
  utc_days: z.array(z.string()).min(1).optional(),
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

// Correction (independent review, pre-live gate): a plain z.object(...)
// strips unknown keys before pricing.ts's classifier ever sees them --
// a future OpenRouter billable dimension this repository does not yet
// know about would silently vanish and could authorize an unrepresented
// charge, violating ADR Decision 7's "no unknown billable behavior may
// silently pass" rule. z.looseObject(...) (Zod 4's passthrough
// mechanism) keeps every unrecognized key on the parsed object instead
// of discarding it, so pricing.ts's `hasUnknownPricingKey` check
// (KNOWN_PRICING_KEYS allowlist) can see and reject it with
// PRICING_UNREPRESENTABLE. The known fields below are still fully typed
// and validated exactly as before -- only genuinely unrecognized keys
// are affected, and only by being preserved rather than dropped; this
// schema still rejects a known field of the wrong type.
export const publicPricingSchema = z.looseObject({
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

// z.looseObject's inferred type is the known shape intersected with an
// index signature for anything else that survived parsing -- exactly
// what pricing.ts's Object.keys(...) allowlist check needs to see.
export type RawPublicPricing = z.infer<typeof publicPricingSchema>;

// ---------------------------------------------------------------------
// GET /models -- coarse discovery metadata (ADR Decision 2).
// ---------------------------------------------------------------------

// M8 reasoning-compatibility correction (Issue #17): OpenRouter's
// model-level reasoning metadata -- distinct from an ENDPOINT's
// supported_parameters (which only says "this endpoint accepts a
// `reasoning` request field," never which effort values it actually
// honors). `supported_efforts` is the array of effort strings this MODEL
// is documented to accept; `null` means every gateway effort is
// accepted, an omitted field means the model exposes no effort
// selection at all. Every field here is optional/untrusted metadata --
// z.array(z.string()) deliberately never pins a closed enum of known
// effort strings, so an unrecognized future value from OpenRouter is
// preserved rather than rejected; the application's own selection logic
// (routeResolution.ts's resolveReasoningPolicy) is solely responsible
// for never choosing an effort value it does not recognize.
export const rawOpenRouterModelReasoningSchema = z.object({
  mandatory: z.boolean().optional(),
  default_enabled: z.boolean().optional(),
  supported_efforts: z.array(z.string()).nullable().optional(),
  default_effort: z.string().optional(),
  supports_max_tokens: z.boolean().optional()
});

export type RawOpenRouterModelReasoning = z.infer<typeof rawOpenRouterModelReasoningSchema>;

export const rawOpenRouterModelSchema = z.object({
  id: z.string().min(1),
  canonical_slug: z.string().min(1).optional(),
  name: z.string().optional(),
  context_length: z.number().optional(),
  supported_parameters: z.array(z.string()).optional(),
  reasoning: rawOpenRouterModelReasoningSchema.optional(),
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

// Correction (independent review, pre-live gate): reverified directly
// against the current official https://openrouter.ai/openapi.json
// ProviderPreferences.max_price schema -- "prompt"/"completion"/
// "request" (also "audio"/"image", not used by V1) are documented as
// `string`, "USD per million prompt/completion tokens" /
// "USD per request" respectively -- the same decimal-string convention
// as PublicPricing's rate fields, never a JS number. The first
// implementation pass used `z.number()` here, which does not match the
// current documented contract and would have forced a lossy
// Decimal -> Number conversion at the request boundary.
export const providerPreferencesSchema = z.object({
  order: z.array(z.string()).optional(),
  only: z.array(z.string()).optional(),
  allow_fallbacks: z.boolean().optional(),
  require_parameters: z.boolean().optional(),
  max_price: z
    .object({
      prompt: z.string().optional(),
      completion: z.string().optional(),
      request: z.string().optional()
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
