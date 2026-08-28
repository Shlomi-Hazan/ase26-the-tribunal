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

## Live integration gate

A fourth pass, authorized specifically to (1) apply the reviewed M7
migration to the linked development Supabase project and (2) perform
real, authenticated OpenRouter metadata requests. No model-completion
request was authorized or made. This section is **additive** — nothing
above is retracted.

### Supabase track — complete

- **Pre-push state** (`supabase migration list --linked`): `20260825000000`
  / `20260825204419` / `20260825214212` local == remote; `20260826173253`
  local-only, remote blank.
- **Dry run** (`supabase db push --linked --dry-run`): proposed exactly
  one migration, `20260826173253_prompt_version_bridge.sql` — no M5/M6
  migration, no destructive reset, no unrelated schema change.
- **Applied** (`supabase db push --linked`): succeeded, one migration
  applied.
- **Post-push state**: all four migrations local == remote; no
  additional/unexpected migration appeared remotely.
- **Remote freeze-function verification** (read-only `supabase db query
  --linked` against `pg_proc`/`information_schema.routine_privileges`):
  `pg_get_functiondef()` output for `public.freeze_participant_configuration`
  matches the reviewed migration source byte-for-byte, including its
  comments; `prosecdef = true` (SECURITY DEFINER preserved);
  `proconfig = {"search_path=\"\""}` (safe empty search_path preserved);
  signature unchanged; execute privileges are exactly `postgres` (owner)
  and `service_role` — `public`/`anon`/`authenticated` are not granted
  execute, matching the migration's explicit `revoke`/`grant` block.
- **Historical row immutability**: before the live freeze test,
  `participant_configs` contained exactly 42 rows, all
  `prompt_version = 'unassigned-pre-m7'` (6 pre-existing M6 runs × 7
  participants), `created_at` spanning 2026-08-26 13:28–13:37. After the
  live freeze test below, the same 42 rows are still present, still
  `unassigned-pre-m7`, unchanged — only 7 new rows were added, none of
  the 42 historical rows was touched (the migration contains no
  `UPDATE`, only `CREATE OR REPLACE FUNCTION`).
- **Live freeze/RPC test** through the real application contract
  (`POST /api/runs` against the running dev server, Shared mode, a
  synthetic non-sensitive case and 7 synthetic participant personalities,
  model id `test/m7-live-gate-synthetic-model` used purely for structural
  validation — no completion is ever attempted against it): HTTP 201;
  exactly one run (`status: READY`, `executionMode: shared`); exactly
  seven participant configs; the four `advocate-*` entries all carry
  `promptVersion: "advocate-v1"`; the three `judge-*` entries all carry
  `promptVersion: "judge-v1"`; roles/sides correct
  (`advocate-pro-*`→PRO, `advocate-con-*`→CON, `judge-*`→null); no model
  execution occurred.
- **Idempotency regression** (Section 10 of the live-gate task), all via
  the real `POST /api/runs` endpoint:
  - **A** — replaying the byte-identical request (same
    `clientRequestId`, same semantic content) returned HTTP 201 with the
    **same** run id as the original — reused, not duplicated.
  - **B** — the same `clientRequestId` with a materially changed
    `exactQuestion` (different semantic fingerprint) returned **HTTP 409
    `idempotency_conflict`**.
  - **C** — a request body adding a caller-supplied `promptVersion` field
    on a participant entry was rejected outright: **HTTP 400
    `invalid_run`**, `"Unrecognized key: \"promptVersion\""` —
    `z.strictObject` enforcement confirmed live, not just in unit tests.
  - **D** — a direct read-only count of `participant_configs` for the
    frozen run after the Test-A replay returned exactly **7** rows, never
    14 — no duplicate participant-config set was created by the replay.

### OpenRouter track — blocked (not a code defect)

- **Real authentication smoke**: `GET /api/models` against the real
  running application returned **HTTP 502 `provider_unavailable`** in
  53 ms — too fast to be a real network round trip, and confirmed by a
  narrow, throwaway diagnostic (written, run, and deleted before any
  commit — never part of the repository) to be a `ServerConfigError`
  thrown by `readOpenRouterServerConfig()`: `OPENROUTER_API_KEY` is
  present as a key in this environment's `.env` file but its **value is
  empty** (`OPENROUTER_API_KEY=`, zero characters). This is exactly the
  fail-closed behavior `env.ts` is designed to produce for a missing
  key — the application-level contract is working correctly; there is
  simply no real credential configured in this environment for it to
  use.
- **Independent connectivity check** (outside the application, to
  distinguish "no real key configured" from "network/DNS/OpenRouter
  outage"): a direct unauthenticated `curl` to the public
  `GET https://openrouter.ai/api/v1/models` endpoint returned **HTTP
  200** with 387 models — OpenRouter's model-catalog endpoint does not
  require authentication, so this only proves network reachability, not
  that a real key exists; it does **not** substitute for the
  application's own authenticated path, since `env.ts` intentionally
  requires a non-empty `OPENROUTER_API_KEY` regardless of whether the
  specific OpenRouter endpoint itself would accept an anonymous request.
- Because of the above, **no part of Sections 13–24 of the live-gate
  task could be performed against the real application**: real model
  catalog parsing, real endpoint metadata parsing, live
  eligibility/pinnability resolution against real endpoints, the real
  `GET /api/models` smoke, live test-model selection, the real
  M7-frozen-run-against-a-real-model step, the real `POST /api/preflight`
  smoke, preflight read-only verification, and the cache live smoke are
  all **not performed** — not because the M7 implementation failed, but
  because no working `OPENROUTER_API_KEY` value exists in this
  environment for the application to use.
- **Failure-boundary substitute**: since `POST /api/preflight`'s handler
  constructs the OpenRouter provider (and therefore requires the real
  key) before `runPreflight()`'s own `PROMPT_VERSION_UNASSIGNED` check
  ever runs, the historical-run failure-boundary example from Section 24
  of the live-gate task could not be exercised through preflight either
  (it also returns `provider_unavailable`, for the same missing-key
  reason — not a new defect). A different, key-independent failure
  boundary was exercised instead, live, against `POST /api/runs`: a
  malformed body (`{"bad":"payload"}`) returned a stable `HTTP 400
  invalid_run` with a field-level error list and no stack trace; a
  request naming a nonexistent case id similarly returned a stable
  `HTTP 400` (participant-shape validation fired first, before any
  database lookup) — both confirm the safe-4xx-error-boundary contract
  live, without needing OpenRouter.
- **Zero completion / zero spend**: `createChatCompletion` was not
  invoked by any code path in this task — every attempted application
  call to an OpenRouter-backed endpoint failed at synchronous config
  construction, before any network request left the process. The one
  real network request made anywhere in this task (the independent
  connectivity check above) was an unauthenticated `GET` to a public
  metadata endpoint. No inference/model-completion request was made by
  this live gate; inference spend attributable to this gate is `$0.00`.

### Regression after the live gate

- `npm run verify` (lint + typecheck + `vitest run` + build +
  client-bundle check): green, no code was changed by this pass.
- Exact test count: **337 tests passed, 27 files, 0 failed** — unchanged
  from the third static pass, since no test or implementation file was
  modified.
- `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities.
- `git diff --check origin/main...HEAD`: clean.

### Verdict

**M7 LIVE GATE BLOCKED** — the Supabase track (migration application,
remote freeze-function verification, historical-row immutability, live
freeze/RPC test, full idempotency regression) is complete and passed
every check. The OpenRouter metadata track could not be exercised
because this environment has no real, non-empty `OPENROUTER_API_KEY`
configured — an external prerequisite gap, not an M7 implementation
defect. No code was changed to work around this. Re-running Sections
11–24 of the live-gate task only requires a real OpenRouter API key to
be placed in this environment's own `.env` (or equivalent local secret
store) by the project owner — never pasted through chat — after which
the OpenRouter track can be completed without any further code change.

## Live integration gate — OpenRouter track resumed

The project owner configured a real, non-empty `OPENROUTER_API_KEY`
directly in this environment's `.env` (never pasted through chat). This
section resumes ONLY the OpenRouter metadata track; the Supabase track
above remains complete and was not re-run (no migration re-applied).

### Missing-key blocker resolved, but a real defect was found underneath it

With the real key in place, `POST /api/runs`-backed and `GET
/api/models`-backed traffic through the real running application no
longer fails at config construction — `readOpenRouterServerConfig()`
succeeds, confirmed via a narrow, throwaway diagnostic edit to
`netlify/functions/models.ts` (one `console.log` line, added, exercised,
then reverted with `git checkout --` before anything was committed —
never part of any commit). The application now genuinely reaches the
real OpenRouter network and gets a real HTTP response.

That real response, however, **fails Zod schema validation** in
`RealOpenRouterProvider.listModels()` (`ProviderError: Provider response
failed schema validation`, mapped by the existing error handling to
`502 provider_unavailable` — the identical status code the missing-key
case also produced, which is why the two situations look alike from the
HTTP layer alone; they are not the same defect). Isolated via a second
throwaway diagnostic (fetching the real payload directly and inspecting
`ZodError.issues`, never dumping the payload; also deleted before any
commit):

- **Exact mismatch**: `pricing.overrides[].utc_days` is declared in
  `netlify/server/openrouter/schemas.ts`'s `pricingOverrideSchema` as
  `z.array(z.number()).optional()`, but the real, live OpenRouter
  `GET /models` response contains **string** elements in that array for
  at least some models' conditional-pricing override entries.
- **Scope** (safe aggregate only, no payload content recorded): of 387
  models in the real catalog at the time of this test, exactly **2**
  contain the mismatched shape — but because the top-level schema is a
  strict `z.array(rawOpenRouterModelSchema)` (not a per-item
  catch/skip), Zod fails the **entire** parse when any single element is
  invalid. Two non-conforming models therefore make **all 387** models
  unparseable, not just the two affected ones.
- **Blast radius**: every code path that depends on `listModels()` —
  `GET /api/models`, and `POST /api/preflight` for any run whose prompt
  version is already assigned (i.e. every real M7 run, not historical
  M6 placeholder runs) — is unavailable while this shape appears
  anywhere in the live catalog. This is a genuine, real-data-only defect
  the fake/mocked provider used by the automated test suite cannot
  surface, since the fake always returns clean numeric `utc_days`.
- **No code was changed to fix or route around this.** Per this task's
  explicit instruction, the defect is reported here for independent
  review rather than patched in this pass.

### What was verified before hitting the defect

- **Real authenticated request succeeds**: with the real key, the
  application constructs its OpenRouter config successfully and issues
  a real network request (no longer failing at synchronous config
  construction) — confirmed via the reverted diagnostic above.
- **Historical M6 run correctly short-circuits before ever needing
  `listModels()`**: `POST /api/preflight` for a pre-existing
  `unassigned-pre-m7` run returns **HTTP 200** (not 502) with
  `eligible: false`, `blockedReasonCodes: ["PROMPT_VERSION_UNASSIGNED"]`,
  `conservativeMaxCostUsd: "0"`, and all seven participants individually
  blocked with the same reason code — proving the prompt-version gate
  runs, and correctly rejects, before any route resolution is attempted.
  `participant_configs` counts (42 `unassigned-pre-m7` / 4 `advocate-v1`
  / 3 `judge-v1`) were confirmed unchanged before and after this call —
  preflight remains read-only.
- **Failure boundary, live**: a malformed `runId` (`"not-a-uuid"`)
  returns `400 invalid_preflight_request`; a well-formed but unknown
  `runId` returns `404 run_not_found` — both stable, no stack trace, no
  secret.
- **Zero completions**: no code path in this task ever reached
  `createChatCompletion` or `POST /chat/completions` — every real
  OpenRouter network call made was a metadata `GET /models` request
  (either through the diagnostics above or the direct connectivity
  check from the previous pass). Inference spend attributable to this
  gate: `$0.00`.

### Sections not reachable this pass

Because `listModels()` fails against the live catalog, the following
Sections of the live-gate task could not be performed: real endpoint
metadata parsing, live route resolution against real endpoints, the
real `GET /api/models` smoke, live test-model selection, a real-model
frozen run, `POST /api/preflight` against a real-model run, and the
cache live smoke. All remain outstanding pending the schema fix below
being independently reviewed and applied in a future, separate pass.

### Verdict (OpenRouter track, this pass)

**M7 LIVE GATE BLOCKED** — reason: a real schema/live-data mismatch in
`pricingOverrideSchema.utc_days` (`z.number()` vs. the real API's
`string` elements) causes `RealOpenRouterProvider.listModels()` to fail
for the entire model catalog whenever any model's conditional-pricing
override uses this shape, which the real catalog does today (2 of 387
models). This is a genuine M7 implementation defect against real data,
not an environment/credential issue, and not fixed in this pass per
explicit instruction to stop and report rather than patch.

## Live integration gate — utc_days schema correction and resumed metadata gate

Independently reverified against the current official OpenRouter OpenAPI
(`https://openrouter.ai/openapi.json`,
`components.schemas.PricingOverride.properties.utc_days`) immediately
before this fix: `type: array`, `items.type: string` (the documented
weekday enum, `x-speakeasy-unknown-values: allow`), `minItems: 1` —
unchanged since the defect was first found. `pricingOverrideSchema.utc_days`
was corrected from `z.array(z.number()).optional()` to
`z.array(z.string()).min(1).optional()` (commit `acd0187`), a parsing-only
change — ADR Decision 7A's `pricing.overrides.length > 0 →
PRICING_UNREPRESENTABLE` block is untouched and reverified by a new
regression test using the exact real-shape string `utc_days` that
previously failed to parse at all. 337 → 344 tests (27 files unchanged).
CI green on the exact fix HEAD (run `33162105268`).

### Direct production-code invocation (netlify dev sandbox bypass)

Resuming the metadata gate through the running `netlify dev` server hit a
**second, separate** finding: `GET /api/models` hung for exactly 30
seconds and failed with `lambda-local`'s own `TimeoutError: Task timed
out after 30.00 seconds` — reproduced twice, including after a clean
restart. Isolated precisely before concluding anything: the identical
`RealOpenRouterProvider.listModels()` call, invoked directly outside the
`netlify dev` sandbox (real key, real network), succeeded in ~190ms with
all 387 models parsed — proving the schema fix works and the code itself
is fast and correct. The same running sandbox handles other real
external calls fine (`POST /api/runs`, `POST /api/preflight` for the
historical run — both Supabase-backed). With the user's explicit
authorization, the remainder of this gate was therefore performed by
invoking the real, unmodified, exported production functions directly
(`RealOpenRouterProvider`, `handleModelsRequest`, `runPreflight`,
`resolveSharedTribunalRoute`, `acceptRun` with the real Supabase
repositories) — bypassing only `netlify dev`'s own broken Lambda-sandbox
transport layer for OpenRouter-bound calls, never mocking OpenRouter or
Supabase, never reimplementing application logic. This is documented as
a substitution: **the local `netlify dev` HTTP path for OpenRouter-bound
requests was not itself verified working; the real application code
underneath it was.**

### What succeeded, fully live, via direct invocation

- **Real catalog**: `handleModelsRequest` (the real `GET /api/models`
  handler export) succeeded, HTTP 200, 33 eligible models out of 387 raw
  catalog models, tier breakdown `{BUDGET:10, FREE:1, ABOVE_PREMIUM:6,
  PREMIUM:16}` — `HARD_BLOCK` correctly never returned as an eligible
  option.
- **Real endpoint metadata**: two real candidate models' endpoints
  parsed successfully with all required fields present (`tag`,
  `provider_name`, `context_length`, `max_completion_tokens`, `status`,
  `pricing`).
- **Real route resolution**: `resolveSharedTribunalRoute` for the
  selected model (`liquid/lfm-2.5-2.6b:free`, FREE tier) returned
  `eligible: true`, `providerEndpointTag: "liquid/fp8"`,
  `isUniquelyPinnable: true`.
- **Real frozen run**: a new Shared-mode synthetic run, created through
  the real `acceptRun`/Supabase repository path using the real selected
  model id, returned `status: READY`, exactly 7 participant configs,
  advocates all `advocate-v1`, judges all `judge-v1`.
- **Real preflight**: `runPreflight` for that run returned `eligible:
  true`, `hardBudgetUsd: "5"`, `conservativeMaxCostUsd: "0"` (correct for
  a FREE-tier route), `remainingBudgetUsd: "5"`, `blockedReasonCodes: []`,
  all seven participants individually eligible with the correct resolved
  endpoint (`liquid/fp8`), tier, and a real `observedAt` timestamp.
- **Read-only proof**: `participant_configs` prompt-version counts before
  and after every preflight call in this pass were confirmed identical
  (42 `unassigned-pre-m7` unchanged throughout; the two synthetic frozen
  runs created by this pass's diagnostics — one from an initial timed-out
  attempt, one from the completed run — correctly added 12 `advocate-v1`
  / 9 `judge-v1` total, exactly 7 rows per run, no duplication).
- **Historical placeholder / failure boundary** (via real HTTP, since
  these short-circuit before ever touching OpenRouter): the historical
  `unassigned-pre-m7` run still returns `PROMPT_VERSION_UNASSIGNED`;
  malformed `runId` → `400`; unknown `runId` → `404`.
- **Zero completions**: `createChatCompletion` was not invoked anywhere
  in this pass; no request reached `/chat/completions`. Every real
  OpenRouter network call observed was a `GET /models` or `GET
  /models/{author}/{slug}/endpoints` metadata request. Inference spend
  attributable to this gate: `$0.00`.

### A third real defect found — not fixed

Timing the direct-invocation calls surfaced a genuine, previously-unknown
issue distinct from the `utc_days` schema mismatch:

- The **first**, cold `handleModelsRequest` call took **45,744 ms**
  against the real 387-model catalog — `listEligibleModels()`
  (`modelDiscovery.ts`) makes one real, sequential `listEndpoints()`
  network round trip **per catalog model** (no batching/parallelism),
  so wall-clock time scales linearly with real catalog size. At real
  scale this is likely to exceed typical serverless function execution
  limits in an actual deployment — a materially different concern from
  anything the small fixed-size fake-provider catalogs in the automated
  test suite could ever surface.
- The **second** call, made moments later against the exact same
  `modelCache`/`endpointCache` instances (well within the 5-minute TTL),
  took **47,135 ms** — essentially the same duration as the first, not a
  cache hit. The selected model's `pricingObservedAt` differed between
  the two calls (`10:59:09.050Z` vs. `10:59:53.191Z`, ~44s apart),
  proving a fresh network refetch occurred rather than a cache reuse.
  Root cause, confirmed by reading `cache.ts` (read-only — not modified):
  `MODEL_METADATA_CACHE_MAX_ENTRIES = 200`, whose own comment documents
  it as sized for preflight's small per-run working set ("at most seven
  participants, realistically far fewer distinct models"). A full-catalog
  discovery sweep needs one entry per catalog model — currently 387,
  which exceeds the 200-entry cap — so the least-recently-set eviction
  policy discards early entries before the sweep even finishes,
  producing continuous thrashing instead of effective caching for the
  discovery use case. This was also observed to affect `POST
  /api/preflight`: the chosen model's endpoint entry, freshly cached
  moments earlier during the catalog sweep, had already been evicted by
  the time preflight ran on the same warm caches, forcing a second real
  refetch for a model that should have been a clean cache hit.
- **Not fixed in this pass** — this is a distinct architectural/capacity
  question (how the cache should be sized or scoped for a full-catalog
  discovery sweep versus a single frozen run's small participant set),
  out of scope for the narrow `utc_days` schema correction this pass was
  authorized to make. Reported here for independent review rather than
  patched.

### Verdict (OpenRouter track, this resumed pass)

**M7 LIVE GATE BLOCKED** — reason: the `utc_days` schema defect is fixed
and verified (catalog parsing, endpoint parsing, route resolution, a real
frozen run, and real preflight all succeed end to end against live
OpenRouter data). Two things remain open, discovered only by this real,
at-scale live test: (1) the local `netlify dev` HTTP path itself was not
verified working for OpenRouter-bound requests — only the real
application code underneath it, invoked directly, was; (2) a real cache
capacity/latency defect (`MODEL_METADATA_CACHE_MAX_ENTRIES` too small
for the real catalog size) causes `GET /api/models` to take ~45+ real
seconds on every call, cold or warm, and can force spurious re-fetches
inside `POST /api/preflight` too — reported for independent review, not
fixed.

## Live integration gate — discovery-scale correction and completed metadata gate

The cache-capacity/cold-latency defect above is fixed (commit `cbe8526`):
a deterministic bounded-concurrency worker pool
(`MODEL_DISCOVERY_ENDPOINT_CONCURRENCY = 8`, reverified against the
current OpenRouter OpenAPI immediately before locking — no documented
numeric rate limit conflicts with it) replaces the fully-sequential
per-model endpoint sweep, and a separate, explicit
`ENDPOINT_METADATA_CACHE_MAX_ENTRIES = 1024` (applied only to
`sharedEndpointCache`, more than 2x the observed real catalog size, still
an explicit fixed in-process bound) replaces the too-small 200-entry
default that caused mid-sweep eviction/thrashing. 344 → 352 tests
(27 → 28 files) — a new `modelDiscoveryScale.test.ts` proves bounded
concurrency (≤8, >1, genuinely concurrent), all 387 synthetic candidates
processed, deterministic result ordering under shuffled completion
order, one endpoint failure skipping only that model, a full 387-model
sweep surviving a second call inside the TTL with zero additional
fetches (with an explicit companion test proving the *old* 200-entry
default still fails this same scenario), TTL boundary semantics
preserved at scale, and a discovery-to-preflight cache-handoff test. No
safety/eligibility/pricing policy changed. CI green on the fix HEAD (run
`33167518600`).

### Correcting the earlier diagnosis

The earlier evidence in this document described the `netlify dev` 30s
timeout as a Lambda-sandbox/OpenRouter-fetch tooling limitation. That
diagnosis is now understood to have been **incomplete**: it was an
observed *symptom* of the real application's catalog-scale latency, not
a proven sandbox transport defect. Direct production-code invocation
(bypassing the sandbox) always executed the real logic correctly and
quickly for a *small* catalog/participant set — the sandbox only ever
failed when the underlying call itself genuinely took close to or beyond
30 real seconds. With discovery latency now fixed, the real `netlify dev`
HTTP path was retested directly and **succeeds**:

- **Cold** `GET /api/models` (fresh caches): HTTP 200, **6,008 ms**
  (previously ~45.7s / ~30s sandbox timeout), 33 eligible models.
- **Warm** `GET /api/models` (same warm caches, moments later): HTTP
  200, **97 ms** (previously ~47.1s), identical eligible model count,
  `pricingObservedAt` unchanged for a sampled model — a genuine cache
  hit, not a refetch.
- Direct production-code timing (same measurement, outside the sandbox,
  for cross-check): cold **7,685 ms**, warm **67 ms** — consistent with
  the HTTP-path numbers above, both comfortably under the 15-second
  target and far under the known 30-second local Function deadline.

**Conclusion: the `netlify dev` sandbox transport itself was never
broken.** The correct diagnosis, confirmed by this retest, is
catalog-scale application latency alone — now fixed.

### Real frozen run and preflight, via the now-working HTTP path

A new Shared-mode synthetic run was created via the real `POST /api/runs`
HTTP endpoint using a real eligible model (`tencent/hy4-preview`, BUDGET
tier, selected FREE > BUDGET > PREMIUM preference order — no FREE model
was eligible in this catalog snapshot): `status: READY`, 7 participant
configs, all advocates `advocate-v1`, all judges `judge-v1`. The real
`POST /api/preflight` HTTP endpoint for that run returned in 726ms:
`eligible: true`, `hardBudgetUsd: "5"`, `conservativeMaxCostUsd:
"0.0759843656"`, `remainingBudgetUsd: "4.9240156344"` (arithmetically
consistent: `5 − 0.0759843656 = 4.9240156344`), `blockedReasonCodes: []`,
all seven participants eligible with the resolved endpoint
`tencent/fp8`, BUDGET tier, real `observedAt`. No persistence mutation:
`participant_configs` prompt-version counts before and after (42
`unassigned-pre-m7` unchanged; +4 `advocate-v1` / +3 `judge-v1` for
exactly this one new run, no duplication).

### Historical placeholder / failure boundary / zero completion (final reverification)

All via the real HTTP path: the historical `unassigned-pre-m7` run still
returns `blockedReasonCodes: ["PROMPT_VERSION_UNASSIGNED"]` (HTTP 200);
malformed `runId` → `400 invalid_preflight_request`; unknown `runId` →
`404 run_not_found`. Server logs contain no `/chat/completions` request
anywhere in this pass; `createChatCompletion` was not invoked.
**No inference/model-completion request was made by this gate.**
Inference spend attributable to this gate: **$0.00**.

### Verdict (final)

**All conditions for live-gate readiness are now met**: cold discovery
completes safely below the 30-second deadline (6.0s HTTP / 7.7s direct,
both under the 15s target); warm discovery genuinely reuses fresh
endpoint metadata (97ms / 67ms, unchanged `pricingObservedAt`, zero
additional fetches); the real `netlify dev` `GET /api/models` HTTP path
was retested and succeeds, with the prior timeout correctly attributed
to application latency rather than a persistent tooling defect; real
`POST /api/preflight` succeeds end to end for a real eligible model; and
zero completion calls occurred anywhere in this gate.

## Not yet live-verified

- **Optional real completion smoke** (ADR Decision 20) — not authorized,
  not performed. This remains the only intentionally-out-of-scope item;
  it is never part of any M7 live-gate pass.

Every other item previously listed in this section — the M7 Supabase
migration, the missing-`OPENROUTER_API_KEY`-value blocker, the
`utc_days` schema defect, the `netlify dev` HTTP path, and the
cache-capacity/cold-latency defect — has been resolved and verified live
in the sections above.

No secret value appears anywhere in this document, the test suite, or
the implementation.
