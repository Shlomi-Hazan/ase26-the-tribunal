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
  justification for the decimal-arithmetic boundary in Decision 6 below.
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

  providerEndpointTag: string;    // OpenRouter endpoint `tag` -- the ONLY
                                   // field ever placed into a future
                                   // `provider.only` request array (Decision 5)
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

`providerEndpointTag` (= OpenRouter's `tag`) is explicitly the *only*
field ever used to pin execution (`provider.only: [tag]`, confirmed
against the real `ProviderPreferences.only` schema, whose array items
accept exactly this kind of provider-slug string).
`providerDisplayName`/`endpointDisplayName` (= `provider_name`/`name`)
are for UI/audit display only and are never fed into a routing
parameter — resolving Section 5's display-vs-pin distinction concretely
against real field names rather than placeholder names.

Resolution pipeline: `GET /models` (existence/coarse filter) → `GET
/models/{author}/{slug}/endpoints` (all real candidate endpoints for that
exact model) → filter to eligible endpoints (Decision 4) → deterministic
selection (Decision 5, the redesignated numbering below) →
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
   dimensions)
8. the endpoint can be pinned under the intended provider-routing policy
   (Decision 5) — i.e. its `tag` is a value `provider.only` can actually
   restrict to

`require_parameters: true` remains request-time defense in depth
(`ARCHITECTURE.md` §5.2) — it does not substitute for this endpoint-level
eligibility check, which runs before any request is ever built.

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

**Locked invariant: PREFLIGHT ROUTE = FUTURE EXECUTION ROUTE.**

M8 must not compute preflight against one endpoint and let OpenRouter
freely route the actual completion to a different one. The future
completion request (M8, not M7 — M7 makes no completion call) must pin:

- `provider.only: [providerEndpointTag]` — exact restriction to the
  resolved endpoint's real `tag`
- `provider.allow_fallbacks: false`
- `provider.require_parameters: true`
- `provider.max_price` set consistent with the accepted pricing bound,
  as defense in depth (never the primary control — the accepted
  `ResolvedModelRoute`'s own pricing is)

If the exact accepted endpoint is unavailable at execution time (M8), the
attempt fails/blocks per the normalized error policy (Decision 11). It
never silently moves to a different endpoint or a different model. M7
itself performs zero completion calls — this decision defines the
contract M8 must implement, not something M7 executes.

## Decision 7 — Billable dimensions

Confirmed real OpenRouter pricing dimensions (Current OpenRouter API
verification, above): `prompt`, `completion`, `request`, `image`,
`web_search`, `internal_reasoning`, `input_cache_read`,
`input_cache_write`. V1 Tribunal is text-only, sends no image content,
enables no web-search plugin, and requests no explicit prompt caching.

- **Always included** in the conservative bound: `prompt`, `completion`
  (the two dimensions every text completion always incurs).
- **Included once per attempt, reserved twice per logical call** (initial
  + the one permitted retry) when non-zero: `request` — a flat per-call
  fee is incurred again on a retry, so the retry reserve must include it
  too, not just the token cost.
- **Excluded** because the Tribunal's actual request cannot trigger them:
  `image`, `web_search` (no such plugin/content is ever sent —
  exclusion is justified by the request contract itself, not by
  assumption).
- **Cache dimensions** (`input_cache_read`/`input_cache_write`): the
  Tribunal never explicitly requests caching. A provider's *implicit*
  caching (`supports_implicit_caching`) may reduce *actual* realized
  cost below the conservative bound — that is safe, since the bound only
  needs to be an upper limit — but the conservative preflight estimate
  must never assume a caching discount will apply.
- **`internal_reasoning`**: if a candidate endpoint's pricing reports a
  non-zero `internal_reasoning` rate, that endpoint is **blocked** with
  `PRICING_UNREPRESENTABLE` — reasoning-token count is not bounded by
  the Tribunal's request contract (V1 does not request or cap reasoning
  tokens), so a non-zero reasoning price is a dimension that *can*
  affect the request but *cannot* be conservatively represented today.
- **Any other current or future non-zero billable dimension** the
  Tribunal's request contract cannot structurally rule out is blocked
  the same way, never assumed zero.

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
  promptPricePerMillion: Decimal;    // display convenience = promptPricePerToken * 1_000_000
  completionPricePerMillion: Decimal;// display convenience
  currency: "USD";
  observedAt: string;            // ISO 8601 fetch timestamp
};
```

- Rate strings are parsed directly into the decimal type (Decision 10) —
  never round-tripped through a JS `number` first.
- A realized `usage.cost` number is converted into the decimal type
  exactly once, immediately on receipt, and never re-derived through
  further floating-point arithmetic afterward. IEEE-754 doubles carry
  ~15–17 significant decimal digits, which is far more precision than a
  per-call USD amount in the sub-cent-to-few-dollar range needs; the
  one-time conversion is safe precisely because it happens once, at the
  boundary, and every comparison/aggregation after that point uses only
  decimal arithmetic.
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
  | "STRUCTURED_OUTPUT_UNSUPPORTED"
  | "BOUNDED_OUTPUT_UNSUPPORTED"
  | "CONTEXT_TOO_SMALL"
  | "PRICING_UNAVAILABLE"
  | "PRICING_UNREPRESENTABLE"
  | "BUDGET_EXCEEDED"
  | "PROMPT_VERSION_UNASSIGNED";
```

(This pass unifies naming: the first pass's Section 25 sketch used
`BUDGET_BLOCKED` in one place and `BUDGET_EXCEEDED` in another for the
same concept — one canonical name, `BUDGET_EXCEEDED`, is used
everywhere.)

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
                   inferred from name/marketing/history)
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
`normalized route pricing` (Decision 9) → `conservative Tribunal
estimate` (`docs/economics.md` §10) → `FREE`/`BUDGET`/`PREMIUM`/
`ABOVE_PREMIUM`/`HARD_BLOCK`. The same model through two different
provider endpoints can land in two different tiers — they are not
economically equivalent, and the tier belongs to the resolved route, not
the model.

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
  distinguishes discovery from pinnable execution identity; a
  deterministic endpoint-selection algorithm; a decimal-safe budget
  contract; a normalized provider-error taxonomy with a documented
  (not-yet-implemented) retry-eligibility mapping; a role-specific
  prompt-version contract; and a `PreflightResult` it can call before
  wiring `BLOCKED_BUDGET` into real execution — without inheriting a
  `model_call_attempts` table it doesn't yet need, or a `POST /api/runs`
  behavior change it hasn't asked for yet.
- Every M7 test runs against the fake provider; CI never spends money or
  depends on OpenRouter's availability. Exactly one manual, cost-free,
  metadata-only live check (Decision 19) is required once, before merge.
