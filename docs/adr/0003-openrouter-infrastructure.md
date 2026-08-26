# ADR 0003 — OpenRouter Infrastructure (Milestone 7)

## Status

Accepted (planning gate, hardened in a second pass after independent
review of the first). Locks the architectural decisions needed before
Milestone 7 implementation begins. Does not authorize implementation, a
real OpenRouter request, or any change to the live Supabase database.

## Context

Milestone 6 froze participant configuration with zero model calls and a
fixed placeholder `prompt_version = 'unassigned-pre-m7'`
(`docs/adr/0002-participant-configuration-freeze.md` Decision 12).
Milestone 7 must build the provider/pricing/preflight infrastructure
Milestone 8 needs to actually execute the Tribunal, without executing it
itself.

The first planning pass (this document's original version) left several
questions open or under-specified. Independent review found the central
gap: **a configured model ID alone is not enough to authorize spend.**
OpenRouter can serve one model through multiple provider endpoints with
different pricing, capabilities, and context limits — preflight must
resolve and price the *exact* endpoint that execution will later be
pinned to, never a model-level average or a different, cheaper endpoint
than the one actually used.

The already-applied M6 migration
(`supabase/migrations/20260825214212_participant_configuration.sql`) is
immutable historical truth and is not edited by this ADR or by M7. Any
schema/function change M7 or M8 needs is a **new** forward migration.

## Current OpenRouter API verification (this pass)

Verified directly against OpenRouter's published OpenAPI specification
(`https://openrouter.ai/openapi.json`, fetched and inspected in this
task — not recalled from training data) plus OpenRouter's own
documentation/blog pages for behavior not captured in the schema alone.
Exact field names below are taken from that spec, not assumed:

- **`GET /models`** → each model: `id` ("unique model identifier used in
  API requests" — this is the value M6 already freezes verbatim as
  `participant_configs.model_id`), `canonical_slug` ("permanent slug for
  the model that never changes"), `name`, `context_length`, `pricing`
  (per-token, **string-typed** — `prompt`, `completion`, `request`,
  `image`, and, per model, potentially `web_search`,
  `internal_reasoning`, `input_cache_read`, `input_cache_write`),
  `architecture` (`input_modalities`, `output_modalities`, `tokenizer`,
  `instruct_type`), `supported_parameters`, `top_provider`
  (`context_length`, `max_completion_tokens`, `is_moderated` — a
  *representative* provider's capability, not necessarily the specific
  endpoint execution will use).
- **`GET /models/{author}/{slug}/endpoints`** → the exact per-provider
  breakdown M7 needs. Each `endpoints[]` entry: `name` (display, e.g.
  `"OpenAI: GPT-4"`), **`tag`** (e.g. `"openai"` — the provider-routing
  slug value, confirmed against `ProviderPreferences.only`/`.order`'s
  schema, whose items accept exactly this kind of provider-slug string),
  `provider_name` (display, e.g. `"OpenAI"`), `model_id`, `model_name`,
  `context_length`, `max_prompt_tokens`, `max_completion_tokens`,
  `pricing` (same string-typed shape as above, scoped to this endpoint),
  `quantization`, `status`, `supported_parameters`,
  `supports_implicit_caching`, `uptime_last_5m`/`uptime_last_30m`/
  `uptime_last_1d`, `latency_last_30m`, `throughput_last_30m`.
- **`POST /chat/completions`** request: `model` (string), `provider`
  (`ProviderPreferences`: `only` — array of provider slugs to allow;
  `order`; `allow_fallbacks` (default `true`, V1 uses `false`);
  `require_parameters`; `max_price` — object with `prompt`/`completion`/
  `request`/`image`/`audio`, each "USD per million tokens" (`prompt`/
  `completion`) or per-unit; `quantizations`; `data_collection`;
  `ignore`), `response_format` (`{ type: "json_schema", json_schema: {
  name, schema, strict, description } }` — confirms `ARCHITECTURE.md`
  §5.1's existing `strict: true` claim, unchanged), and
  **`max_completion_tokens`** — confirmed current/correct;
  **`max_tokens` is documented as deprecated** ("Maximum tokens
  (deprecated, use max_completion_tokens)"). M7 uses
  `max_completion_tokens`, never the deprecated field.
- **Response `usage`** (`ChatUsage`, the schema actually used by
  `/chat/completions`, not the newer Responses-API-style `Usage`
  schema): `prompt_tokens`, `completion_tokens`, `total_tokens`, and
  **`cost`** — confirmed **JSON `number` (double), not a string**, unlike
  the catalog `pricing` rate fields. `cost_details` additionally reports
  `upstream_inference_cost`, `upstream_inference_prompt_cost`,
  `upstream_inference_completions_cost`. This distinction — rate fields
  are strings, the realized `usage.cost` is a number — is the concrete
  justification for the decimal-arithmetic boundary in Decision 9 below.
- **`GET /generation?id=...`**: detailed post-hoc audit record —
  `id` (the completion response's own top-level `id`, e.g.
  `"gen-3bhGkxlo4XFrqiabUM7NDtwDzWwG"`, is exactly the "provider
  request/generation identifier" `ARCHITECTURE.md`/`SPEC.md` already
  reference), plus `provider_name`, `native_tokens_prompt`,
  `native_tokens_completion`, `latency`, `generation_time`.
- **`openrouter/auto`** — OpenRouter's real, currently-documented
  "Auto Router": explicitly **non-deterministic** ("the same prompt
  today might be handled by a different model tomorrow"); the actually-
  used model is only knowable from the response's `model` field, i.e.
  *after* the call. Structurally cannot satisfy "price and pin before
  execution."
- **`~provider/model-family-latest`** — OpenRouter's real, currently-
  documented "tilde alias" convention, explicitly designed to always
  resolve to the newest model in a family, i.e. a deliberately moving
  target. OpenRouter's own operational guidance is to periodically
  re-fetch `/models` and reconcile hard-coded slugs, because "slugs do
  drift over time" — direct external confirmation that a cache without a
  bounded TTL and re-validation is unsafe for this domain, reinforcing
  the cache design already planned (Decision 3).

**Additional verification (this pass)**, against OpenRouter's official
provider-routing guide
(`https://openrouter.ai/docs/guides/routing/provider-selection`) and the
real OpenAPI `PublicPricing`/`PricingOverride` schemas:

- **Provider slug matching is not automatically an exact pin.** Quoted
  directly: "When you use a base provider slug (e.g. `google-vertex`) in
  any provider routing field (`order`, `only`, or `ignore`), it matches
  **all** endpoints for that provider, including any variants or
  regions." Documented examples: `google-vertex` matches every Google
  Vertex region, while `google-vertex/us-east5` matches only that one
  region; `deepinfra` matches both its default and `turbo` endpoints,
  while `deepinfra/turbo` matches only the turbo variant. (Service-tier
  endpoints such as `openai/fast` additionally require explicit opt-in —
  a base slug does not match them either way, which is not itself a
  pinnability concern for V1 but is noted for completeness.) This directly
  falsifies the first pass's claim that `provider.only: [tag]` is always
  an exact single-endpoint restriction — see Decision 4A and Decision 6.
- **Request-level `only` narrows, not merges independently:**
  "your account-wide allowed providers act as the ceiling, and the
  request's `only` list narrows within it. If no provider satisfies both,
  the request fails with a `404`." An M8 request builder must not assume
  its own `only` list alone determines the accepted provider set.
- **OpenRouter's own documented exact-pin example uses `order`, not
  `only`:** to "ensure your request is routed to the specific endpoint
  you want," the docs' own example is `order: ["deepinfra/turbo"],
  allowFallbacks: false` — a full variant slug via `order` with fallbacks
  disabled, not `only` alone. This is the documented mechanism Decision 6
  now adopts as primary.
- **`pricing.overrides`** (real field, `PublicPricing.overrides`,
  confirmed via the OpenAPI spec): "Conditional overrides of the base
  pricing (e.g. long-context or time-based pricing). An entry applies
  when all of its condition fields (e.g. `min_prompt_tokens`, or the
  `utc_start`/`utc_end` time window) match the request; among applicable
  entries, later entries win per key... The top-level pricing keys always
  reflect the price that applies under default conditions." Condition
  fields confirmed on `PricingOverride`: `min_prompt_tokens` (numeric
  threshold — "applies when total prompt tokens... strictly greater than
  this"), `utc_days` (weekday enum array), `utc_start`/`utc_end` (HHMM
  numeric daily window). A route whose actual runtime request could match
  a condition (e.g. a long Charge Sheet/judge prompt crossing
  `min_prompt_tokens`) could be billed at a **different** rate than the
  top-level price preflight would otherwise read — see Decision 7 and
  Decision 8.
- **`pricing.discount`** (real field, `PublicPricing.discount`,
  `number`, confirmed via the OpenAPI spec): "Fractional discount applied
  to this endpoint's pricing; the price is multiplied by `(1 - discount)`
  (`0` = no discount, `1` = free)." Structurally, a discount can only
  reduce the effective price relative to the base rate — it is
  mathematically impossible for `(1 - discount)` with `discount ∈ [0, 1]`
  to exceed `1` — see Decision 7A.

**Additional verification (this pass — cache economics)**, against the
real OpenAPI `PublicPricing` schema and OpenRouter's official prompt-
caching guide
(`https://openrouter.ai/docs/guides/best-practices/prompt-caching`):

- **The schema exposes three cache-related price fields**, all currently
  documented on `PublicPricing`: `input_cache_read` ("Price in USD per
  cached input token (read)"), `input_cache_write` ("Price per
  cache-write token, in USD per token. For providers with multiple cache
  TTLs (e.g. Anthropic), this is the default (5-minute) cache-write
  rate."), and `input_cache_write_1h` ("Price per 1-hour cache-write
  token, in USD per token. Only present for providers that price an
  extended (1-hour) cache TTL separately, such as Anthropic."). This
  directly falsifies the second pass's claim that all
  caching/implicit-caching behavior is one-directional (cheaper) —
  `input_cache_write`/`input_cache_write_1h` are distinct, real,
  **write** rates, not read discounts.
- **Cache writes cost more than ordinary input for both major
  providers, confirmed in OpenRouter's own guide.** Anthropic: "Cache
  writes: charged at 1.25x the price of the original input pricing" for
  the default 5-minute TTL, and "charged at 2x the price of the original
  input pricing" for the 1-hour TTL. OpenAI (GPT-5.6+ family): "Cache
  writes: no cost on models before the GPT-5.6 family. GPT-5.6 and later
  charge cache writes at 1.25x the price of the original input pricing,
  even with automatic caching — no opt-in required." Cache **reads** are
  confirmed cheaper on both: Anthropic "charged at 0.1x," OpenAI
  "charged at 0.25x or 0.50x."
- **Cache-write triggering differs materially by provider — this is the
  root cause of the risk.** OpenAI's guide states plainly: "Prompt
  caching with OpenAI is automated and does not require any additional
  configuration" — and, per the quote above, GPT-5.6+ cache-write
  charges apply "even with automatic caching — no opt-in required," i.e.
  purely by virtue of the request shape, with **zero** app-side action.
  Anthropic, by contrast, requires an explicit `cache_control` field
  added to the request content — "Automatic caching: Add a single
  `cache_control` field at the top level of your request" — and the
  1-hour tier requires a further explicit `"ttl": "1h"` inside that same
  `cache_control` object. If the Tribunal request contract never sends
  `cache_control` at all (it does not, V1 requests no caching feature of
  any kind), an Anthropic cache-write charge cannot be triggered by the
  Tribunal's own request; an OpenAI (GPT-5.6+ family) cache-write charge
  *can* be triggered purely by the request's shape, with no Tribunal
  opt-in at all.
- **Consequence:** the second pass's claim — "provider *implicit*
  caching... may reduce *actual* realized cost below the conservative
  bound... that is safe" — is **false** as a universal statement. It was
  true only insofar as it considered *cache reads*; it did not account
  for *cache writes*, which the schema and the provider docs both
  confirm are real, currently non-zero-priced, and — for at least one
  major model family reachable through OpenRouter — triggerable with
  zero Tribunal-side opt-in. See Decision 7B.

## Decision 1 — One provider abstraction, one fake

Unchanged from the first pass. M7 introduces exactly one server-side
interface:

```ts
interface OpenRouterProvider {
  listModels(): Promise<RawOpenRouterModel[]>;
  listEndpoints(author: string, slug: string): Promise<RawOpenRouterEndpoint[]>;
  createChatCompletion(request: ProviderChatRequest): Promise<ProviderChatResult>;
}
```

(`listEndpoints` is added in this pass — the original interface only
covered the model-level catalog call, which is not sufficient for route
resolution; see Decision 2.) One real (`fetch`-based) and one
deterministic in-memory fake implementation satisfy every consumer. No
second provider abstraction for hypothetical future gateways.

## Decision 2 — Model discovery vs. resolved execution route are distinct concepts

**Model catalog** (`GET /models`) is coarse, model-level discovery
metadata — enough to list "what models exist," not enough to authorize
spend.

**Resolved execution route** is one exact eligible provider endpoint for
one exact canonical model, whose capabilities and pricing were the ones
authoritative preflight actually used. M7 locks this domain type:

```ts
type ResolvedModelRoute = {
  configuredModelId: string;      // OpenRouter model `id`, verbatim from
                                   // the frozen M6 participant_configs.model_id
                                   // -- never altered by M7
  canonicalModelId: string;       // OpenRouter model `canonical_slug`

  providerEndpointTag: string;    // OpenRouter endpoint `tag` -- a
                                   // provider-ROUTING SLUG, not
                                   // automatically an exact single-endpoint
                                   // pin (see the correction below)
  isUniquelyPinnable: boolean;    // proven true only when this exact tag
                                   // resolves to exactly one endpoint under
                                   // OpenRouter's slug-matching rules
                                   // (Decision 4A) -- a route can only ever
                                   // become a ResolvedModelRoute (i.e. reach
                                   // Decision 5's selection) when this is true
  providerDisplayName: string;    // OpenRouter endpoint `provider_name` --
                                   // display/audit only, never used for routing
  endpointDisplayName: string;    // OpenRouter endpoint `name` -- display/audit only

  contextLength: number;              // endpoint `context_length`
  maxPromptTokens: number | null;     // endpoint `max_prompt_tokens`
  maxCompletionTokens: number | null; // endpoint `max_completion_tokens`
  supportedParameters: string[];      // endpoint `supported_parameters`
  quantization: string | null;        // endpoint `quantization`

  pricing: PricingSnapshot;
  observedAt: string;             // ISO 8601 -- drives the TTL in Decision 3
};
```

**Correction (this pass):** the first pass claimed `providerEndpointTag`
(OpenRouter's `tag`) is "the only field ever used to pin execution" as if
any `tag` value were automatically an exact single-endpoint restriction.
That is too strong and is corrected by Decision 4A and Decision 6 below —
a `tag` may be a *base* provider slug that matches multiple endpoint
variants/regions for that provider (e.g. `"deepinfra"` matches both its
default and `turbo` endpoints), not a guaranteed unique pin. Only a `tag`
proven uniquely pinnable (`isUniquelyPinnable: true`) may ever reach
`ResolvedModelRoute`; a route whose tag is not uniquely pinnable is
blocked before this type is ever constructed (Decision 4A).
`providerDisplayName`/`endpointDisplayName` (= `provider_name`/`name`)
remain display/audit only and are never fed into a routing parameter.

Resolution pipeline: `GET /models` (existence/coarse filter) → `GET
/models/{author}/{slug}/endpoints` (all real candidate endpoints for that
exact model) → filter to eligible + uniquely-pinnable endpoints
(Decisions 4, 4A) → deterministic selection (Decision 5) →
`ResolvedModelRoute`.

## Decision 3 — Model catalog and endpoint caching: bounded in-process cache, 5-minute authoritative TTL

Unchanged infrastructure shape from the first pass, now with an exact
locked constant (the first pass deliberately left this a tuning detail;
this pass locks it, since planning must be implementation-ready):

```ts
const MODEL_METADATA_TTL_MS = 300_000; // 5 minutes
```

```text
age <  MODEL_METADATA_TTL_MS  -> fresh
age >= MODEL_METADATA_TTL_MS  -> stale
```

- In-process, per-Function-instance, bounded, keyed by
  `(configuredModelId)` for the endpoint list, with a stored fetch
  timestamp. Not a database table, not Redis, not a queue (§16).
- Stale metadata **never** authorizes preflight, regardless of how the
  staleness arose (age past TTL, or a failed re-fetch with only a stale
  copy available).
- Failure matrix:

  | Fresh cache | Provider fetch | Result |
  |---|---|---|
  | yes | not attempted / not needed | use fresh cache |
  | no (stale) | succeeds | use the new fetch |
  | no (stale) | fails | **block** — stale copy is never used for an authoritative decision |
  | none | succeeds | use the new fetch |
  | none | fails | **block** |

- Injectable clock in tests (`now(): number` or equivalent), so
  fresh/stale boundary tests are deterministic, not wall-clock-dependent.
- No new infrastructure dependency for the cache itself.

## Decision 4 — Authoritative endpoint eligibility

An endpoint from `ResolvedModelRoute`'s candidate list is eligible for a
participant only if **all** hold, checked at the endpoint level — never
inferred from model-level `top_provider` capability summaries when
endpoint-level `supported_parameters`/`max_completion_tokens`/
`context_length` are available, since `top_provider` may not be the
endpoint actually selected:

1. the configured model resolves to an accepted canonical model (not
   blocked under Decision 8's alias/dynamic-router policy)
2. `supported_parameters` includes what the Tribunal's structured-output
   request needs (confirmed request shape: `response_format` with
   `json_schema`/`strict`)
3. the endpoint supports a bounded-output parameter — M7 uses
   `max_completion_tokens` (current), never the deprecated `max_tokens`
4. advocate route: `maxCompletionTokens` (if present) is `>= 1000`;
   `null` is treated as "provider-reported ceiling unknown," which is
   itself blocked (a route that cannot state its own completion ceiling
   cannot be conservatively bounded) — see reason code
   `BOUNDED_OUTPUT_UNSUPPORTED`
5. judge route: `maxCompletionTokens` (if present) is `>= 1200`; same
   `null` handling as above
6. `contextLength` is sufficient for the conservative input bound
   (`docs/economics.md` §10.1–§10.3) plus the applicable output cap
7. pricing is complete and representable per Decision 7 (billable
   dimensions), carries no unrepresentable conditional pricing per
   Decision 7A (`overrides`/malformed `discount`), and its cache-related
   pricing is either impossible-to-invoke or safely bounded per Decision
   7B (`effectiveInputPricePerToken`) — never silently assumed one-
   directional
8. the endpoint is **uniquely pinnable** — see Decision 4A; an endpoint
   whose `tag` cannot be proven to identify exactly one endpoint is never
   eligible

`require_parameters: true` remains request-time defense in depth
(`ARCHITECTURE.md` §5.2) — it does not substitute for this endpoint-level
eligibility check, which runs before any request is ever built.

## Decision 4A — Unique pinnability rule (corrects the first pass)

**The first pass's claim that any endpoint `tag` is automatically an
exact single-endpoint restriction was too strong and is corrected here.**
Confirmed against OpenRouter's official provider-routing documentation
(see "Additional verification," above): a provider slug used in any
routing field matches **all** endpoints for that provider, including
variants and regions, unless the slug is itself the specific variant —
e.g. `deepinfra` matches both its default and `turbo` endpoints, while
`deepinfra/turbo` matches only the turbo variant.

**Rule:** before an endpoint can become a `ResolvedModelRoute`, M7 proves
that its `tag`, evaluated under OpenRouter's documented slug-matching
semantics against every endpoint currently returned for that exact model,
identifies **one and only one** endpoint in the current candidate set.

- `tag` is a full variant/region slug (contains the `/` variant suffix,
  e.g. `deepinfra/turbo`, `google-vertex/us-east5`) → potentially
  uniquely pinnable, `isUniquelyPinnable = true` if no other candidate
  endpoint for this model shares that exact full slug.
- `tag` is a base slug (no variant suffix, e.g. `deepinfra`) **and** the
  model's current endpoint set contains more than one endpoint whose
  `tag` starts with that base slug (i.e. sibling variants/regions exist)
  → **not** uniquely pinnable, `isUniquelyPinnable = false`.
- `tag` is a base slug and the model's current endpoint set contains
  exactly one endpoint for that provider at all (no sibling variants
  exist right now) → uniquely pinnable *today*, but this is re-verified
  every time metadata is re-fetched (Decision 3's TTL), since a sibling
  variant could appear later — the pinnability check is never a one-time
  determination cached independently of the metadata TTL.

**For V1, a route that is not uniquely pinnable is blocked** — reason
code `ENDPOINT_NOT_PINNABLE`. M7 never silently widens acceptance to "any
endpoint under this base slug" merely because a base slug is convenient;
doing so would mean preflight priced one specific endpoint while a future
request pinned by that same base slug could actually route to a
different, differently-priced sibling.

## Decision 5 — Deterministic endpoint selection

When multiple eligible endpoints exist for the exact selected model:

1. filter to all endpoints satisfying Decision 4 in full
2. compute the conservative Tribunal cost using *each* candidate
   route's own pricing (`docs/economics.md` §10)
3. choose the lowest-cost eligible route
4. tie-break deterministically and stably — by `providerEndpointTag`
   lexical order, so the same input always yields the same selection in
   tests and in production

**Never** select the cheapest endpoint first and then discover it lacks a
required capability. Eligibility filtering (Decision 4) always precedes
cost comparison. Example: a cheaper endpoint lacking structured-output
support is never considered "the price"; only an eligible endpoint's
price is ever used.

## Decision 6 — Preflight route is bound to future execution; no silent endpoint/model drift

**Locked invariant: PREFLIGHT ROUTE = FUTURE EXECUTION ROUTE.** The
authoritative rule is that the routing slug execution eventually uses
must have been proven uniquely pinnable by M7 preflight (Decision 4A) —
`provider.only` alone does not itself prove or grant that.

M8 must not compute preflight against one endpoint and let OpenRouter
freely route the actual completion to a different one. **Corrected
mechanism (this pass):** OpenRouter's own documented example for
"ensure your request is routed to the specific endpoint you want" pins
via `order` with a full variant slug and `allow_fallbacks: false` —
`order: ["deepinfra/turbo"], allowFallbacks: false` — not `only` alone.
The future completion request (M8, not M7 — M7 makes no completion call)
must therefore use:

- `provider.order: [providerEndpointTag]` — the **primary** pinning
  mechanism, a single-element list containing the exact, already-proven-
  uniquely-pinnable `tag` (never a base slug — Decision 4A guarantees
  this route's `tag` is not one)
- `provider.allow_fallbacks: false` — required for `order` to actually
  restrict rather than merely prefer
- `provider.only: [providerEndpointTag]` — the **same** tag, as an
  *additional*, redundant restriction, not the primary mechanism (the
  first pass over-relied on `only` alone; `only` interacts with
  account-wide allowed-provider settings as a narrowing ceiling, not an
  independent guarantee — see "Additional verification," above)
- `provider.require_parameters: true`
- `provider.max_price` set consistent with the accepted pricing bound,
  as defense in depth (never the primary control — the accepted
  `ResolvedModelRoute`'s own pricing is)

Account-wide allowed-provider configuration must never cause the request
builder to silently execute a different accepted route than the one
`order`/`only` name — if the account-wide ceiling and the request's
`order`/`only` don't overlap on the exact pinned endpoint, OpenRouter's
documented behavior is to fail the request (`404`), which is the correct
outcome here, not a silent broadening.

If the exact accepted endpoint is unavailable at execution time (M8), the
attempt fails/blocks per the normalized error policy (Decision 11). It
never silently moves to a different endpoint, a sibling/base-provider
endpoint, or a different model. M7 itself performs zero completion
calls — this decision defines the contract M8 must implement, not
something M7 executes.

## Decision 7 — Billable dimensions

Confirmed real OpenRouter pricing dimensions (Current OpenRouter API
verification, above): `prompt`, `completion`, `request`, `image`,
`image_output`, `image_token`, `audio`, `audio_output`,
`input_audio_cache`, `web_search`, `internal_reasoning`,
`input_cache_read`, `input_cache_write`, `input_cache_write_1h`, plus
the two pricing *modifiers* `overrides` and `discount` — see Decision 7A
for the overrides/discount policy and Decision 7B for the cache-write
policy (corrected this pass — the prior "caching can only reduce spend"
claim was false, see "Additional verification — cache economics,"
above). V1 Tribunal is text-only, sends no image/audio content, enables
no web-search plugin, and sends no explicit cache-control request field
of any kind.

Every dimension and modifier is classified into exactly one of three
buckets — no current or future field may pass eligibility unclassified:

1. **Ignored because impossible for the Tribunal's request to invoke**:
   `image`, `image_output`, `image_token`, `audio`, `audio_output`,
   `input_audio_cache`, `web_search` — no such plugin/content is ever
   sent, so these dimensions structurally cannot be charged; exclusion
   is justified by the request contract itself, not by assumption.
2. **Ignored because it can only ever reduce realized spend below the
   conservative bound, never increase it**: `pricing.discount` alone
   (Decision 7A) — safe to ignore for the conservative upper bound
   precisely because it is mathematically one-directional
   (`(1 - discount) ∈ [0, 1]`, so it can only lower or hold equal the
   price). **Cache pricing is explicitly NOT in this bucket** (corrected
   this pass) — see Decision 7B; a cache *write* rate can exceed the
   ordinary input rate, so it cannot be safely ignored the way a pure
   discount can.
3. **Represented as an upper bound, or blocked, because the dimension
   can increase or alter the effective price**: `internal_reasoning`
   when non-zero blocks (`PRICING_UNREPRESENTABLE` — reasoning-token
   count is not bounded by the Tribunal's request contract);
   `pricing.overrides` when non-empty blocks (`PRICING_UNREPRESENTABLE`
   — Decision 7A, the top-level price is only the *default-conditions*
   price); `input_cache_read`/`input_cache_write` are folded into a
   conservative `effectiveInputPricePerToken` upper bound rather than
   blocking outright (Decision 7B); `input_cache_write_1h` is excluded
   as impossible for the current request contract to invoke (Decision
   7B) — not because it is one-directional, but because the Tribunal
   request contract structurally cannot trigger it.

Concretely for the dimensions already covered before this pass:

- **Always included** in the conservative bound: `prompt`, `completion`
  (the two dimensions every text completion always incurs) — `prompt`'s
  role in the bound is superseded where applicable by
  `effectiveInputPricePerToken` (Decision 7B), which is never lower than
  `promptPricePerToken`.
- **Included once per attempt, reserved twice per logical call** (initial
  + the one permitted retry) when non-zero: `request` — a flat per-call
  fee is incurred again on a retry, so the retry reserve must include it
  too, not just the token cost.
- **`internal_reasoning`**: bucket 3 above — non-zero blocks with
  `PRICING_UNREPRESENTABLE`.
- **Cache dimensions**: see Decision 7B — no longer assumed one-
  directional.
- **Any other current or future non-zero/non-empty billable dimension**
  the Tribunal's request contract cannot structurally rule out (bucket 1)
  or prove one-directional (bucket 2) is blocked or bounded per bucket 3,
  never assumed zero and never assumed safe-to-ignore without a proof
  like discount's closed-form `(1 - discount)` property.

## Decision 7A — `pricing.overrides` and `pricing.discount` policy (new this pass)

Verified this pass (see "Additional verification," above) directly from
the current `PublicPricing`/`PricingOverride` OpenAPI schemas — both
fields are real and currently documented, and neither was accounted for
in the first two planning passes.

**`pricing.overrides` — V1 policy: non-empty blocks eligibility.**

- `overrides` is an array of conditional pricing entries
  (`min_prompt_tokens`, `utc_days`, `utc_start`/`utc_end`); when an
  entry's conditions match the actual request, its price keys replace
  the corresponding top-level price for that request, and "the top-level
  pricing keys always reflect the price that applies under default
  conditions" — i.e. the top-level price is not guaranteed to be the
  request's actual price whenever `overrides` is non-empty.
- **Locked V1 policy:** if a candidate endpoint's `pricing.overrides` is
  non-empty, that endpoint is **not eligible** —
  `PRICING_UNREPRESENTABLE`. V1 does not implement a conditional-pricing
  evaluation engine (no time-of-day/day-of-week clock logic, no
  prompt-token-count-conditional branching in the pricing layer); building
  one is explicitly out of scope for M7.
- If `pricing.overrides` is empty or absent, normal eligibility/pricing
  flow (Decisions 4, 7, 9) continues unchanged — this is the common case
  today for the vast majority of endpoints.
- This policy is conservative by construction: it can only ever cause the
  system to decline a route that might have been priceable, never to
  under-price one.

**`pricing.discount` — V1 policy: conservative, never relied upon.**

- `discount` is a `number`, "Fractional discount applied to this
  endpoint's pricing; the price is multiplied by `(1 - discount)`" —
  since `discount ∈ [0, 1]` by definition, `(1 - discount) ∈ [0, 1]`,
  so applying it can only ever **lower or hold equal** the effective
  price relative to the undiscounted base rate; it can never raise it.
  This is a closed-form mathematical property of the field's own
  documented definition, not an assumption.
- **Locked V1 policy:** preflight pricing, budget-tier classification,
  and the $5.00 ceiling bound are always computed from the **undiscounted
  base `pricing.*` rate fields**, never from a rate with `discount`
  applied. A positive `discount` is never relied upon to make a route fit
  a budget tier or the hard ceiling that the undiscounted rate would not
  already satisfy on its own.
- **FREE-tier consequence:** a route is classified `FREE` (Decision 12)
  only when its **undiscounted** V1-relevant charges are themselves
  exactly `$0.00`. An endpoint that is merely discounted toward zero
  (`discount` close to but not equal to `1`, or `discount = 1` applied to
  a non-zero base rate) is **not** FREE under this policy — the
  undiscounted base rate is what is classified and bounded.
- This policy is conservative by construction: since `discount` can only
  reduce actual realized spend below the computed bound, ignoring it
  never causes the bound to understate risk; it can only make the bound
  more conservative than strictly necessary.
- **Metadata validation, hardened this pass:** `discount` is not merely
  ignored blindly — it is validated first. Absent `discount` is accepted
  (equivalent to `0`, no discount). A present `discount` within the
  documented semantic range `[0, 1]` is accepted and ignored per the
  policy above. A present `discount` that is malformed, non-finite
  (`NaN`/`Infinity`), negative, or greater than `1` is **not** silently
  clamped or ignored — the field no longer matches its own documented
  contract, so the endpoint is **not eligible**, `PRICING_UNREPRESENTABLE`.
  This closes a gap the first two passes left open: malformed discount
  metadata must never be able to silently become a hidden price increase
  by falling through an assumption that `discount` is always safely
  ignorable regardless of its actual value.

## Decision 7B — Cache-aware effective input price (corrects the second pass)

**Locked invariant: A CACHE-RELATED PRICE FIELD MAY NEVER BE ASSUMED TO
ONLY LOWER SPEND.** The second pass's Decision 7 claimed provider
implicit caching "may reduce *actual* realized cost below the
conservative bound... that is safe." **This is false and is retracted.**
Verified this pass (see "Additional verification — cache economics,"
above): OpenRouter's `PublicPricing` schema exposes a genuine **write**
rate (`input_cache_write`, and a separate extended-TTL
`input_cache_write_1h`) alongside the read rate (`input_cache_read`);
provider documentation confirms cache writes are billed at a **premium**
over ordinary input — Anthropic 1.25x (default 5-minute TTL) or 2x
(1-hour TTL), OpenAI (GPT-5.6+ family) 1.25x, with OpenAI's write charge
triggerable by request shape alone, "even with automatic caching — no
opt-in required."

**Effective conservative input price.** For every resolved endpoint, the
conservative estimator computes an `effectiveInputPricePerToken` used in
place of the raw `promptPricePerToken` wherever input-token cost is
estimated:

```text
effectiveInputPricePerToken = MAX(
  promptPricePerToken,
  automaticallyApplicableCacheReadPricePerToken,   -- input_cache_read, when present
  automaticallyApplicableCacheWritePricePerToken   -- input_cache_write, when present
)
```

Computed via exact `Decimal` arithmetic (Decision 10), never binary
floating point. This is deliberately an **upper bound, not a
prediction** — overestimation is acceptable and expected (a real request
may only cache a prefix, or hit no cache at all); underestimation, by
assuming a cache write can never exceed ordinary input, is not.

**Cache-read policy (`input_cache_read`).** Never relied on as a
discount. When present, it is included in the `MAX(...)` calculation
above like every other candidate rate. In the documented common case
(`0.1x`–`0.5x` of input price) it is below `promptPricePerToken` and
therefore does not change the bound. If provider metadata were ever to
report a cache-read price above the prompt price, the `MAX(...)`
formula remains safe by construction — it does not special-case "reads
are always cheap."

**Default/automatic cache-write policy (`input_cache_write`).** When an
endpoint's pricing exposes a non-zero `input_cache_write` rate, it is
treated as **automatically/potentially applicable** and is included in
the `MAX(...)` calculation — the conservative estimator does not attempt
to determine, per model family, whether a given endpoint's provider
requires an explicit opt-in field (as Anthropic's `cache_control` does)
before a write can occur, because OpenRouter's endpoint metadata schema
does not expose that distinction as a structured, machine-checkable
field; hard-coding undocumented per-provider trigger behavior into the
authoritative contract would be brittle and could silently go stale. The
one exception is `input_cache_write_1h`, addressed separately below,
whose own schema description ties it to a *narrower and more clearly
gated* trigger than the base rate. Example, per the task's own worked
case: `promptPricePerToken = $3.00/M`, `input_cache_read = $0.30/M`,
`input_cache_write = $3.75/M` → `effectiveInputPricePerToken = $3.75/M`.
The estimator may conservatively apply this maximum rate to the full
estimated input-token count, even though a real request would typically
only pay the write premium on the cached prefix — this is intentional
overestimation, not a claimed prediction of actual spend.

**Explicit 1-hour cache write (`input_cache_write_1h`) — narrow,
provable exclusion.** The Tribunal V1 request contract never sends a
cache-control request field of any kind, so it cannot request the
1-hour TTL Anthropic's own documentation requires an explicit
`"ttl": "1h"` control (nested inside the `cache_control` object the
Tribunal also never sends) to enable. `input_cache_write_1h` is
therefore excluded from `effectiveInputPricePerToken`, documented
precisely as **"impossible for the current request contract to
invoke"** — never as "cache pricing can only reduce spend." If a future
OpenRouter/provider change ever exposes an extended-TTL cache-write rate
triggerable without an explicit, Tribunal-never-sent request control,
this exclusion no longer holds and must be revisited before that
provider's endpoints remain eligible.

**Unknown/unclassifiable cache pricing.** No cache-related price field
may silently pass eligibility without classification:

- **Impossible for the Tribunal request to invoke** → documented
  exclusion (currently: `input_cache_write_1h` only).
- **Automatically/default applicable, or not provably excludable** →
  represented conservatively inside the `effectiveInputPricePerToken`
  `MAX(...)` (currently: `input_cache_read`, `input_cache_write`).
- **A future cache-related field whose applicability cannot be
  established safely from documented, structural request/endpoint
  metadata** → the endpoint is **not eligible**,
  `PRICING_UNREPRESENTABLE`. This follows the pre-existing M7 rule
  (Decision 7) that unknown billable behavior is always blocked, never
  assumed zero or assumed safe.

**Retry reserve — no assumed cache hit.** The cache-safe
`effectiveInputPricePerToken` applies **independently** to every
permitted provider attempt. Preflight's ×2 retry reserve (Decision 7)
uses the same `effectiveInputPricePerToken` for the retry attempt as for
the initial attempt — a retry is never assumed to land on a warm cache,
receive a cache-read discount, or otherwise cost less than the initial
attempt's worst case. The retry reserve must remain economically safe
even if the retry happens after the cache expired, on a cold cache, or
without any usable cache hit at all.

**Tier impact.** `FREE` (Decision 12) requires the *complete* conservative
route economics — including any automatically-applicable cache-write
exposure and the request fee, not merely `promptPricePerToken` — to be
exactly `$0.00`. A route with `promptPricePerToken = 0` but a non-zero
automatically-applicable `input_cache_write` rate is **not** `FREE`;
its tier is computed from `effectiveInputPricePerToken`, not
`promptPricePerToken` alone.

## Decision 8 — Alias / dynamic-router policy

Confirmed real, current, and both explicitly non-fixed by OpenRouter's
own documentation (see verification above): `openrouter/auto` (Auto
Router, explicitly non-deterministic) and `~provider/model-family-latest`
tilde aliases (explicitly designed to move over time).

**Policy:** if the configured `model_id`:

- is `openrouter/auto` or matches the documented Auto Router pattern, OR
- uses the tilde-alias (`~...`) convention, OR
- otherwise resolves such that `canonical_slug` cannot be established as
  a single stable target safely priceable and pinnable before execution

then **block**, with reason code `DYNAMIC_MODEL_UNSUPPORTED` (Auto
Router / genuinely dynamic constructs) or `MODEL_ALIAS_NOT_PINNED`
(a resolvable-but-moving alias). The frozen M6 `model_id` is **never**
modified by this check — a blocked configuration stays blocked and
visible with its original configured ID; diagnostic/preflight output may
additionally surface the resolved `canonical_slug` for audit, but never
silently substitutes it as if the user had configured that model.

## Decision 9 — Raw pricing units and decimal normalization

OpenRouter's catalog/endpoint `pricing.*` rate fields are **strings**,
explicitly to avoid floating-point precision issues (confirmed in
verification above) — e.g. `"0.00003"` USD per prompt token. The
realized `usage.cost` on an actual completion response is, by contrast, a
JSON **number** (double) — a genuinely different representation the
implementation must handle correctly, not interchangeably.

Internal normalized contract:

```ts
type PricingSnapshot = {
  modelId: string;               // configuredModelId this pricing applies to
  providerEndpointTag: string;   // exact endpoint this pricing was observed for
  promptPricePerToken: Decimal;      // parsed exactly from the pricing.prompt string
  completionPricePerToken: Decimal;  // parsed exactly from pricing.completion string
  requestPriceUsd: Decimal;          // parsed exactly from pricing.request string
  cacheReadPricePerToken: Decimal | null;      // NEW (this pass) -- parsed from
                                                // pricing.input_cache_read, when present
  cacheWritePricePerToken: Decimal | null;     // NEW (this pass) -- parsed from
                                                // pricing.input_cache_write (default/
                                                // 5-minute-equivalent rate), when present
  effectiveInputPricePerToken: Decimal;        // NEW (this pass) -- MAX(promptPricePerToken,
                                                // cacheReadPricePerToken,
                                                // cacheWritePricePerToken); the value the
                                                // conservative estimator actually uses in
                                                // place of promptPricePerToken (Decision 7B)
  promptPricePerMillion: Decimal;    // display convenience = promptPricePerToken * 1_000_000
  completionPricePerMillion: Decimal;// display convenience
  currency: "USD";
  observedAt: string;            // ISO 8601 fetch timestamp
};
```

`input_cache_write_1h` is deliberately **not** a `PricingSnapshot` field
in V1 — it is excluded from the estimator entirely (Decision 7B), not
merely recorded and ignored, since V1's request contract structurally
cannot invoke it. No unnecessary raw provider metadata beyond what the
audit trail needs is exposed to the browser (unchanged principle,
`ARCHITECTURE.md` §5.3).

- Rate strings are parsed directly into the decimal type (Decision 10) —
  never round-tripped through a JS `number` first. **This authoritative
  preflight path is unaffected by the wording correction below** —
  preflight pricing, tier classification, and the $5.00 ceiling continue
  to use only the string rate fields parsed directly into `Decimal`.
- **Corrected wording (this pass):** a realized `usage.cost` number is
  converted into the decimal type exactly once, immediately on receipt,
  and no further authoritative binary-floating-point arithmetic is
  performed on it afterward — every comparison/aggregation after that
  point uses only decimal arithmetic on the converted value. This is
  narrower than the first pass's phrasing: the application preserves
  *the provider-reported value it received* — a JSON number is exactly
  representable as a decimal, so the conversion itself loses nothing —
  but this is **not** a claim that the true underlying mathematical
  price (rate × token counts, evaluated at whatever precision the
  provider used internally, possibly including an `overrides`/`discount`
  adjustment) is reconstructed more exactly than OpenRouter's protocol
  itself supplied it. `usage.cost` is recorded as authoritative
  *audit/telemetry* of what OpenRouter reported for that call; it is
  never treated as more precise than its source, and it is never used to
  retroactively revise a preflight decision already made from the rate
  strings.
- `1,000,000` (the per-million conversion factor) is an exact integer;
  the conversion introduces no additional imprecision.

## Decision 10 — Decimal arithmetic implementation: a small, reviewed dependency

**Locked: Option A — a small, reviewed decimal-arithmetic dependency**,
not a hand-rolled fixed-point/`BigInt` representation.

Justification under the project's dependency policy (`AGENTS.md`
"Dependencies": "explain why existing platform/library capability is
insufficient... prefer maintained, narrow, mainstream packages"):
correct arbitrary-precision decimal arithmetic — parsing provider decimal
strings exactly, multiplying token counts by per-token rates, dividing
for per-million display conversion, summing across up to seven
participants and up to fourteen provider attempts, and comparing against
fixed thresholds — is exactly the kind of narrowly-scoped, well-understood
problem domain a mature single-purpose library solves correctly, where a
hand-rolled `BigInt`-scaled-integer implementation would need to
independently reinvent scale selection, rational division, and
string (de)serialization for no real benefit; the risk of a subtle
scale/rounding bug in bespoke code is a materially *worse* outcome than
adding one small dependency for money math the entire system's cost
ceiling correctness depends on. **Recommended package: `decimal.js`**
(zero sub-dependencies, MIT-licensed, mature, widely used specifically
for this purpose). Adding the dependency itself is implementation-task
work, not performed in this planning task.

Required operations, all via the decimal type, never via `Number(...)` or
native floating-point arithmetic for any authoritative comparison:

- parse a provider decimal price string exactly
- multiply token count × per-token price
- include a request-level charge
- apply the ×2 retry multiplier
- apply the `1.10` safety factor (`docs/economics.md` §10.5)
- sum participant costs across the full seven-participant configuration
- compare against fixed thresholds: `$0.50`, `$2.00`, `$5.00`
  (Decision 12)
- serialize a stable decimal string for storage/display/audit

## Decision 11 — Provider error taxonomy (M7 normalizes, does not retry)

M7 defines and normalizes; it does not execute any retry (M8 does, per
`SPEC.md` §10.1's already-authoritative 1-retry-per-logical-call policy).

```ts
type ProviderErrorCategory =
  | "TIMEOUT"
  | "TRANSIENT_NETWORK"
  | "PROVIDER_5XX"
  | "RATE_LIMITED"
  | "AUTHENTICATION"
  | "INVALID_PROVIDER_REQUEST"
  | "INVALID_PROVIDER_RESPONSE"   // transport/JSON-envelope malformed --
                                   // NOT the Tribunal's own speech/verdict
                                   // schema validation, which is a distinct
                                   // downstream M8 concern layered on top of
                                   // a structurally-successful response
                                   // (SPEC.md Sec 10.1's "malformed/invalid
                                   // structured model output")
  | "MODEL_INELIGIBLE"
  | "PRICING_UNAVAILABLE"
  | "PRICING_UNREPRESENTABLE"
  | "UNKNOWN";
```

```ts
type PreflightReasonCode =
  | "MODEL_NOT_FOUND"
  | "MODEL_ALIAS_NOT_PINNED"
  | "DYNAMIC_MODEL_UNSUPPORTED"
  | "ENDPOINT_UNAVAILABLE"
  | "ENDPOINT_NOT_PINNABLE"        // NEW (this pass) -- candidate endpoint's
                                    // tag cannot be proven to identify
                                    // exactly one endpoint (Decision 4A);
                                    // distinct from ENDPOINT_UNAVAILABLE,
                                    // which means no candidate exists at
                                    // all, not that one exists but is
                                    // ambiguously addressed
  | "STRUCTURED_OUTPUT_UNSUPPORTED"
  | "BOUNDED_OUTPUT_UNSUPPORTED"
  | "CONTEXT_TOO_SMALL"
  | "PRICING_UNAVAILABLE"
  | "PRICING_UNREPRESENTABLE"      // now also covers non-empty
                                    // pricing.overrides and non-zero
                                    // internal_reasoning (Decisions 7, 7A)
  | "BUDGET_EXCEEDED"
  | "PROMPT_VERSION_UNASSIGNED";
```

(This pass unifies naming: the first pass's Section 25 sketch used
`BUDGET_BLOCKED` in one place and `BUDGET_EXCEEDED` in another for the
same concept — one canonical name, `BUDGET_EXCEEDED`, is used
everywhere. This pass also adds `ENDPOINT_NOT_PINNABLE`, the reason code
required by Decision 4A, and clarifies `PRICING_UNREPRESENTABLE`'s
expanded scope per Decisions 7/7A.)

Future M8 retry eligibility (documented here for forward reference only —
M7 does not implement it):

- **Potentially retryable** (subject to M8's budget guard also
  permitting the retry): `TIMEOUT`, `TRANSIENT_NETWORK`, `PROVIDER_5XX`,
  `RATE_LIMITED`, and the Tribunal-level "invalid structured model
  output" outcome (not itself a `ProviderErrorCategory` — see the
  `INVALID_PROVIDER_RESPONSE` note above).
- **Never retryable**: `AUTHENTICATION`, `INVALID_PROVIDER_REQUEST`,
  `MODEL_INELIGIBLE`, `PRICING_UNAVAILABLE`, `PRICING_UNREPRESENTABLE`,
  `BUDGET_EXCEEDED`, or any invalid application/user configuration.
- Maximum one retry per logical call regardless of category
  (`SPEC.md` §10.1, unchanged).

## Decision 12 — Model price tiers (discovery metadata only, never budget authority)

Locked thresholds, computed from the exact `ResolvedModelRoute`'s
conservative **complete-Tribunal** cost estimate (never a per-token rate,
never a model-family average):

```text
FREE           == $0.00 exactly (every V1-relevant billable dimension
                   authoritatively zero for this exact route -- never
                   inferred from name/marketing/history, computed from
                   the UNDISCOUNTED base rate per Decision 7A's discount
                   policy -- a discounted-toward-zero non-zero base rate
                   is never classified FREE -- AND computed from
                   effectiveInputPricePerToken per Decision 7B, so an
                   automatically-applicable non-zero cache-write rate
                   also disqualifies a route from FREE even when
                   promptPricePerToken alone is zero)
BUDGET         >  $0.00  and <= $0.50
PREMIUM        >  $0.50  and <= $2.00
ABOVE_PREMIUM  >  $2.00  and <= $5.00   -- technically satisfies the hard
                                            ceiling but must NOT
                                            automatically appear as a
                                            normal recommended V1 choice;
                                            surfacing it requires a
                                            separate later product
                                            decision
HARD_BLOCK     >  $5.00                -- ineligible; exact preflight
                                            ($5.00 boundary, Decision 9's
                                            arithmetic) remains the sole
                                            authority
```

`$5.00` is the architectural emergency ceiling (`docs/economics.md` §2),
never the normal target; `PREMIUM` must stay materially below it.
**Tier labels are discovery/display metadata only and never replace or
bypass exact preflight** — a route's tier is informative, the decimal
comparison against `$5.00` (and, for eligibility purposes, nothing else)
is authoritative.

Tiering pipeline (Decision 2's resolution pipeline, continued):
`configured model` → `canonical model` → `eligible exact provider
endpoints` (Decision 4) → `deterministic resolved route` (Decision 5) →
`normalized route pricing incl. effectiveInputPricePerToken` (Decisions
9, 7B) → `conservative Tribunal estimate` (`docs/economics.md` §10) →
`FREE`/`BUDGET`/`PREMIUM`/`ABOVE_PREMIUM`/`HARD_BLOCK`. The same model
through two different provider endpoints can land in two different
tiers — they are not economically equivalent, and the tier belongs to
the resolved route, not the model.

## Decision 13 — Model discovery contract for a later UI

M7 need not implement new UI. Its domain contract must support one
cleanly, later, for each eligible resolved route:

- model display name, `configuredModelId`, `canonicalModelId`
- provider display name (`providerDisplayName`) — never
  `providerEndpointTag` shown as if it were a product-facing label
- tier (`FREE`/`BUDGET`/`PREMIUM`; `ABOVE_PREMIUM` surfaced only if a
  later product decision allows it)
- input price, output price, request fee if applicable
- conservative full-Tribunal estimate for this exact route
- context capacity
- key capability indicators (structured output, bounded output support)

No raw unnecessary provider metadata (uptime/throughput percentiles,
internal quantization strings, etc.) is exposed beyond what a comparison
UI needs. No OpenRouter credential is ever exposed.

Shared Mode later compares FREE/BUDGET/PREMIUM options for the one model
applied to all seven participants. Separate Mode allows independent
per-participant tier choices; the authoritative preflight always
evaluates the exact combined seven-participant configuration — tier
labels never independently grant eligibility (Decision 12).

## Decision 14 — Preflight ships as a standalone read-only service in M7 (now LOCKED, no longer open)

The first pass left this open. **It is resolved now:**

- **M7** implements a standalone, read-only, authoritative preflight
  service and its `POST /api/preflight` endpoint (Decision 15). It
  performs zero persistence, zero run mutation, zero completion calls.
- **M7 does not modify `POST /api/runs`.** It does not persist
  `BLOCKED_BUDGET`. It does not make budget status caller-controlled. It
  does not touch the M6 freeze RPC for `BLOCKED_BUDGET` in any way.
- **M8** owns the first execution-time integration: frozen run →
  authoritative preflight → execution allowed, or `BLOCKED_BUDGET`/
  failure behavior — because only M8 actually has execution to block.
  Whatever schema change that eventually needs (if any) is M8's forward
  migration, not M7's.

`ARCHITECTURE.md` §7.4 step 5's conceptual `POST /api/runs` lifecycle
annotation is corrected in this pass to state this plainly, rather than
leaving room to imply the integration already happens in M7.

## Decision 15 — Preflight API contract

```text
POST /api/preflight
```

Request:

```json
{ "runId": "<UUID>" }
```

Server flow: validate `runId` → load the immutable frozen run + seven
participant configs → reject if `prompt_version` is still
`unassigned-pre-m7` (`PROMPT_VERSION_UNASSIGNED`) → resolve exact
model/provider route(s) (Decisions 2, 4, 5) → validate endpoint
capabilities (Decision 4) → normalize pricing (Decision 9) → compute
exact conservative bounds using decimal arithmetic (Decision 10,
`docs/economics.md` §10) → assign discovery tier information per
participant (Decision 12) → return the result. Zero persistence, zero
completion calls, zero run mutation.

```ts
type PreflightResult = {
  eligible: boolean;
  runId: string;

  hardBudgetUsd: string;              // "5.00" -- decimal string, not a number
  conservativeMaxCostUsd: string;
  remainingBudgetUsd: string;         // hardBudgetUsd - conservativeMaxCostUsd when eligible

  blockedReasonCodes: PreflightReasonCode[];
  pricingObservedAt: string | null;

  participants: Array<{
    participantId: ParticipantId;

    configuredModelId: string;
    canonicalModelId: string | null;
    modelEligible: boolean;

    providerName: string | null;         // providerDisplayName
    providerEndpointIdOrTag: string | null; // providerEndpointTag

    priceTier: "FREE" | "BUDGET" | "PREMIUM" | "ABOVE_PREMIUM" | null;

    conservativeParticipantCostUsd: string | null;
    pricing: PricingSnapshot | null;

    reasonCodes: PreflightReasonCode[];
  }>;
};
```

All monetary fields are serialized decimal strings, never JS numbers, in
the response. No internal error detail or secret is exposed.

## Decision 16 — Prompt-version bridge: role-specific versions, one new forward migration

**Granularity correction from the first pass:** `prompt_version` is
stored *per participant*, and advocates and judges use different base
prompts (`ARCHITECTURE.md` §6). A single undifferentiated "the prompt
version" is insufficient. M7 locks role-specific stable identifiers:

```ts
// src/prompts/versions.ts
export const ADVOCATE_PROMPT_VERSION = "advocate-v1";
export const JUDGE_PROMPT_VERSION = "judge-v1";
```

The freeze function currently writes one hardcoded literal
(`'unassigned-pre-m7'`) identically to all seven rows. The bridge
migration writes `ADVOCATE_PROMPT_VERSION` for the four advocate
participant keys and `JUDGE_PROMPT_VERSION` for the three judge
participant keys, via the same internal `CASE`-style role derivation the
function already uses for `role`/`side` — still never a caller
parameter, preserving the non-caller-controlled property from
`docs/adr/0002-participant-configuration-freeze.md` Decision 6. This is
a **new forward migration** (`CREATE OR REPLACE FUNCTION` with the same
signature/privileges/grants) — the already-applied M6 migration is never
edited. M6 historical runs (`unassigned-pre-m7`) are never mutated and
remain permanently execution-ineligible (`MODEL-006`).

## Decision 17 — Prompt-version / migration drift check

The applied PostgreSQL freeze function cannot import TypeScript
constants, so `src/prompts/versions.ts` and whatever migration currently
defines the freeze function's literals can silently drift apart over
time (a prompt code change without a matching migration, or vice versa).

**Rule (mechanism chosen at implementation time, not now):** an automated
repository check compares `ADVOCATE_PROMPT_VERSION`/
`JUDGE_PROMPT_VERSION` against the expected literal values encoded in the
current prompt-bridge migration's contract, and fails if they diverge.
Every future prompt-version change is therefore: a reviewed prompt code
change, a reviewed version-ID change, and a new forward migration when
the freeze-derived current version changes — never edits to an applied
migration.

## Decision 18 — `model_call_attempts` remains deferred

Unchanged from the first pass. M7 makes zero real provider calls, so it
defines the TypeScript/Zod telemetry interface only — matching Decision
16's role-specific versions and Decision 2's route-resolution fields:
logical participant, configured model ID, canonical model ID, resolved
provider endpoint identity (`providerEndpointTag`), provider name,
attempt number, status, input/output/total tokens, pricing snapshot,
actual provider cost, derived comparison cost, latency, provider
request/generation ID (the completion response's `id`, confirmed above),
normalized `ProviderErrorCategory`. Unavailable failed-attempt
token/cost fields are `NULL`, never fabricated zero. The table and its
forward migration are created when M8/M10 has a real write path.

## Decision 19 — Live verification policy before M7 merges (revised)

**This supersedes the first pass's "no real smoke call required"
recommendation.** Independent review requires, before M7 ultimately
merges, one **mandatory, manual, explicit live metadata integration
smoke** — not performed in this planning task. It must:

- use the real server-side OpenRouter configuration (`OPENROUTER_API_KEY`)
- perform **zero model inference** — metadata retrieval only
- contain no Tribunal/case/personality data of any kind
- fetch current model/endpoint metadata (`GET /models`, `GET
  /models/{author}/{slug}/endpoints`) through the real implementation
- exercise real authentication, network behavior, and response-schema
  parsing against the real API — not the fake
- exercise the actual route-resolution/pricing-normalization logic
  (Decisions 2, 4, 5, 9) end to end
- verify at least one known eligible endpoint resolves correctly
- record no secret value anywhere (logs, fixtures, evidence docs)
- incur zero model-inference spend

This is not one of the seven Tribunal logical calls, not an advocate, not
a judge, not M7A, not model execution — it is external-integration
verification of the provider boundary itself.

## Decision 20 — Optional real completion smoke (separate, still optional)

Distinct from Decision 19 and still **optional**, gated on explicit human
authorization immediately before it runs:

- one synthetic OpenRouter completion using a free or extremely cheap
  eligible resolved route
- no real Tribunal/case data
- a strict cost bound
- exact route pinning (Decision 6) exercised for real
- structured output requested and validated

Purpose: verify real completion request construction, exact route
identity, structured-output parsing, `usage`, token counts, `usage.cost`
handling (Decision 9), and timeout-boundary integration. Not CI, not
automatically required, not a Tribunal participant call, not part of the
7-call economics. Not performed in this planning task.

## Test strategy additions (this pass)

These extend M7's future test plan (implemented at M7 build time, not in
this planning task) to cover the two corrections above. All run against
the fake provider; none require a real OpenRouter call.

**Unique pinnability (Decision 4A):**

- **A.** A model whose only candidate endpoint's `tag` is a full
  variant/region slug (e.g. `deepinfra/turbo`) with no sibling variant in
  the candidate set → eligible, `isUniquelyPinnable: true`.
- **B.** A model with two candidate endpoints sharing the same base
  provider slug (e.g. `deepinfra` and `deepinfra/turbo` both present) →
  the base-slug endpoint is **not** eligible
  (`ENDPOINT_NOT_PINNABLE`); the full-variant-slug endpoint is evaluated
  on its own merits.
- **C.** A model whose only candidate endpoint's `tag` is currently a
  bare base slug with no sibling variant present *right now* → eligible
  today (`isUniquelyPinnable: true`), with the pinnability check re-run
  from the live candidate set on every TTL refresh (Decision 3), never
  cached independently of it.
- **D.** No endpoint in the candidate set can be proven uniquely
  pinnable → the model itself is ineligible, `ENDPOINT_NOT_PINNABLE`
  surfaced in `blockedReasonCodes`/`participants[].reasonCodes`.
- **E.** Deterministic selection (Decision 5) never considers a
  not-uniquely-pinnable endpoint's price, even if it would otherwise be
  the cheapest candidate.

**Pricing overrides and discount (Decision 7A):**

- **F.** A candidate endpoint with a non-empty `pricing.overrides` array
  → not eligible, `PRICING_UNREPRESENTABLE`.
- **G.** A candidate endpoint with an empty or absent `pricing.overrides`
  → normal eligibility/pricing flow, unaffected.
- **H.** A candidate endpoint with `pricing.discount > 0` on a non-zero
  base rate → the computed conservative bound uses the **undiscounted**
  base rate; the discount never lowers the computed bound used for tier
  classification or the $5.00 ceiling comparison.
- **I.** A candidate endpoint with a non-zero base rate and
  `pricing.discount` close to or equal to `1` → **not** classified
  `FREE`; tier classification uses the undiscounted rate.
- **J.** A realized `usage.cost` from a (future, M8-only) completion
  response is converted to the decimal type exactly once on receipt and
  stored/aggregated with no further float-precision arithmetic performed
  on it afterward — verified by asserting no second `Number(...)`
  round-trip occurs anywhere downstream of the initial conversion.

**Cache-write economics (Decision 7B, new this pass):**

- **K.** An endpoint with `promptPricePerToken < automaticallyApplicable
  input_cache_write` → `effectiveInputPricePerToken` equals the
  cache-write rate, not the prompt rate.
- **L.** An endpoint with `input_cache_read < promptPricePerToken` (the
  documented common case) → the conservative bound stays at
  `MAX(promptPricePerToken, cacheWritePricePerToken)`; the cheaper read
  rate never lowers it.
- **M.** An endpoint whose `input_cache_read` unexpectedly exceeds
  `promptPricePerToken` → `MAX(...)` still keeps the estimate
  conservative; no special-cased "reads are always cheap" branch exists
  to be wrong.
- **N.** An endpoint with `promptPricePerToken == 0` and a non-zero
  automatically-applicable `input_cache_write` → the route is **not**
  `FREE`; its tier is computed from `effectiveInputPricePerToken`.
- **O.** The retry reserve computation uses the same
  `effectiveInputPricePerToken` for the retry attempt as for the initial
  attempt — no test may assert a cheaper retry-reserve number derived
  from an assumed cache hit or cache discount.
- **P.** An endpoint's `input_cache_write_1h` rate is excluded from
  `effectiveInputPricePerToken` — and this exclusion is asserted to be
  documented/labelled as "impossible for the current request contract to
  invoke," never as "cache pricing can only reduce spend."
- **Q.** A future/unclassifiable cache-related pricing field (neither
  `input_cache_read`, `input_cache_write`, nor the excluded
  `input_cache_write_1h`) → the endpoint is not eligible,
  `PRICING_UNREPRESENTABLE`.
- **R.** `pricing.discount` present and within `[0, 1]` → ignored for the
  conservative bound, per Decision 7A's existing policy, unaffected by
  this pass.
- **S.** `pricing.discount` present but negative, greater than `1`, or
  non-finite (`NaN`/`Infinity`) → the endpoint is not eligible,
  `PRICING_UNREPRESENTABLE` (hardened validation, Decision 7A, this
  pass) — malformed discount metadata never silently passes as if it
  were `0`.

## Consequences

- M7 adds one new environment variable read path
  (`OPENROUTER_API_KEY`), one new small reviewed dependency for decimal
  arithmetic (Decision 10 — not added in this planning task), and — per
  Decision 14 — no live-database change in M7 itself; the prompt-version
  bridge migration (Decision 16) is the one schema change M7 is expected
  to eventually make, and only once real prompt text exists to assign
  role-specific versions to.
- M8 inherits: a stable `OpenRouterProvider` interface including endpoint
  discovery; a `ResolvedModelRoute`/`PricingSnapshot` pair that
  distinguishes discovery from pinnable execution identity (now including
  `isUniquelyPinnable`, Decision 4A); a deterministic endpoint-selection
  algorithm; a decimal-safe budget contract that blocks unrepresentable
  conditional pricing (`overrides`) and never relies on `discount`
  (Decision 7A); a normalized provider-error taxonomy — now including
  `ENDPOINT_NOT_PINNABLE` — with a documented (not-yet-implemented)
  retry-eligibility mapping; a route-pinning contract for execution that
  uses `provider.order` as the primary pin, matching OpenRouter's own
  documented exact-pin example (Decision 6); a role-specific
  prompt-version contract; and a `PreflightResult` it can call before
  wiring `BLOCKED_BUDGET` into real execution — without inheriting a
  `model_call_attempts` table it doesn't yet need, or a `POST /api/runs`
  behavior change it hasn't asked for yet — and now also a cache-aware
  `effectiveInputPricePerToken` (Decision 7B) that can never underestimate
  a route's true worst-case input cost due to an automatically-applicable
  cache-write premium.
- Every M7 test runs against the fake provider; CI never spends money or
  depends on OpenRouter's availability. Exactly one manual, cost-free,
  metadata-only live check (Decision 19) is required once, before merge.
- **This pass's corrections are conservative-only**: the pinnability rule
  (Decision 4A), the overrides/discount policy (Decision 7A, including
  this pass's hardened malformed-discount validation), and the
  cache-write-aware effective input price (Decision 7B, this pass) can
  only cause the system to *decline* a route it might previously have
  accepted too permissively, or to compute a cost bound that is *equal
  to or higher* than a cache-naive/discount-naive number would have
  been — none of these corrections weakens the $5.00 ceiling, the
  FREE/BUDGET/PREMIUM/ABOVE_PREMIUM/HARD_BLOCK thresholds, or any other
  previously locked decision. **This pass specifically retracts the
  second pass's false claim that provider implicit caching can only
  reduce spend** — cache *writes* are a real, currently-documented,
  provider-confirmed premium-priced dimension, now bounded rather than
  ignored.
