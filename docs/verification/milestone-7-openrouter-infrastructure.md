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
| 13 | *(this evidence-update commit)* | `docs: record M7 pre-live correction verification` |

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
input (Hebrew-biased, matching `docs/economics.md` §10.1's conservative
rationale) rather than a real run's text, since no real participant text
exists yet at discovery time. `HARD_BLOCK` routes are excluded entirely;
`ABOVE_PREMIUM` routes are returned, correctly labelled, so a future UI
can make the separate product decision about how prominently to surface
them (ADR policy).

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

## Tests added

162 tests across 12 test files were added by the initial implementation
(commits 5–7); the independent-review correction pass (commits 10–12)
adds 36 more across 2 new files and 7 modified files, for **198 M7 tests
total** (plus the 112 pre-existing tests from Milestones 1–6 — **310
total** in the repository, all passing, matching CI exactly):

| File | Tests | New this pass | Category |
|---|---|---|---|
| `netlify/server/openrouter/pricing.test.ts` | 48 | +12 | Pricing normalization, overrides, discount validation, cache-write economics, tiers, unknown-key fail-closed, lossless serialization |
| `netlify/server/openrouter/routeResolution.test.ts` | 32 | — | Alias/dynamic blocking, unique pinnability, endpoint eligibility, deterministic selection |
| `netlify/server/openrouter/preflight.test.ts` | 21 | +4 | Preflight service: run/case loading, prompt-version gate, eligibility, response contract, zero side effects, deterministic repeat, cache production-wiring |
| `netlify/server/runs.test.ts` | 33 | +5 | (pre-existing M6 file) run validation, fingerprint determinism incl. role-specific prompt-version regression tests |
| `netlify/functions/__tests__/runs.test.ts` | 16 | +1 | (pre-existing M6 file) `POST /api/runs` HTTP contract incl. fingerprint-uses-current-versions regression test |
| `src/prompts/schemas.test.ts` | 16 | — | Advocate/judge structured-output schemas, prompt content/side-enforcement, no-secrets check |
| `netlify/server/openrouter/provider.test.ts` | 15 | — | Server config, real provider parsing/error normalization/timeout |
| `netlify/server/openrouter/cache.test.ts` | 11 | — | TTL boundary, refresh-with-fallback semantics, deterministic eviction |
| `netlify/functions/__tests__/preflight.test.ts` | 9 | — | `POST /api/preflight` HTTP contract |
| `netlify/server/openrouter/tokenEstimation.test.ts` | 8 | — | UTF-8 byte-length estimation, advocate/judge bounds, output caps |
| `netlify/server/openrouter/executionRequest.test.ts` | 8 | +2 | Future execution route/request-builder contract incl. max_price string-serialization regression tests |
| `src/prompts/promptVersionDrift.test.ts` | 6 | +1 | Anti-drift check incl. fingerprint-source-uses-current-constants check |
| `netlify/server/openrouter/routeTierEconomics.test.ts` | 6 | +6 (new file) | Centralized complete-Tribunal route-tier formula |
| `netlify/functions/__tests__/models.test.ts` | 6 | +2 | `GET /api/models` HTTP contract incl. renamed field + cache-reuse regression tests |
| `netlify/server/openrouter/telemetry.test.ts` | 3 | — | Telemetry schema |
| `netlify/server/openrouter/sharedMetadataCache.test.ts` | 3 | +3 (new file) | Shared cache singleton wiring, boundedness |

All 198 M7 tests run against the fake provider / mocked `fetch` — zero
real OpenRouter network requests anywhere in the automated suite
(explicitly asserted in `preflight.test.ts` and both HTTP-layer test
files via a `fetch`-call-tracking guard).

## Automated verification

```sh
npm run lint          # 0 errors, 0 warnings
npm run typecheck      # 0 errors
npm run test           # 310 tests passed, 26 files, 0 failed
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
  after the correction pass).
- No source file under `supabase/migrations/2026082500*` or
  `20260825214212*` (the M5/M6 migrations) is touched by this branch —
  `git diff --stat origin/main...HEAD -- <those three files>` is empty.
  The M7 migration file itself (`20260826173253_...sql`) was also
  reverified unchanged since the correction pass's starting HEAD
  (`637804a`) — no SQL edit was needed for the prompt-version fingerprint
  fix (Node-layer only).
- Read-only `npx supabase@2.115.0 migration list --linked`, reverified
  both before and after the correction pass:
  `{"local":"20260826173253","remote":"","...}"` — M7 migration remains
  local-only; M5/M6 remain local==remote. No `supabase db push` was ever
  run.
- No completion call, advocate execution, judge execution, majority
  computation, or `model_call_attempts` persistence exists anywhere in
  this diff.
- The M6 freeze RPC (the applied SQL function) is untouched by M7's
  application code — the new migration only, not yet applied.
  `POST /api/runs`'s **request-fingerprint computation** (Node-layer,
  `netlify/server/runs.ts`) WAS corrected in the independent-review pass
  (see "Independent review corrections," item 4) — its status/budget/
  execution behavior, validation rules, and write path are otherwise
  unchanged; it still never calls preflight or OpenRouter.

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
