# Milestone 7 — OpenRouter Infrastructure — Verification Evidence

## Planning references

- Issue: [#11 — Milestone 7 — OpenRouter Infrastructure](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/11)
- Design contract: `docs/adr/0003-openrouter-infrastructure.md` (planning
  gate, corrected three times after independent review before
  implementation began — provider-route/pricing safety, provider-route-
  and-pricing-safety finalization, and cache-write economics)
- Branch: `milestone/07-openrouter-infrastructure`
- `origin/main` at implementation time: `e7ab964a6a4b78ed1581042546807f6ec11e7e7f`

## Planning history (out of scope for this evidence, listed for a complete branch history)

| # | SHA | Message |
|---|---|---|
| 1 | `923cb7e…` | `docs: define Milestone 7 OpenRouter infrastructure contract` |
| 2 | `2f73533…` | `docs: harden Milestone 7 provider economics contract` |
| 3 | `388c60c…` | `docs: finalize Milestone 7 route and pricing safety` |
| 4 | `be55059…` | `docs: account for cache-write pricing in M7` |

## Implementation commits

| # | SHA | Message |
|---|---|---|
| 5 | `ca319c8` | `feat: add OpenRouter metadata and pricing infrastructure` |
| 6 | `aac618d` | `feat: add Milestone 7 preflight infrastructure` |
| 7 | `c4cc981` | `feat: add versioned Tribunal prompt registry` |
| 8 | `d6059b2` | `docs: record Milestone 7 pre-live verification` |
| 9 | `637804a` | `fix: give a long setup-flow test a generous CI timeout` (pre-existing M6 test, unrelated to M7 scope — see "CI timeout fix" below) |

CI on commit 8/9's exact HEAD (`637804a`): run `32996490583`, conclusion
`success`, 24 files / 274 tests — recorded in the PR discussion, not
repeated in full here. The independent-review correction pass below
starts from that green baseline.

## Independent-review correction commits (pre-live gate)

A second, independent code-review pass found six implementation-contract
defects despite the green CI baseline above. See "Independent review
corrections" below for the full explanation of each; this table is the
commit index only.

| # | SHA | Message |
|---|---|---|
| 10 | `e96b1e1` | `fix: harden M7 provider pricing contracts` |
| 11 | `8907012` | `fix: align M7 tier and prompt-version semantics` |
| 12 | `2314c2b` | `fix: reuse OpenRouter metadata cache across warm requests` |
| 13 | `8dc151a` | `docs: record M7 pre-live correction verification` |

Exact-head CI on commit 13 (`8dc151a`): run `32999762423`, conclusion
`success`, 26 files / 310 tests.

## Second independent-review correction pass (pre-live gate)

A further independent audit of the six-fix pass above found three more
correctness defects and one documentation overclaim. See "Second
independent review corrections" below for the full explanation; this
table is the commit index only.

| # | SHA | Message |
|---|---|---|
| 14 | `b1d0e45` | `fix: require complete Tribunal capability in model discovery` |
| 15 | `ffa871f` | `fix: make M7 token bounds and pricing timestamps conservative` |
| 16 | `6846319` | `docs: finalize M7 pre-live correction evidence` |

Exact-head CI on commit 16 (`6846319`): run `33011546917`, conclusion
`success`, 27 files / 333 tests.

## Third independent-review micro-correction pass (pre-live gate)

A final, narrow source-level audit of the second correction pass above
approved everything in it except two remaining implementation details
that still violated the exact conservative/audit contract. See "Third
independent review corrections" below for the full explanation; this
table is the commit index only.

| # | SHA | Message |
|---|---|---|
| 17 | `c47c8f2` | `fix: align M7 worst-case estimation with real request shape and fail closed on missing pricing timestamps` |
| 18 | *(this evidence-update commit)* | `docs: record final M7 pre-live micro-corrections` |

## Scope implemented

The server-only OpenRouter provider boundary; model + provider-endpoint
metadata parsing; exact resolved-route eligibility, including unique
pinnability; route-price binding; decimal-safe economics, including
cache-write-aware conservative pricing; FREE/BUDGET/PREMIUM/ABOVE_PREMIUM/
HARD_BLOCK classification; conservative preflight
(`POST /api/preflight`); sanitized model discovery (`GET /api/models`);
the versioned prompt registry and its forward prompt-version bridge
migration; fakeable, deterministic tests throughout.

**M7 performs zero Tribunal model completions.** `createChatCompletion`
is implemented (for Milestone 8) but never invoked by any M7 application
code path, and no automated test reaches the real OpenRouter network.

## Provider boundary

`netlify/server/openrouter/provider.ts` — one `OpenRouterProvider`
interface (`listModels`, `listEndpoints`, `createChatCompletion`), one
real `fetch`-based implementation (`RealOpenRouterProvider`, native
`fetch`, no SDK, `<=60s` `AbortController` timeout,
`netlify/server/openrouter/errors.ts`'s normalized error taxonomy), one
deterministic fake (`netlify/server/openrouter/fakeProvider.ts`).
`readOpenRouterServerConfig()` (`netlify/server/env.ts`) mirrors the
existing `readSupabaseServerConfig()` pattern exactly: injectable
environment, Zod validation, a typed `ServerConfigError` that never
echoes the attempted value.

## Runtime schemas

`netlify/server/openrouter/schemas.ts` — Zod schemas for the exact
OpenRouter metadata M7 consumes: `GET /models`, `GET
/models/{author}/{slug}/endpoints`, `PublicPricing`/`PricingOverride`,
`POST /chat/completions` request/response. Provider metadata is
untrusted: malformed metadata never silently becomes an eligible route
(`pricing.ts`'s `parseRate` returns `"invalid"` rather than throwing,
and every caller maps that to `PRICING_UNAVAILABLE`).

## Metadata cache

`netlify/server/openrouter/cache.ts` — `ModelMetadataCache`, a bounded
in-process cache (no Redis, no DB table, no queue), `MODEL_METADATA_TTL_MS
= 300_000` (5 minutes, ADR Decision 3), `MODEL_METADATA_CACHE_MAX_ENTRIES
= 200` (documented implementation constant), injectable clock, and
deterministic least-recently-set eviction (re-setting an existing key
moves it to the most-recently-set position, so a hot key is never
evicted merely for being refreshed). `cachedFetch()` enforces the
required semantics in exactly one place: fresh → use without refresh;
stale + successful refetch → replace/use fresh; stale + failed refetch →
block; no cache + successful fetch → store/use; no cache + failed fetch
→ block; fresh cache + provider unavailable → the fresh cache is used,
the fetcher is never even called.

## Route resolution

`netlify/server/openrouter/routeResolution.ts`:

- **Alias/dynamic-router policy** (ADR Decision 8): `openrouter/auto` →
  `DYNAMIC_MODEL_UNSUPPORTED`; any configured ID containing `~` (the
  tilde-alias convention) → `MODEL_ALIAS_NOT_PINNED`. Read-only — the
  configured model ID is never mutated by this check.
- **Unique pinnability** (ADR Decision 4A): `isUniquelyPinnable(tag,
  allTagsForModel)` — a full variant/region slug (contains `/`) is
  pinnable if it is the unique exact match in the candidate set; a
  bare/base slug is pinnable only when no sibling variant currently
  exists. A base slug with a sibling full-variant slug present (e.g.
  `deepinfra` alongside `deepinfra/turbo`) is never pinnable —
  `ENDPOINT_NOT_PINNABLE`, checked before price, so a cheaper
  not-uniquely-pinnable endpoint is never selected.
- **Endpoint eligibility** (ADR Decision 4), checked at the endpoint
  level, never inferred from model-level summaries: canonical model
  resolved and not alias/dynamic-blocked; `response_format` in
  `supported_parameters`; `max_completion_tokens` in
  `supported_parameters` *and* the endpoint's numeric
  `max_completion_tokens` `>= 1000` (advocate) / `>= 1200` (judge), `null`
  blocks; `context_length` covers the estimated input + output cap;
  `max_prompt_tokens` (when present) covers the estimated input; pricing
  representable (`pricing.ts`); uniquely pinnable.
- **Deterministic selection** (ADR Decision 5): eligibility always
  precedes cost comparison; lowest-cost *eligible* route wins; ties break
  by `providerEndpointTag` lexical order.

## Pricing normalization

`netlify/server/openrouter/pricing.ts` — every authoritative amount is a
`Decimal` (`decimal.js`), never a JS `Number`; rate strings parse
directly into `Decimal`, never round-tripped through `Number` first.

- **Billable-dimension classification** (ADR Decisions 7/7A/7B): (1)
  impossible to invoke — `image`/`image_output`/`image_token`/`audio`/
  `audio_output`/`input_audio_cache`/`web_search`, never parsed; (2) can
  only reduce spend, safely ignored — a validated in-range
  `pricing.discount`; (3) blocks or is conservatively bounded — non-zero
  `internal_reasoning` blocks; non-empty `pricing.overrides` blocks; a
  malformed `discount` (negative, `>1`, non-finite) blocks (hardened this
  pass); cache pricing is folded into `effectiveInputPricePerToken`
  rather than assumed safe.
- **Cache-write-aware conservative input price** (ADR Decision 7B):
  `effectiveInputPricePerToken = MAX(promptPricePerToken,
  cacheReadPricePerToken, cacheWritePricePerToken)`. `input_cache_write_1h`
  is parsed (so a malformed value still blocks) but structurally excluded
  from the bound — the Tribunal request contract never sends the
  explicit 1-hour cache-control field that rate requires.
- **Price tiers** (ADR Decision 12): `FREE == $0.00` exactly (computed
  from the undiscounted, cache-write-inclusive figure — a route with a
  zero prompt rate but a non-zero automatically-applicable cache-write
  rate is never `FREE`); `BUDGET (0, 0.50]`; `PREMIUM (0.50, 2.00]`;
  `ABOVE_PREMIUM (2.00, 5.00]`; `HARD_BLOCK > 5.00`. Tier labels are
  discovery/display metadata only — the exact `$5.00` `Decimal`
  comparison is sole authority.

## Token estimation

`netlify/server/openrouter/tokenEstimation.ts` —
`estimated_input_tokens = ceil(UTF8_byte_length / 2) +
FIXED_PROMPT_OVERHEAD_TOKENS` (50, a documented conservative constant),
using `TextEncoder` UTF-8 byte length, never JS string `.length`. Judge
bound reserves `RESERVED_ADVOCATE_SPEECHES_FOR_JUDGE (4) x
ADVOCATE_OUTPUT_CAP_TOKENS (1000) = 4000` tokens for the four advocate
speeches before any advocate has run. Output caps are hard ceilings:
`ADVOCATE_OUTPUT_CAP_TOKENS = 1000`, `JUDGE_OUTPUT_CAP_TOKENS = 1200`.
**The canonical worst-case synthetic-text character was corrected in the
second independent-review pass** (see "Second independent review
corrections," item 2, below) — the true conservative maximum under this
application's actual validation semantics is a 3-byte-UTF-8 BMP
character, not the originally-used 2-byte Hebrew character. **The
canonical worst-case text SHAPE was further corrected in the third
pass** (see "Third independent review corrections," item 1, below) — the
right character alone was not sufficient; the synthetic text also needed
the same application-added Charge Sheet separators and real "PRO"/"CON"
side text the actual preflight estimator includes. Both corrections
compose: the third pass's shared `serializeChargeSheetForModelContext`
helper is filled with the second pass's corrected 3-byte character.

## Preflight service and API

`netlify/server/openrouter/preflight.ts` — `runPreflight(runId, deps)`:
loads the frozen run + exactly seven participant configs + the
associated case (via `preflightRunLoader.ts`, adapting the existing
Supabase-backed `RunRepository`/`CaseRepository` — no new database access
path); rejects any participant whose `prompt_version` is the pre-M7
placeholder or any value other than the current role-specific version
(`PROMPT_VERSION_UNASSIGNED`, SPEC.md `MODEL-006`); resolves each
participant's exact route; computes the retry-reserved (×2, initial +
one permitted retry, never assuming a cache hit) per-participant cost
using `effectiveInputPricePerToken`; applies `BUDGET_SAFETY_FACTOR =
1.10` once to the whole-run sum; compares against `MAX_RUN_COST_USD =
5.00` using `Decimal` throughout. Zero persistence, zero run mutation,
zero completion calls — never touches `POST /api/runs` or the M6 freeze
RPC (ADR Decision 14).

`POST /api/preflight` (`netlify/functions/preflight.ts`, wired via a new
`netlify.toml` redirect): `{ "runId": "<UUID>" }` → `PreflightResult`
with every monetary field serialized as a decimal string. Stable, safe
error categories only (`invalid_preflight_request` / `run_not_found` /
`preflight_persistence_failed` / `provider_unavailable` /
`preflight_request_failed`) — no raw Supabase/OpenRouter/stack-trace
detail ever reaches the client.

## Model discovery API

`netlify/server/openrouter/modelDiscovery.ts` + `GET /api/models`
(`netlify/functions/models.ts`) — a sanitized `EligibleModel[]` list,
never the raw OpenRouter catalog. Uses a worst-case-length synthetic
input (corrected in the second independent-review pass to a true
conservative UTF-8 maximum — see below) rather than a real run's text,
since no real participant text exists yet at discovery time. `HARD_BLOCK`
routes are excluded entirely; `ABOVE_PREMIUM` routes are returned,
correctly labelled, so a future UI can make the separate product
decision about how prominently to surface them (ADR policy).

**Corrected in the second independent-review pass:** every candidate
endpoint is now resolved via `resolveSharedTribunalRoute`, which
requires the SAME exact endpoint to pass both the advocate and the judge
eligibility contract before it is ever returned — the first pass
resolved and evaluated candidates as ADVOCATE only, so a route could be
returned as "eligible for a complete Tribunal" while actually failing
judge output/context capacity. See "Second independent review
corrections," item 1, below. `EligibleModel` also gained
`pricingObservedAt` (item 3, below). **Corrected in the third pass:**
`pricingObservedAt` can no longer be a fabricated invocation-time value
when the endpoint cache's true fetch timestamp is unexpectedly
unavailable — the model is skipped instead. See "Third independent
review corrections," item 2, below.

## Error / timeout normalization

`netlify/server/openrouter/errors.ts` — `ProviderErrorCategory`
(`TIMEOUT`/`TRANSIENT_NETWORK`/`PROVIDER_5XX`/`RATE_LIMITED`/
`AUTHENTICATION`/`INVALID_PROVIDER_REQUEST`/`INVALID_PROVIDER_RESPONSE`/
`MODEL_INELIGIBLE`/`PRICING_UNAVAILABLE`/`PRICING_UNREPRESENTABLE`/
`UNKNOWN`) and `PreflightReasonCode` (12 values, including
`ENDPOINT_NOT_PINNABLE`). M7 normalizes; it does not retry.
`RealOpenRouterProvider` enforces the `<=60s` `AbortController` timeout
boundary and maps HTTP 401/403 → `AUTHENTICATION`, 429 → `RATE_LIMITED`,
5xx → `PROVIDER_5XX`, other 4xx → `INVALID_PROVIDER_REQUEST`, a network
failure → `TRANSIENT_NETWORK`, an abort → `TIMEOUT`, and a schema-invalid
body → `INVALID_PROVIDER_RESPONSE`.

## Telemetry contract

`netlify/server/openrouter/telemetry.ts` — `modelCallAttemptSchema` (Zod)
/ `ModelCallAttempt` (TS) only. `model_call_attempts` is **not created**
— M7 makes zero real provider calls. Unavailable failed-attempt token/
cost fields are `null` in the schema, never a fabricated zero.

## Prompt registry

`src/prompts/versions.ts` — `ADVOCATE_PROMPT_VERSION = "advocate-v1"`,
`JUDGE_PROMPT_VERSION = "judge-v1"`. `src/prompts/schemas.ts` — strict
Zod schemas for the advocate speech and judge verdict structured
outputs, paired with the matching provider-facing JSON Schema.
`src/prompts/advocate-system.ts` / `judge-system.ts` — the versioned base
system prompts, enforcing a system-fixed non-negotiable side, untrusted-
data treatment of personality/Charge Sheet content, a restricted verdict
vocabulary, and no invented tools/actions.

## Forward migration

**`supabase/migrations/20260826173253_prompt_version_bridge.sql`**

`CREATE OR REPLACE FUNCTION public.freeze_participant_configuration` with
the identical signature, `SECURITY DEFINER` property, `search_path`
safety, schema qualification, idempotency semantics, validation
semantics, Shared-mode equality, privileges/grants, and returned
columns/behavior as the already-applied Milestone 6 migration
(`20260825214212_participant_configuration.sql`, **never edited** —
`git diff origin/main...HEAD -- supabase/migrations/20260825214212*` is
empty). The only behavioral change: the per-row `prompt_version` literal
is now role-specific (`'advocate-v1'`/`'judge-v1'`) instead of the M6
placeholder (`'unassigned-pre-m7'`), derived internally from the same
`v_role` mapping already used for `role`/`side` — never a caller
parameter. No `UPDATE` statement anywhere in this file — no historical
`participant_configs` row is mutated; every M6 run frozen with
`'unassigned-pre-m7'` remains permanently execution-ineligible.

**Confirmed NOT applied** to the remote/linked Supabase database in this
task. It requires an independent static audit before it becomes
historical remote state, matching this project's established migration
discipline (Milestone 5/6 precedent). No `supabase db push` was run.

## Anti-drift check

`src/prompts/promptVersionDrift.test.ts` — reads the actual migration
source (never a separately maintained copy of the expected values) and
asserts: the migration's `when v_role = 'ADVOCATE' then '...'` literal
equals `ADVOCATE_PROMPT_VERSION` exactly; its `else '...'` (judge)
literal equals `JUDGE_PROMPT_VERSION` exactly; the migration never issues
an `UPDATE` against `participant_configs`; the M6 migration file still
contains `'unassigned-pre-m7'` unmutated; the function signature carries
no new caller-controlled parameter. This fails if `advocate-v1` ever
becomes `advocate-v2` in TypeScript while the migration still writes
`advocate-v1`, or the equivalent judge drift.

## Independent review corrections (pre-live gate)

Six implementation-contract defects were found despite the green CI
baseline above (commit 9, `637804a`). All six are corrected in commits
10–12. This section is additive audit history — it does not replace or
retract anything recorded above; the original implementation's scope
description, provider boundary, route resolution, etc. remain accurate
as written. Where a correction changes a previously-stated fact (one
case below), that fact is corrected explicitly, not silently.

### 1. Unknown pricing keys now fail closed

**Before:** `publicPricingSchema` was a plain `z.object(...)`; Zod's
default behavior strips any key it doesn't recognize during parsing,
before `pricing.ts`'s classifier ever runs. A future OpenRouter billable
dimension this repository does not yet know about (`"future_billable_
dimension": "0.01"`, for example) would silently disappear during
parsing and could never be rejected — a real violation of ADR Decision
7's "no unknown billable behavior may silently authorize a route."

**After:** `schemas.ts`'s `publicPricingSchema` uses `z.looseObject(...)`
(Zod 4's passthrough mechanism, confirmed by direct testing:
`Object.keys(parsed)` includes every key the raw payload carried,
known or not). `pricing.ts` adds one reviewed `KNOWN_PRICING_KEYS`
allowlist and a `findUnknownPricingKey` check, run *first* in
`buildPricingSnapshot` — any pricing object carrying a key outside the
allowlist blocks the endpoint with `PRICING_UNREPRESENTABLE`, before any
other classification runs. Known fields are still fully typed/validated
exactly as before.

### 2. `max_price` matches the current official OpenRouter contract

Reverified directly against the current
`https://openrouter.ai/openapi.json` (documentation only, no live API
call): `ProviderPreferences.max_price.{prompt,completion,request}` are
documented `string` type — "USD per million prompt/completion tokens" /
"USD per request" — the same decimal-string convention as every other
OpenRouter rate field. No conflict with the expected contract found; no
STOP was required.

**Before:** `providerPreferencesSchema.max_price` used `z.number()`, and
`executionRequest.ts` called `Decimal#toNumber()` to build the request —
a type mismatch against the real schema and an unnecessary, potentially
lossy conversion of an authoritative Decimal value.

**After:** `max_price.{prompt,completion,request}` are `z.string()`.
`executionRequest.ts` serializes the exact accepted `Decimal` via
`toDecimalString` (no `.toNumber()` anywhere in the request builder).
`max_price.prompt` uses `effectiveInputPricePerToken` (the cache-write-
aware bound already authoritative for local preflight), never the raw
prompt rate — this can only ever cause the ceiling to reject a request
whose real-time price has drifted upward since preflight observed it,
never accept one preflight's own bound would have excluded. `request` is
now always included (even when `$0`) for a simpler, consistently-tested
contract. Documented explicitly in code: `max_price` is provider-routing
*defense in depth*; local preflight (`preflight.ts`) remains sole
authority for the complete Tribunal economics.

### 3. Complete-Tribunal tier calculation

**Before:** `GET /api/models` classified `FREE`/`BUDGET`/`PREMIUM` from a
single advocate attempt's cost (no retry reserve, no judge economics at
all). `preflight.ts` derived a participant's route tier by multiplying
*that participant's own* retry-reserved cost by 7 — wrong for any judge
participant, since judge economics (1200 vs 1000 output cap, plus the
4×1000-token advocate-speech input reservation no advocate carries)
differ materially from advocate economics. Both were approximations of
the locked "conservative COMPLETE Tribunal route cost" contract
(ADR Decision 12), not the real thing.

**After:** one centralized helper,
`computeConservativeFullTribunalCostForRoute` (new
`netlify/server/openrouter/routeTierEconomics.ts`):

```text
4 x conservative advocate attempt cost x retry reserve (x2)
+
3 x conservative judge attempt cost x retry reserve (x2)
, then the approved safety factor (x1.10) applied ONCE to that sum
```

using canonical, run-independent worst-case advocate/judge token
estimates (`worstCaseAdvocateInputTokens`/`worstCaseJudgeInputTokens`,
moved into `tokenEstimation.ts`) so the same route always tiers
identically regardless of which participant or discovery context asks.
`economicsConstants.ts` extracts the shared
`MAX_RUN_COST_USD`/`BUDGET_SAFETY_FACTOR`/retry-count/Tribunal-shape
constants — no threshold changed. `GET /api/models` and
`preflight.ts`'s `participant.priceTier` both call this exact same
helper for the same resolved pricing snapshot and can no longer silently
drift apart. `priceTier` remains explicitly documented as a reusable
*route discovery category*, distinct from
`conservativeParticipantCostUsd` (this participant's real contribution)
and `conservativeMaxCostUsd` (this run's exact combined cost) — both
unchanged and still authoritative for the real run.

`modelDiscovery.ts`'s returned field is renamed from the misleading
`conservativeSingleCallEstimateUsd` to `conservativeFullTribunalEstimateUsd`
— no backward-compatibility alias was kept, since this M7-only endpoint
has never merged or shipped.

### 4. Prompt-version fingerprint

**Before:** `POST /api/runs`'s idempotency fingerprint
(`computeRequestFingerprint`) hardcoded `promptVersion:
PROMPT_VERSION_PLACEHOLDER` (the retired M6 `'unassigned-pre-m7'`
literal), even though the M7 bridge migration freezes role-specific
current versions (`advocate-v1`/`judge-v1`) once applied — the
fingerprint no longer represented the semantic prompt configuration a
new run would actually contain.

**After:** `computeRequestFingerprint`'s parameter changes from a
singular `promptVersion: string` to `promptVersions: { advocate: string;
judge: string }`; `acceptRun` (`netlify/server/runs.ts`) now supplies the
current, application-owned `ADVOCATE_PROMPT_VERSION`/
`JUDGE_PROMPT_VERSION` constants (`src/prompts/versions.ts`) — still
never caller-controlled (the strict per-participant schema already
rejects any caller-supplied prompt-version key, singular or plural; a
new regression test proves the plural form is rejected too). No SQL
migration change was needed or made: the fingerprint is Node-layer only,
independent of `prompt_version`'s own database column.

**Correction to a previously-stated fact:** the original evidence above
states "`POST /api/runs`... [is] untouched by M7's application code."
That is no longer accurate as written — `netlify/server/runs.ts`'s
fingerprint *computation* (not its status/budget/execution behavior, its
validation rules, or its write path) was corrected in this pass, for the
narrow reason above. `POST /api/runs` still does not gain any budget/
execution-status behavior, still does not persist `BLOCKED_BUDGET`, and
still does not call the M7 preflight service or OpenRouter — the ADR
Decision 14 scope boundary (`POST /api/runs` vs. standalone
`POST /api/preflight`) is fully intact; only the semantic content fed
into the pre-existing fingerprint hash changed.

This fix assumes the M7 migration and this Netlify code deploy together
(the intended single coordinated M7 rollout) — the fingerprint's new
role-specific values only correctly describe what gets frozen once both
ship as one release.

### 5. Production metadata cache wiring

**Before:** `ModelMetadataCache` (`cache.ts`) itself was correct and
already tested in isolation, but `runPreflight()` fell back to a brand
new, empty cache whenever the caller didn't inject one — and
`netlify/functions/preflight.ts`'s real `handler` never injected one, so
every invocation recreated an empty cache. `GET /api/models` bypassed
the cache class entirely and called the provider directly every time.
Neither matched the approved "bounded in-process, per-warm-function-
instance, 5-minute TTL" design (ADR Decision 3) in production.

**After:** new `netlify/server/openrouter/sharedMetadataCache.ts` —
two module-scope `ModelMetadataCache` singletons. A Netlify Function
module is reused across warm invocations of the same container, so
module-scope state persists exactly as long as that container stays
warm — the intended cache lifetime, no Redis, no DB table, no queue.
Both `POST /api/preflight` and `GET /api/models` now inject these same
two instances. `modelDiscovery.ts`'s `listEligibleModels` now accepts a
deps object (provider + optional `modelCache`/`endpointCache`/`clock`,
mirroring `preflight.ts`'s existing pattern) and fetches through
`cachedFetch` instead of calling the provider directly. Tests never
import the shared singletons — each test constructs its own cache (or
omits one, letting the service default to a fresh instance), so test
runs stay fully isolated and deterministic.

### 6. Lossless decimal serialization

**Before:** `toDecimalString` called `Decimal#toFixed(6)` — rounding to
6 decimal places. A legitimate non-zero provider per-token rate below
that precision (e.g. `$0.00000007`) could serialize as `"0.000000"` in
an authoritative API/audit field — a real price silently becoming zero
in output, even though the internal `Decimal` budget arithmetic itself
was always correct.

**After:** `toDecimalString` calls `Decimal#toFixed()` with **no**
argument — decimal.js's exact fixed-point representation at full
precision, confirmed by direct testing to never use scientific notation
and never round. A new, separately named `toDisplayUsdString` is added
for a future human-facing UI only (e.g. rounding `$0.00000007` to
`"0.00"`) — explicitly documented as never used for a provider rate, an
authoritative budget comparison, or an audit economics field.

## Second independent review corrections (pre-live gate)

A further independent audit of the six-fix pass above (commits 10–12)
found three more correctness defects and one documentation overclaim.
This section is additive audit history, exactly like the section above —
it does not retract or rewrite anything recorded earlier in this
document.

### 1. Shared-Tribunal discovery now requires complete (dual-role) capability

**Before:** `GET /api/models` resolved and evaluated every candidate
endpoint as an `ADVOCATE` only (`worstCaseAdvocateInputTokens()`,
`ADVOCATE_OUTPUT_CAP_TOKENS`), then presented the resolved route as
eligible for a "complete Tribunal" whose full-Tribunal tier already
accounts for 3 judges. A route can satisfy advocate output/context
capacity (`>=1000` tokens) while failing judge output/context capacity
(`>=1200` tokens, plus the judge's own 4×1000-token advocate-speech
reservation) — ARCHITECTURE.md §5.3's judge-prompt-capacity requirement
was not actually enforced on this generic discovery surface.

**After:** `resolveSharedTribunalRoute`
(`netlify/server/openrouter/modelDiscovery.ts`) requires the SAME exact
endpoint to pass BOTH the advocate eligibility contract and the judge
eligibility contract (reusing `routeResolution.ts`'s
`evaluateEndpoint`/`checkAliasOrDynamicModel`, not duplicating
eligibility logic) before it is ever returned. An endpoint capable of
only one role is excluded entirely — the resolver never independently
resolves a cheap advocate endpoint and a different, pricier judge-capable
endpoint and describes the pair as one route. Surviving (both-eligible)
candidates are ranked by the same `computeConservativeFullTribunalCostForRoute`
figure already used for the tier, with the same stable
`providerEndpointTag` lexical tie-break used everywhere else — ranking
and tiering can never disagree. `POST /api/preflight`
(`preflight.ts`) is unchanged and remains correctly role-specific per
frozen participant; this dual-role requirement is scoped to the generic
Shared-model discovery surface only.

### 2. The canonical worst-case bound now reflects the application's actual UTF-8 exposure

**Before:** the synthetic worst-case text (`tokenEstimation.ts`) used a
2-byte-UTF-8 character (Hebrew, `א`) and was documented as a conservative
maximum. It was not: the application's actual length validation
(`z.string().trim().max(N)` in `src/schemas/tribunalSetup.ts` — confirmed
by direct source inspection, no `.normalize()` call anywhere in that
file) bounds JS `String.prototype.length`, i.e. UTF-16 CODE UNITS, not
Unicode codepoints and not UTF-8 bytes. A lone BMP codepoint in
`U+0800..U+FFFF` (excluding the surrogate range `U+D800..U+DFFF`) — e.g.
CJK Unified Ideographs — costs 3 UTF-8 bytes for exactly 1 code unit of
the length budget. A surrogate pair (a supplementary-plane character, 2
code units) costs 4 UTF-8 bytes total — only 2 bytes/unit, LESS than a
lone 3-byte BMP character. 3 bytes/code-unit is therefore the true
maximum achievable under this application's exact validation semantics,
and no 4-byte content can ever exceed it — verified empirically:
`"漢"` (U+6F22) = 1 code unit = 3 UTF-8 bytes; `"😀"` (U+1F600,
supplementary) = 2 code units = 4 UTF-8 bytes = 2 bytes/unit; the retired
`"א"` = 1 code unit = 2 UTF-8 bytes = 2 bytes/unit.

**After:** `WORST_CASE_CHAR` is now a 3-byte BMP character (`"漢"`), with
the full proof recorded in code comments.
`worstCaseAdvocateInputTokens`/`worstCaseJudgeInputTokens` — and
therefore `routeTierEconomics.ts` and `modelDiscovery.ts`'s eligibility/
tier checks, which consume them — inherit the correction automatically;
no separate byte-limit formula was duplicated in `modelDiscovery.ts`.

### 3. `PricingSnapshot.observedAt` now reflects the actual endpoint metadata fetch timestamp

**Before:** `PricingSnapshot.observedAt` is contractually the metadata
FETCH timestamp (ADR Decision 9), but `preflight.ts` and
`modelDiscovery.ts` both computed `new Date(clock()).toISOString()` at
the current invocation and passed that into route resolution even when
`cachedFetch` reused fresh CACHED metadata — incorrect audit evidence
(e.g. metadata fetched at 20:00, reused at 20:04, incorrectly reported as
observed at 20:04).

**After:** `ModelMetadataCache#observedAt(key)` (`cache.ts`, unchanged —
it already recorded the real fetch time) is read immediately after each
`cachedFetch` call in both `preflight.ts` and `modelDiscovery.ts`, and
that actual timestamp is passed into route resolution — the invocation-
time value is kept only as a defensive, should-never-happen fallback.
When `cachedFetch` reuses a fresh cache hit, the timestamp is unchanged
(the original fetch time); when a genuine stale refetch occurs, the
timestamp updates to the new fetch time. Model-catalog and endpoint-cache
timestamps remain distinct internally (only the endpoint cache's
timestamp feeds `PricingSnapshot.observedAt`, since pricing is endpoint-
specific). `modelDiscovery.ts`'s public `EligibleModel` type gained a new
`pricingObservedAt` field so this is directly observable/testable over
`GET /api/models`, matching `POST /api/preflight`'s existing per-
participant `pricing.observedAt`.

### 4. Corrected the cross-Function cache-sharing overclaim

**Before:** `sharedMetadataCache.ts`'s comments (and the two Netlify
Functions importing it) stated that `GET /api/models` and
`POST /api/preflight` share the SAME module-scope cache instances at
runtime, so a warm container "never independently refetches metadata the
other endpoint already has." Separate Netlify Functions are not
guaranteed to inhabit the same process — this was a documentation
overclaim, not a relied-upon behavior the code actually required, but it
misstated the platform guarantee.

**After:** corrected to state the actual, reliable contract: each
function's own warm runtime reuses ITS OWN module-scope cache instances
across repeated invocations of THAT SAME function (the real, approved
"bounded in-process, per-warm-Function-instance" cache lifetime, ADR
Decision 3). Both functions still import the same source file so each is
correctly wired on its own — but correctness never depends on one
function's fetch priming the other's cache; if the platform happens to
colocate them, that is a harmless bonus, never a requirement.

## Third independent review corrections (pre-live gate)

A final, narrow source-level audit of the second correction pass above
(commits 14–15) approved everything in it except two remaining
implementation details that still violated the exact conservative/audit
contract. This section is additive audit history, exactly like the two
sections above — nothing recorded earlier in this document is retracted
or rewritten.

### 1. The canonical worst-case token helper now reproduces the real request shape

**Before:** the second pass corrected the worst-case synthetic-text
CHARACTER (item 2, above) but not its SHAPE.
`worstCaseChargeSheetText()` concatenated the three Charge Sheet field
limits (`defendant + act + exactQuestion`) into one run of characters
with no separators, while the real `runPreflight` estimator
(`preflight.ts`) joins `[defendant, act, exactQuestion]` with `"\n"` —
two application-added separator bytes were missing from the canonical
bound. `worstCaseAdvocateInputTokens()` also passed
`sideInstructions: ""`, but a real `ADVOCATE` participant's `side` is
always `"PRO"` or `"CON"` (`SIDE_BY_PARTICIPANT_ID` never maps an
advocate seat to `null`) — those bytes were missing too. Together, this
meant the canonical bound could be smaller than at least one valid
maximum real advocate estimate, violating the required invariant
"canonical worst-case estimate >= every valid actual estimate admitted
by current application validation."

**After:** `tokenEstimation.ts` adds ONE shared
`serializeChargeSheetForModelContext({ defendant, act, exactQuestion })`
helper, used by BOTH `runPreflight`'s real per-participant estimation
and the synthetic worst-case text — the field order and the two `"\n"`
separators can no longer silently drift apart into two independently-
written copies. `worstCaseChargeSheetText()` now fills three separate
`defendant`/`act`/`exactQuestion` fields (each at its own real limit)
and serializes them through that shared helper.
`worstCaseAdvocateInputTokens()` now computes both the real `"PRO"` and
`"CON"` variants and takes the max, rather than assuming the two prompt
variants are byte-identical today — a future wording change to only one
side's prompt can never silently make the bound too small again.
`worstCaseJudgeInputTokens()` inherits the corrected Charge Sheet
serialization automatically; `routeTierEconomics.ts` and
`modelDiscovery.ts`'s eligibility/tier checks, which consume these
functions, inherit the full correction with no duplicated formula.

### 2. `PricingSnapshot.observedAt` can no longer be fabricated

**Before:** the second pass corrected `preflight.ts`/`modelDiscovery.ts`
to prefer the endpoint cache's real fetch timestamp
(`endpointCache.observedAt(key)`) over the current invocation time — but
both still fell back to the invocation time
(`endpointCache.observedAt(key) ?? currentInvocationTime`) if the cache
timestamp was ever unexpectedly unavailable. That fallback fabricates an
audit timestamp the application does not actually have — violating the
stronger conservative/audit invariant that an unknown observation time
must never be invented.

**After:** `cache.ts` adds `requireCacheObservedAt(cache, key)`, which
throws a dedicated `CacheObservedAtUnavailableError` instead of
returning `null` or silently substituting `Date.now()`. Both
`preflight.ts` and `modelDiscovery.ts` now call it immediately after
their endpoint `cachedFetch`, inside the same `try` block that already
handles metadata-fetch failures — a missing timestamp is treated exactly
like any other fetch failure: `preflight.ts` blocks the affected
participant with `PRICING_UNAVAILABLE`; `modelDiscovery.ts` skips the
model entirely. Neither ever emits a fabricated `observedAt`/
`pricingObservedAt`.

### No-fabricated-telemetry review (Section 13 of the correction task)

Reviewed nearby M7 telemetry/economics code for this same class of
issue. Every other `??`/fallback pattern found was either: (a)
unreachable dead code already gated by an earlier eligibility check
(`endpoint.context_length ?? 0` / `supported_parameters ?? []` in
`routeResolution.ts`/`modelDiscovery.ts` — `evaluateEndpoint` already
requires these fields present and sufficient before route construction
is ever reached); (b) a genuinely-optional-and-zero-meaning documented
field (`pricing.request`'s absent-means-no-fee default, and the
`cacheRead`/`cacheWrite ?? Decimal(0)` defaults inside `pricing.ts`'s
`MAX(...)` formula, where "this endpoint doesn't report a cache rate"
correctly contributes zero to the conservative maximum); or (c) a
fallback that can only ever make eligibility MORE conservative, never
silently accept unknown data as safe (`supported_parameters ?? []`
causes a `.includes(...)` check to correctly fail closed, never pass, if
the field were ever actually absent). No further fabricated-telemetry
defect was found; `telemetry.ts`'s existing null-for-unavailable
contract (never a fabricated zero) is unaffected and remains correct.

## Tests added

162 tests across 12 test files were added by the initial implementation
(commits 5–7). The first correction pass (commits 10–12) added 36 more.
The second correction pass (commits 14–15) added 23 more. This third,
final micro-correction pass (commit 17) adds **4 more** across 3
modified files (no new files), for **225 M7 tests total** (plus the 112
pre-existing tests from Milestones 1–6 — **337 total** in the
repository, all passing, matching CI exactly):

| File | Tests | New this pass | Category |
|---|---|---|---|
| `netlify/server/openrouter/pricing.test.ts` | 48 | — | Pricing normalization, overrides, discount validation, cache-write economics, tiers, unknown-key fail-closed, lossless serialization |
| `netlify/server/openrouter/preflight.test.ts` | 27 | +1 | Preflight service: run/case loading, prompt-version gate, eligibility, response contract, zero side effects, deterministic repeat, cache production-wiring, observedAt fetch-timestamp semantics incl. missing-timestamp fail-closed regression |
| `netlify/server/openrouter/routeResolution.test.ts` | 32 | — | Alias/dynamic blocking, unique pinnability, endpoint eligibility, deterministic selection |
| `netlify/server/runs.test.ts` | 33 | — | (pre-existing M6 file) run validation, fingerprint determinism incl. role-specific prompt-version regression tests |
| `netlify/server/openrouter/tokenEstimation.test.ts` | 17 | +2 | UTF-8 byte-length estimation, advocate/judge bounds, output caps; canonical worst-case-bound conservativeness proofs now against the REAL preflight request shape (shared Charge Sheet serializer, real PRO/CON side text) |
| `netlify/functions/__tests__/runs.test.ts` | 16 | — | (pre-existing M6 file) `POST /api/runs` HTTP contract incl. fingerprint-uses-current-versions regression test |
| `src/prompts/schemas.test.ts` | 16 | — | Advocate/judge structured-output schemas, prompt content/side-enforcement, no-secrets check |
| `netlify/server/openrouter/provider.test.ts` | 15 | — | Server config, real provider parsing/error normalization/timeout |
| `netlify/server/openrouter/cache.test.ts` | 11 | — | TTL boundary, refresh-with-fallback semantics, deterministic eviction |
| `netlify/server/openrouter/modelDiscovery.test.ts` | 10 | +1 | Dual-role (advocate + judge) endpoint eligibility, selection, observedAt fetch-timestamp semantics, and missing-timestamp fail-closed regression for Shared-Tribunal discovery |
| `netlify/functions/__tests__/models.test.ts` | 8 | — | `GET /api/models` HTTP contract incl. renamed field, cache-reuse, dual-role-eligibility, and pricingObservedAt regression tests |
| `netlify/functions/__tests__/preflight.test.ts` | 9 | — | `POST /api/preflight` HTTP contract |
| `netlify/server/openrouter/executionRequest.test.ts` | 8 | — | Future execution route/request-builder contract incl. max_price string-serialization regression tests |
| `src/prompts/promptVersionDrift.test.ts` | 6 | — | Anti-drift check incl. fingerprint-source-uses-current-constants check |
| `netlify/server/openrouter/routeTierEconomics.test.ts` | 6 | — | Centralized complete-Tribunal route-tier formula |
| `netlify/server/openrouter/telemetry.test.ts` | 3 | — | Telemetry schema |
| `netlify/server/openrouter/sharedMetadataCache.test.ts` | 3 | — | Shared cache singleton wiring, boundedness |

All 225 M7 tests run against the fake provider / mocked `fetch` — zero
real OpenRouter network requests anywhere in the automated suite
(explicitly asserted in `preflight.test.ts` and both HTTP-layer test
files via a `fetch`-call-tracking guard).

## Automated verification

```sh
npm run lint          # 0 errors, 0 warnings
npm run typecheck      # 0 errors
npm run test           # 337 tests passed, 27 files, 0 failed
npm run build           # succeeds
npm run verify:client-bundle   # passed
npm run verify           # full pipeline, all green
```

## Production dependency audit

```sh
npm audit --omit=dev --audit-level=high
# found 0 vulnerabilities
```

decimal.js (the one new production dependency this milestone adds) is
MIT-licensed, has zero sub-dependencies, and is not flagged by the audit.

## Client secret boundary

`scripts/verify-client-bundle.mjs` already listed `OPENROUTER_API_KEY`
as a forbidden client-bundle identifier before this milestone (no change
was necessary). Re-run against the real `npm run build` output for this
milestone: **passed** — `OPENROUTER_API_KEY` does not appear anywhere in
`dist/`. Additionally confirmed `decimal.js`/`Decimal` do not appear in
the built client bundle at all (it is a server-only dependency; no
`netlify/server/**` module is ever imported from `src/**`).

## Verification evidence

- `git diff --check origin/main...HEAD` — no whitespace errors (reverified
  after all three correction passes).
- No source file under `supabase/migrations/2026082500*` or
  `20260825214212*` (the M5/M6 migrations) is touched by this branch —
  `git diff --stat origin/main...HEAD -- <those three files>` is empty.
  The M7 migration file itself (`20260826173253_...sql`) was also
  reverified unchanged since the first correction pass's starting HEAD
  (`637804a`), the second pass's starting HEAD (`8dc151a`), AND the
  third pass's starting HEAD (`6846319`) — no SQL edit was needed for
  any pass (every fix across all three passes is Node-layer only).
- Read-only `npx supabase@2.115.0 migration list --linked`, reverified
  before and after ALL THREE correction passes:
  `{"local":"20260826173253","remote":"","...}"` — M7 migration remains
  local-only; M5/M6 remain local==remote. No `supabase db push` was ever
  run.
- No completion call, advocate execution, judge execution, majority
  computation, or `model_call_attempts` persistence exists anywhere in
  this diff.
- The M6 freeze RPC (the applied SQL function) is untouched by M7's
  application code — the new migration only, not yet applied.
  `POST /api/runs`'s **request-fingerprint computation** (Node-layer,
  `netlify/server/runs.ts`) WAS corrected in the first independent-review
  pass (see "Independent review corrections," item 4) — its status/
  budget/execution behavior, validation rules, and write path are
  otherwise unchanged; it still never calls preflight or OpenRouter.
  Issue #11 was updated to record this correction truthfully (see below)
  rather than leaving its earlier "no `POST /api/runs` change" planning
  wording to read as contradicted.

## Issue #11 update

Issue #11's planning-phase text (written before implementation began) is
**not** rewritten — an "IMPLEMENTATION-PHASE CORRECTION RECORD" section
was appended recording, without erasing the original wording: (1) the
`POST /api/runs` fingerprint-computation correction and why it does not
violate ADR Decision 14's execution-wiring scope boundary; (2) the
dual-role Shared-Tribunal discovery requirement; (3) the corrected UTF-8
worst-case bound. **Updated again in the third pass** with a short
addendum to item 3, clarifying that the character-choice correction
alone was not sufficient — the synthetic text's shape (separators, real
side text) also needed correcting — and noting the `observedAt`
fail-closed fix, so item 3's wording could no longer be read as implying
the worst-case bound was already fully complete. Issue #11 remains
**OPEN**, not closed.

## Not yet live-verified

The following are explicitly **not** performed by this implementation
task, per ADR Decision 19/20 and the M7 implementation contract:

- **M7 Supabase migration** — `20260826173253_prompt_version_bridge.sql`
  exists on disk, reviewed, but is **not applied** to the remote/linked
  Supabase database.
- **Real OpenRouter metadata integration** — the one mandatory, manual,
  metadata-only live smoke (ADR Decision 19) has **not** been run. Zero
  real `GET /models` / `GET /models/{author}/{slug}/endpoints` requests
  have been made in this task.
- **Optional real completion smoke** (ADR Decision 20) — not authorized,
  not performed.

No secret value appears anywhere in this document, the test suite, or
the implementation.
