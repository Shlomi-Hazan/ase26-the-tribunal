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

## Implementation commits (this evidence)

| # | SHA | Message |
|---|---|---|
| 5 | `ca319c8` | `feat: add OpenRouter metadata and pricing infrastructure` |
| 6 | `aac618d` | `feat: add Milestone 7 preflight infrastructure` |
| 7 | `c4cc981` | `feat: add versioned Tribunal prompt registry` |
| 8 | *(this evidence commit)* | `docs: record Milestone 7 pre-live verification` |

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

## Tests added

162 new tests across 12 new test files (plus the 112 pre-existing tests
from Milestones 1–6, unaffected — 274 total in the repository):

| File | Tests | Category |
|---|---|---|
| `netlify/server/openrouter/pricing.test.ts` | 36 | Pricing normalization, overrides, discount validation, cache-write economics, tiers |
| `netlify/server/openrouter/routeResolution.test.ts` | 32 | Alias/dynamic blocking, unique pinnability, endpoint eligibility, deterministic selection |
| `netlify/server/openrouter/preflight.test.ts` | 17 | Preflight service: run/case loading, prompt-version gate, eligibility, response contract, zero side effects, deterministic repeat |
| `src/prompts/schemas.test.ts` | 16 | Advocate/judge structured-output schemas, prompt content/side-enforcement, no-secrets check |
| `netlify/server/openrouter/provider.test.ts` | 15 | Server config, real provider parsing/error normalization/timeout |
| `netlify/server/openrouter/cache.test.ts` | 11 | TTL boundary, refresh-with-fallback semantics, deterministic eviction |
| `netlify/functions/__tests__/preflight.test.ts` | 9 | `POST /api/preflight` HTTP contract |
| `netlify/server/openrouter/tokenEstimation.test.ts` | 8 | UTF-8 byte-length estimation, advocate/judge bounds, output caps |
| `netlify/server/openrouter/executionRequest.test.ts` | 6 | Future execution route/request-builder contract |
| `src/prompts/promptVersionDrift.test.ts` | 5 | Anti-drift check |
| `netlify/functions/__tests__/models.test.ts` | 4 | `GET /api/models` HTTP contract |
| `netlify/server/openrouter/telemetry.test.ts` | 3 | Telemetry schema |

All 162 run against the fake provider / mocked `fetch` — zero real
OpenRouter network requests anywhere in the automated suite (explicitly
asserted in `preflight.test.ts` and both HTTP-layer test files via a
`fetch`-call-tracking guard).

## Automated verification

```sh
npm run lint          # 0 errors, 0 warnings
npm run typecheck      # 0 errors
npm run test           # 274 tests passed, 24 files, 0 failed
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

- `git diff --check origin/main...HEAD` — no whitespace errors.
- No source file under `supabase/migrations/2026082500*` or
  `20260825214212*` (the M5/M6 migrations) is touched by this branch.
- No completion call, advocate execution, judge execution, majority
  computation, or `model_call_attempts` persistence exists anywhere in
  this diff.
- `POST /api/runs` and the M6 freeze RPC are untouched by M7's
  application code (the new migration only, not yet applied).

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
