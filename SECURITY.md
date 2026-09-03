# The Tribunal — Security and Privacy

> **Scope:** V1 single-tenant public course/demo application.
> **Security principle:** Minimize blast radius, keep authority server-side, and treat user/model/external data as untrusted.

## 1. Security Goals

The Tribunal must protect:

- OpenRouter credentials and credits
- privileged database credentials
- internal execution controls
- integrity of verdict/protocol/economics records
- availability against trivial cost abuse
- users from deceptive failure states
- public-demo users from misunderstanding data retention/privacy

V1 is **not** a private case-management system. It has no accounts or per-user private storage boundary.

---

## 2. Trust Boundaries

```text
UNTRUSTED
- Browser/client state
- Charge Sheet text
- Personality text
- Uploaded .txt/.md bytes
- Model output
- External API responses until validated

TRUSTED APPLICATION BOUNDARY
- Netlify server-side functions
- Background worker logic
- Server-side validation/economics/orchestration

DURABLE DEFENSE IN DEPTH
- PostgreSQL constraints/uniqueness/transactions
```

A fluent LLM response is not trusted simply because it looks correct.

---

## 3. Secrets

Required server-side secrets are expected to include names such as:

```text
OPENROUTER_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY   # or current equivalent privileged server key
INTERNAL_FUNCTION_SECRET
```

Rules:

- never commit real secret values
- `.env.example` contains names/placeholders only
- never place privileged secrets in `VITE_*` variables or other browser-exposed configuration
- never print secrets in logs, errors, screenshots, fixtures, or test snapshots
- never send server secrets to the model
- production secrets live in deployment-provider secret/environment settings

If a secret is ever committed or publicly exposed, treat it as compromised and **rotate it immediately**. Deleting it from the latest file is insufficient because Git history preserves prior versions.

---

### 3.1 Operator metadata credential vs. user runtime inference credential (corrected this pass — product/economics decision)

**The developer/operator must spend $0 on runtime model inference and must not fund production users.** `OPENROUTER_API_KEY` above is retained, but its scope is narrowed:

- **Operator metadata credential** (`OPENROUTER_API_KEY`, server env var, unchanged): acceptable for zero-cost metadata/model-discovery/preflight requests only — `POST /api/setup-extractions/preflight` and, in this pass, the paid endpoints' own internal eligibility re-check (both make zero `createChatCompletion` calls). Still never exposed to the browser, still never sent to the model, still `verify-client-bundle.mjs`'s forbidden-identifier check.
- **User runtime inference credential** (new: header `X-User-OpenRouter-Key`): required by every endpoint capable of calling `createChatCompletion` — `POST /api/setup-extractions`, `POST /api/setup-extractions/{id}/retry` (M7A), and, as of **M8**, `POST /api/runs` (forwards it server-to-server, never persisted, to trigger the Tribunal Background Function) and the Background Function itself (`netlify/functions/tribunal-execute-background.ts`, protected by a separate `X-Internal-Function-Secret` the browser never receives — see §12 below). Absent → `OPENROUTER_NOT_CONNECTED`, zero claim, zero persistence, zero spend. **Never** falls back to `OPENROUTER_API_KEY`/`process.env` — none of these code paths read the operator credential at all. Unlike M7A's paid endpoints, M8's worker uses the user's own credential even for its own execution-time metadata re-check (`netlify/server/tribunal/execution.ts`), since every OpenRouter call it makes is on the direct path to a possible paid completion.
- The user's credential is:
  - held **only** in the browser tab's `sessionStorage` — never `localStorage`, never a cookie, never sent to Supabase, never written to any table or audit row;
  - never logged (no `console.log`/error message ever includes it);
  - never placed in a URL or query parameter — attached exclusively as an HTTP header on the two completion-capable requests;
  - never echoed back in any server response;
  - cleared by an explicit user "Disconnect" action or when the browser tab session ends.
- This is a **payment/inference-authorization boundary**, not an authentication system — it introduces no login, no Supabase user table, no private per-user ownership. §18/§1 above ("V1 has no accounts") is unchanged.
- V1 ships a minimal "paste your key" mechanism. The documented upgrade path is OpenRouter's own OAuth + PKCE flow (`openrouter.ai/docs/use-cases/oauth-pkce`), which reuses the same per-request-header, never-persisted-server-side architecture — only how the key first reaches the browser changes. Not implemented in this pass.
- Full detail: `docs/economics.md` Sec 22.1; the request-level contract: `netlify/server/extraction/userOpenRouterKey.ts` / `src/services/openRouterCredential.ts`.

### 3.1.1 The canonical Jon Snow demo — a narrow, explicit exception (Milestone 12, human product override)

**The "operator spends $0" rule above is deliberately, narrowly overridden for exactly one surface: the canonical Jon Snow lecturer demo.** Every other completion-capable endpoint — generic `POST /api/runs`, `POST /api/setup-extractions` and its retry, and Smart Import generally — is completely unaffected and keeps requiring the connected user's own credential exactly as described above and in `docs/economics.md` Sec 22.1.

- **A dedicated operator credential, server-only:** `JON_SNOW_DEMO_OPENROUTER_API_KEY` (distinct env var from `OPENROUTER_API_KEY`) funds ONLY `POST /api/demo/jon-snow/runs` (`netlify/server/tribunal/jonSnowDemoRun.ts`). It is read only by that one endpoint, forwarded into the exact same `triggerExecutionIfEligible` every other Tribunal run already uses, and is never returned to the browser, logged, or committed — `scripts/verify-client-bundle.mjs` treats it (and the access token below) as forbidden client-bundle identifiers, same as `OPENROUTER_API_KEY`.
- **Canonical-only, never a general-purpose paid endpoint:** the client can influence exactly two fields — `modelId` and `clientRequestId`. Defendant/Act/Exact Question, every participant profile/personality/seat mapping, and execution mode (always `SHARED`) are constructed server-side from the same isomorphic preset the Modify-settings page reads (`src/features/jon-snow-demo/canonicalPreset.ts`) — never accepted from the request body. This is not a way to run an arbitrary Tribunal on the operator's credit.
- **A strictly lower, additional cost ceiling:** the selected model's current conservative full-Tribunal discovery estimate must be at or below `JON_SNOW_DEMO_MAX_ESTIMATE_USD` ($0.13, `src/features/jon-snow-demo/jonSnowDemoEconomics.ts`), re-verified server-side against the live catalog on every request — never trusted from the client. This sits underneath, not instead of, the existing $5.00 generic hard ceiling, which is completely unchanged.
- **Public-spend protection — a revocable access capability, not an OpenRouter credential:** a second, unrelated server secret, `JON_SNOW_DEMO_ACCESS_TOKEN` (required minimum 32 characters — a short/weak value cannot be configured, `netlify/server/env.ts`), gates who may invoke the endpoint at all, checked (constant-time comparison, `netlify/server/tribunal/demoAccess.ts`) against the request's `X-Jon-Snow-Demo-Access` header before any case/run/provider work happens. Missing/invalid access token → `401 demo_access_denied`; missing/invalid server configuration (either secret absent or malformed) → `503 demo_not_configured` — these are two distinguishable responses, not an intentionally indistinguishable pair. The guarantee that matters, and holds in both cases: zero case/run creation, zero OpenRouter completion/spend. The lecturer never sees or types this token — it is carried in a prepared presentation link's URL **fragment** (never sent to any server automatically), captured once client-side into `sessionStorage`, and immediately stripped from the visible URL/history (`src/services/jonSnowDemoAccess.ts`).
- **Authoritative demo cost ceiling, checked twice:** the $0.13 ceiling (`JON_SNOW_DEMO_MAX_ESTIMATE_USD`) is enforced at two points, only the second of which is authoritative. First, an early rejection against `listEligibleModels()` discovery metadata, which can be stale for up to the shared metadata cache's TTL — useful UX, not the real gate. Second, and authoritatively, `triggerExecutionIfEligible`'s optional `additionalMaxCostUsd` parameter (`netlify/server/tribunal/triggerExecution.ts`) re-checks the ceiling against the SAME fresh `runPreflight()` result already computed with the real demo credential, immediately before the one worker invocation — so a price change during the metadata cache's TTL can never let an over-ceiling model reach a real completion. Generic `/api/runs` never sets this parameter and is completely unaffected; the existing $5.00 ceiling (enforced inside `runPreflight` itself) remains its only cost gate.
- **No BYOK UI on this surface:** the Modify-settings page (`/demo/jon-snow`) has no `OpenRouterConnect` component and no credential field at all — the demo is operator-funded, so there is nothing for the lecturer to connect.
- **No cross-contamination, either direction:** generic `/api/runs` has no code path that reads `JON_SNOW_DEMO_OPENROUTER_API_KEY` — it cannot become a fallback for an unconnected normal user. Conversely, the dedicated demo endpoint never reads or accepts a user-supplied `X-User-OpenRouter-Key`.

---

## 4. Browser / Database Boundary

V1 browser code does not directly access Supabase data.

Netlify functions are the application API. They use the privileged Supabase credential server-side.

Supabase/PostgreSQL should still use least privilege and RLS/permissions as defense in depth. Because V1 has no user authentication, no public anon policy is required for application data.

The service-role/secret credential must never enter a browser bundle.

---

## 5. OpenRouter Boundary

All OpenRouter requests occur server-side.

The browser receives only sanitized model metadata required for selection, not the API key or provider-internal credentials.

OpenRouter calls must use:

- explicit selected model
- required structured-output parameters
- provider parameter support enforcement
- no silent automatic fallback that changes cost/audit assumptions
- bounded output tokens
- bounded application timeout
- budget guard before an attempt

The model receives no privileged tools, arbitrary backend actions, database credentials, or deployment capabilities in V1.

Milestone 7 introduces the one server-side `OpenRouterProvider`
abstraction and its fakeable boundary; normal automated tests inject a
deterministic fake and never reach the real OpenRouter network — see
`docs/adr/0003-openrouter-infrastructure.md`.

The price authoritative preflight accepts must correspond to the exact
model and provider endpoint a later execution attempt is restricted to —
`provider.order` pinned to that endpoint's real routing tag (the
primary mechanism, matching OpenRouter's own documented exact-endpoint-
pin example), `provider.only` set to the same tag as an additional
restriction, `allow_fallbacks: false` — never a different, cheaper, or
otherwise unverified endpoint. A bare `provider.only` restriction is
**not** by itself sufficient proof of an exact pin: OpenRouter provider
routing slugs have base-slug-matches-multiple-variants semantics, so a
candidate endpoint's routing tag must first be proven to identify
exactly one endpoint (`isUniquelyPinnable`,
`docs/adr/0003-openrouter-infrastructure.md` Decision 4A) before
preflight ever accepts it — an endpoint that cannot be proven uniquely
pinnable is never eligible, regardless of price. A configured model that
OpenRouter documents as a dynamic/non-deterministic construct (its Auto
Router, or a "latest"-style alias whose executed model can move over
time) is blocked explicitly, never silently substituted or treated as a
fixed auditable model. Model catalog/endpoint metadata past its
authoritative freshness window is treated as unavailable, never used to
authorize spend. Endpoint pricing carrying a non-empty conditional
`pricing.overrides` array is treated as unrepresentable and blocks
eligibility (Decision 7A) — the top-level price alone is not trusted as
an upper bound when a condition could select a different price at
request time; a `pricing.discount` is never relied upon to justify a
cheaper tier or FREE classification, since preflight always prices the
undiscounted base rate, and a malformed `discount` (negative, `>1`, or
non-finite) blocks eligibility rather than being silently treated as
`0`.

Preflight's input-cost bound is **cache-write aware** (Decision 7B): a
prior planning pass assumed provider prompt-caching behavior could only
ever reduce realized spend — this was false and is retracted. OpenRouter
endpoint pricing exposes a genuine cache-**write** rate
(`input_cache_write`) that provider documentation confirms can cost
*more* than ordinary input (e.g. Anthropic's 1.25x/2x TTL multipliers,
OpenAI's 1.25x for its GPT-5.6+ family, triggerable with no request-side
opt-in). Preflight therefore computes `effectiveInputPricePerToken =
MAX(promptPricePerToken, cacheReadPricePerToken,
cacheWritePricePerToken)` and uses it — never the raw prompt rate
alone — everywhere input cost is estimated, including the retry reserve,
which never assumes a warm cache or a cache discount. Only the
separately-priced `input_cache_write_1h` is excluded, and only because
the Tribunal request contract provably cannot trigger it (it never sends
the explicit 1-hour cache-control field that rate requires).

The one mandatory live OpenRouter integration check required before
Milestone 7 merges (`docs/adr/0003-openrouter-infrastructure.md`
Decision 19) is metadata-only: it performs zero model inference, sends no
Charge Sheet/personality/case content, and its evidence record contains
no secret value.

---

## 6. Prompt Injection and Instruction Hierarchy

Charge Sheet and personality text are intentionally sent to models, so prompt injection cannot be “sanitized away” like ordinary malformed form data.

Defense is architectural:

1. fixed server-owned base role instructions
2. explicit participant role and side
3. strict system-owned output schema
4. user content clearly delimited/labeled as data/context
5. system instruction that embedded content cannot alter role/side/schema/security policy
6. no privileged tools available to the runtime model
7. server-side schema validation after the model responds

A personality may influence style and reasoning but may not legitimately change:

- participant identity
- PRO/CON side
- judge role
- verdict vocabulary
- JSON contract
- retry/cost/security controls

Prompt injection may still influence argument content because that content is itself part of the deliberation. V1 therefore does not claim semantic immunity from adversarial case text; it claims containment of privileged effects.

---

## 7. Model Output Validation

Never treat raw model text as valid application data.

Advocates and judges use strict structured output plus independent server validation.

Forbidden behaviours:

- regex guessing of verdict from prose
- defaulting parse failure to `NOT_GUILTY`
- defaulting parse failure to `GUILTY`
- trusting model-generated IDs or prices
- rendering model HTML as trusted markup

Malformed output is a failed attempt and follows the retry policy.

---

## 8. Safe Rendering / XSS

Charge Sheet, personality text, speeches, and reasoning may contain hostile strings.

UI rules:

- render as plain escaped text by default
- do not use `dangerouslySetInnerHTML` for user/model content
- do not interpret model/user content as executable HTML
- if Markdown rendering is ever added, use a deliberately configured sanitizer and treat that as a security-sensitive change
- preserve line breaks using safe text/CSS rather than raw HTML injection where practical

Links supplied by model/user text should not automatically become trusted navigation/action links without explicit design.

---

## 9. File Upload Security

V1 accepts only text-based imports.

### Charge Sheet

- `.txt`, `.md`
- max 64 KiB
- UTF-8
- deterministic parser

### Personality

- `.txt`, `.md`
- max 16 KiB
- UTF-8
- normalized text max 4000 characters

### Full Tribunal Package

- `.txt`, `.md`
- max 192 KiB
- UTF-8
- strict `TRIBUNAL_PACKAGE_V1` structure
- fixed participant seats only
- no model/provider/execution/prompt/pricing/budget fields

### Smart Import Dossier (Milestone 7A)

Full contract: `docs/adr/0004-smart-package-extraction.md`.

- `.txt`, `.md` — max 256 KiB raw
- `.pdf` — max 4 MiB raw (`SMART_EXTRACTION_PDF_MAX_RAW_BYTES`),
  text-layer extraction only, no OCR
- normalized text max 40,000 characters after decode/extraction
  (`NORMALIZED_DOSSIER_TEXT_MAX_CHARS`), regardless of source
- UTF-8
- free-form prose — no marker/section structure required, unlike the
  Full Tribunal Package above
- fixed participant seats only; no model/provider/execution/prompt/
  pricing/budget fields (identical rule to the Full Tribunal Package,
  enforced by the extraction schema's closed shape rather than a
  deterministic parser)
- the base64-encoded request body (raw file + JSON envelope) stays
  under Netlify's documented 6 MB buffered-payload limit with real
  headroom

Validate server-side:

- extension / intended content type
- byte size before expensive processing
- UTF-8 decoding
- required markers/structure for Charge Sheet
- required header/sections/fields for Tribunal Package
- normalized content limits
- unsupported structural fields
- malicious/path-like filenames before storing source metadata

Do not execute uploaded content.

Raw file bytes are transient and should not be stored in V1 after successful normalization.

Strict Tribunal Package import is atomic. Invalid package content must not leave the browser setup partially overwritten.

Milestone 7A Smart Tribunal Package Extraction uses exactly one
setup-time model call, planned in `docs/adr/0004-smart-package-extraction.md`.
That call is not a Tribunal participant, receives no privileged tools
(the provider request shape has no `tools` field at all), must use
strict structured output validated server-side before trust, and must
never automatically convene the Tribunal — its output only ever
populates a staged review preview.

Additional M7A-specific security requirements (full detail in the ADR,
Decision 17):

- The uploaded dossier is untrusted prompt content: it is delimited and
  labeled as data, any instruction-like text inside it is explicitly
  ignored by the extraction prompt, and no code path executes or
  evaluates extracted text.
- PDF text extraction is server-only, text-layer-only (no rendering, no
  canvas, no embedded-JavaScript execution) — no OCR, no cloud document
  parser.
- PDF extraction (and every other pre-provider processing step) obeys a
  single enforced handler-wide soft deadline
  (`PACKAGE_EXTRACTION_HANDLER_SOFT_DEADLINE_MS`, `docs/adr/
  0004-smart-package-extraction.md` Decision 8) — no deterministic
  pre-work step can consume the entire Function lifetime, and no
  provider call (hence no spend) is ever attempted once that deadline
  is exhausted.
- **New this pass (final independent review, prompt-version resolution
  audit): a retry's stored prompt version must resolve to an
  immutable, versioned historical prompt implementation before any
  provider call is attempted** (`docs/adr/
  0004-smart-package-extraction.md` Decision 7). A released prompt
  version's text/behavior is never modified in place — a behavioral
  change is a new version, added additively, never overwriting the old
  one — so a retry always sends the exact same prompt the original
  attempt would have sent, regardless of any prompt change deployed in
  between. If the stored version cannot be resolved (`PROMPT_VERSION_
  UNAVAILABLE`, Decision 16), the request fails closed: zero provider
  calls, zero new spend, no fallback to the current prompt, no silent
  version substitution.
- Raw upload bytes and the normalized dossier *source* text are both
  transient and are not retained after any extraction attempt
  (successful, failed, or between an initial attempt and a subsequent
  retry — a retry resends the same dossier content, since the server
  never stores it in between); only bounded structured audit
  telemetry, plus a one-way semantic fingerprint of the normalized
  content (never the content itself), persists.
- **Corrected in an earlier pass (final independent review, `docs/adr/
  0004-smart-package-extraction.md` Decisions 13/15): the one bounded
  exception to the above is the validated extraction *result*, not the
  source dossier.** After a successful extraction passes strict
  server-side schema validation (Decision 5), the validated,
  schema-shaped result — the same seven-seat/charge-sheet structure the
  UI would otherwise show — is persisted as `validated_result` on that
  attempt's audit row, so a lost HTTP response (a dropped connection
  between the server and the browser) can be recovered by an idempotent
  replay without a second paid provider call. This is categorically
  different from source retention: it is never the raw dossier, never
  the raw provider response, bounded by the same schema/size limits as
  the live extraction output, re-validated on every read, and reachable
  only through **the same server-authoritative, fingerprint-gated
  idempotent-replay API path used by the extraction request** — it does
  not reopen "the dossier is retained" in any form.
- **Corrected this pass (final independent review, security/idempotency
  audit): the phrase "authenticated idempotent-replay path" used in an
  earlier revision of this section was false and has been removed.**
  V1 has no accounts or login at all (`SPEC.md` §18: "V1 is a
  single-tenant educational/demo application. It does not require
  accounts or login."; §15 above: "V1 is deliberately single-tenant and
  has no user accounts."). The idempotent-replay path's actual
  protection is **not** authentication or per-user ownership — it is
  that a replay request must present the same `extractionRequestId` and
  the server must independently recompute a matching semantic
  fingerprint (Decision 15) before any persisted `validated_result` is
  returned; a mismatched fingerprint is rejected regardless of who
  sends the request. **This must never be described or implied as
  private per-user data, logged-in ownership, or authentication that
  does not exist** — see §15's disclosure rules, extended below for
  `validated_result` specifically.
- Dossier content (raw or normalized) must never appear in server logs.
- The existing public-demo-data privacy notice (do not submit
  sensitive/private information) must also be shown before dossier
  upload/paste, not only before Charge Sheet entry. **Corrected this
  pass: that notice must say more than "do not submit sensitive data"
  for Smart Import specifically — see §15 below, which now locks the
  exact four disclosures required (raw dossier not retained; the
  validated result may be retained even before Apply/Convene; no
  private per-user ownership guarantee in V1; do not submit sensitive
  data).**
- No malware/antivirus content scanning exists for uploaded files in
  V1; file safety relies solely on type/size/structural validation.
- Human review is part of the security boundary: extraction output
  cannot itself trigger persistence of a real case, a run, or any
  further model call.

---

## 10. Cost-Abuse Controls

A public endpoint that can trigger seven model calls is a financial attack surface.

Required controls:

- `$5` per-run hard intentional-spend policy
- conservative server-side preflight
- server-side runtime budget guard before each provider attempt
- output-token caps
- one retry max per participant
- no silent paid fallback
- eligible-model filtering
- idempotent run start
- atomic background-worker claim
- rate limiting for cost-bearing start requests

**Implemented (Milestone 13, Issue #36 G3):**

```text
POST /api/runs
3 accepted start attempts per 180 seconds per source IP
```

Enforced via the SAME authoritative, cross-process-safe admission-control RPC (`check_and_record_admission`) Milestone 7A's extraction endpoints already use — `netlify/server/admissionControl.ts`, bucket `"run-start"`, reusing the existing `setup_extraction_admission_events` table/RPC with no migration. `hashedAdmissionBucket`/`trustedSourceIp` (`netlify/server/extraction/rateLimit.ts`) provide the same privacy-conscious, never-caller-supplied-header source-IP resolution the extraction endpoints already established. A same-`clientRequestId` idempotent retry never consumes a second admission slot (the RPC's own `(bucket, requestId)` dedup) — a legitimate retry is never penalized.

**Also implemented (Milestone 13, Issue #36 G3): the operator-funded Jon Snow demo endpoint** (`POST /api/demo/jon-snow/runs`) carries its own, independent admission-control check — bucket `"jon-snow-demo-start"`, never sharing capacity with the generic `"run-start"` bucket — reached only after the access-capability gate (Sec 3.1.1) already passed, so an invalid-token flood never consumes a slot at all. Its threshold (`JON_SNOW_DEMO_RUN_START_RATE_LIMIT`, `netlify/server/tribunal/rateLimitPolicy.ts`) is deliberately a slightly higher ceiling than the generic policy (5/180s vs. 3/180s) — a presentation-safety allowance for a live lecture demo, justified by that surface's much lower per-run cost ceiling ($0.13 vs. the generic $5.00 hard ceiling), never an unlimited exemption. This is what stops a leaked/shared demo access capability from permitting unbounded fresh `clientRequestId`s from one source.

This is a starting operational control, not a promise of abuse-proof identity — per-IP/per-capability admission control is not DDoS-proof authentication (Sec 20). It may be tuned from observed demo usage.

Read-only history/status endpoints can use looser limits.

If public abuse becomes material, the next escalation is not to weaken the budget guard; it is to add stronger admission/authentication controls through an approved scope change. The production deployment environment around this control (Netlify edge/WAF rate limiting, if adopted, HTTPS, real-traffic threshold tuning) remains Milestone 15 scope, not duplicated or pulled forward here.

**New this pass (final independent review, security/idempotency audit
— Milestone 7A, `docs/adr/0004-smart-package-extraction.md` Decision
19): Smart Tribunal Package Extraction introduces a second public,
cost-bearing action.** `EXTRACTION_HARD_CEILING_USD` bounds a single
*logical* extraction call, but does not by itself bound how many fresh
logical extractions a single source can start — an attacker who mints
a new `extractionRequestId` per request is not stopped by the
per-call ceiling alone. A dedicated admission-control policy is
therefore locked, deliberately aligned with the existing
`POST /api/runs` target above:

```text
POST /api/setup-extractions   (new logical extraction starts only)
3 accepted NEW logical extraction starts per 180 seconds per source IP
```

Exact semantics, locked:

- **Only a genuinely new logical extraction (a fresh
  `extractionRequestId` with no prior matching-fingerprint record)
  counts against this limit.** An idempotent replay of an
  already-existing `extractionRequestId` (Decision 15's replay table)
  does **not** consume a new admission slot and does **not** trigger a
  new provider call — the whole reason idempotent replay exists is to
  make repeated identical requests cheap and safe, and the rate limit
  must not undermine that by penalizing a legitimate replay.
- **Every admitted logical extraction remains independently bounded**
  by `EXTRACTION_HARD_CEILING_USD` and the existing maximum-2-attempts
  rule — the rate limit is an additional, orthogonal admission control,
  never a replacement for the per-call budget guard.
- **Rejection happens before any atomic attempt claim** — see the
  `RATE_LIMITED` semantics below.
- **`POST /api/setup-extractions/{extractionRequestId}/retry`** is a
  request against an *existing* logical extraction, not a new one — it
  is bounded by that extraction's own maximum-2-attempts/budget rules
  regardless of how many times it is called (a duplicate retry request
  against an already-`CLAIMED`-or-terminal attempt makes zero new
  provider calls, Decision 15). It nonetheless **must be operationally
  rate-limited** as a resource-exhaustion control (repeated retry
  requests still cost server compute and, while not billable per call,
  should not be admitted unbounded); its exact looser threshold is an
  implementation-time tuning detail, but the requirement that it is
  rate-limited is locked now, not left open.
- **`POST /api/setup-extractions/preflight`** performs zero
  `createChatCompletion` calls and is non-billable, but it performs
  potentially expensive deterministic work (PDF text extraction,
  OpenRouter model/endpoint metadata and pricing resolution) and is
  therefore **also required to carry a bounded operational/resource
  rate limit**, distinct from — and permitted to be looser than — the
  billable-start limit above. Its exact threshold is an
  implementation-time detail; the requirement itself is locked now.
- Read-only history/status endpoints for extraction attempts (if any
  are added) may use the same looser class of limit the existing
  read-only run endpoints already use, per the general rule above.

---

## 11. Idempotency and Duplicate Execution

Duplicate execution is both an integrity and cost vulnerability.

### Start endpoint

A client-generated `client_request_id` must be unique at the database level. A repeated request returns the already-created run instead of starting another paid run.

### Background worker

The worker atomically claims only an eligible unclaimed run. Duplicate background invocation exits before calling OpenRouter.

Do not rely on the browser disabling a button as the duplicate-spend control.

---

## 12. Internal Background Endpoint

The Background Function is internal orchestration infrastructure.

Require:

- POST only
- server-generated/internal invocation
- `INTERNAL_FUNCTION_SECRET` or equivalent proof
- run ID validation
- atomic run claim

Do not expose the internal secret or embed it in frontend source.

A guessed run ID alone must not be enough to invoke paid work.

**Implemented in M8** (`netlify/functions/tribunal-execute-background.ts`):
authenticates `X-Internal-Function-Secret` via a constant-time comparison
(`netlify/server/tribunal/internalSecret.ts`) before any other work —
before parsing the body, before reading the user credential, before any
database access. A missing/misconfigured server secret fails closed
(zero execution), never falls open. The only caller is `POST /api/runs`
(`netlify/server/tribunal/triggerExecution.ts`), which holds the secret
server-side only and forwards it in one server-to-server request; the
browser never receives it, matching the "no lease/queue" P0 requirement
— a genuinely unexpected exception is caught last-resort and never
escapes, but no retry/recovery system was built for a catastrophic
mid-execution process death (documented limitation, `ARCHITECTURE.md`
§7.4).

---

## 13. Error Handling and Information Disclosure

User-visible errors should be useful but not leak infrastructure details.

Expose safe categories such as:

- input invalid
- budget blocked
- provider unavailable
- participant timed out
- participant returned invalid output
- run failed
- database persistence error (`DATABASE_ERROR` — Milestone 13, Issue #36 G1a/G1b: a `TribunalPersistenceError` thrown by a repository write during execution, either inside a logical call, claim/terminalize/persist stage-aware, or at the phase level (`transitionToJudges`/`completeRun`/`failRun` itself) — never conflated with a participant-earned terminal-failure code, and never leaking the underlying Supabase/Postgres error detail. A genuinely unexpected, non-persistence exception gets its own distinct code (`UNEXPECTED_LOGICAL_CALL_ERROR`/`UNEXPECTED_EXECUTION_ERROR`) — never mislabeled `DATABASE_ERROR`. **Deliberately does NOT cover the pre-claim path** (`runLoader.getById`, `runPreflight`'s own reads, `blockBudget`/`claimForExecution` themselves) — a read failure there leaves the run provably still `READY` (zero spend, naturally retriable), and `blockBudget`/`claimForExecution` are themselves ambiguous atomic writes where a blind recovery attempt risks falsely failing a run a different, legitimate invocation actually won and is actively executing; see `netlify/server/tribunal/execution.ts`'s own comment directly above `executeTribunalRun` for the full analysis. No migration required or proposed for this path.)

Server logs may contain technical error codes/stack traces, but should avoid:

- secrets
- Authorization headers
- full raw prompts unless explicitly needed for controlled debugging
- unnecessary case/personality content

Store a safe failure message/category in the database, not an unfiltered external/provider error payload.

---

## 14. Logging and Privacy

Prefer metadata-rich, content-light logs.

Useful logs:

- run ID
- participant key
- attempt number
- status
- duration
- model ID
- token/cost metadata
- normalized error category

Avoid logging full:

- Charge Sheets
- personalities
- assembled prompts
- model responses

Those contents already exist in necessary application persistence where specified; duplicating them into infrastructure logs increases exposure without much diagnostic value.

---

## 15. Public Demo Data Retention

V1 is deliberately single-tenant and has no user accounts.

Therefore:

- stored cases may be visible in public/demo history
- UI must disclose retention/visibility before run start
- UI must warn: **Do not submit sensitive, private, confidential, or personally identifying case material**
- the app must not imply private storage

If private per-user cases become required, that is a product/security architecture change requiring authentication, authorization, database policy changes, and new tests before implementation.

**Corrected this pass (final independent review, security/idempotency
audit) — Smart Import (Milestone 7A) privacy disclosure, locked:** the
same "no private per-user ownership" rule above applies to
`validated_result` (`docs/adr/0004-smart-package-extraction.md`
Decisions 13/15) exactly as it applies to any other stored V1 data —
retaining it for idempotent recovery is not, and must never be
presented as, private storage. The Smart Import privacy notice shown
before dossier upload/paste (§9 above) must explicitly disclose all
four of the following, not merely "do not submit sensitive data":

1. The raw uploaded dossier and its normalized source text are **not
   retained** past the extraction attempt that processed them.
2. The **validated, structured extraction result** produced from that
   dossier **may be retained** (bounded, schema-shaped, server-side) to
   support idempotent recovery and audit — **even if the user has not
   yet pressed "Apply extracted draft" or convened the Tribunal.** The
   result being retained is not conditional on the user finishing the
   flow.
3. **V1 has no private per-user ownership guarantee** for this retained
   result, identical to every other V1 stored artifact — it is not
   made private merely because the raw dossier itself is discarded.
4. Users must not submit sensitive, private, confidential, or
   personally identifying material in the dossier, exactly as the
   existing Charge Sheet notice already requires.

Retaining the validated result must never be characterized as private
or safe-by-default merely because the input path (source dossier) is
discarded — retention-scope and privacy-scope are two different
properties, and this document does not conflate them.

---

## 16. Data Integrity

Use database constraints and transactional updates where possible for:

- unique run idempotency key
- one participant key per run
- attempt number uniqueness
- judge verdict vocabulary
- one final speech/verdict per participant
- one protocol per run

Once a run begins, participant/model/prompt configuration is frozen.

Milestone 6 enforces this immutability structurally, not only
procedurally, and goes one step further than the Milestone 5 `cases`
pattern: `service_role` is granted **`SELECT` only** on `tribunal_runs`
and `participant_configs` — no `INSERT`, `UPDATE`, or `DELETE` grant at
all. No application-facing role (`service_role`, `anon`, `authenticated`,
`PUBLIC`) receives direct write authority on either table. The only way
either table is ever written is through one narrowly scoped `SECURITY
DEFINER` Postgres function (`SET search_path = ''`, every referenced
object schema-qualified, no dynamic SQL, no user-controlled identifiers,
`role`/`side`/`prompt_version` derived internally rather than
caller-supplied), whose `EXECUTE` privilege is explicitly revoked from
`PUBLIC`/`anon`/`authenticated` and granted only to `service_role` in the
same migration that creates it. The function necessarily runs with its
*owner's* privileges (that is what `SECURITY DEFINER` means) — an
administrative/ownership authority that is never itself an application
call path, since no server or browser code ever authenticates as the
function owner. That function independently re-validates exactly seven
known participant keys and performs the idempotency-fingerprint check
atomically with the insert (see
`docs/adr/0002-participant-configuration-freeze.md` Decisions 6 and 11) —
a same-key/different-payload retry is rejected with
`409 idempotency_conflict`, never silently merged into or replacing the
original. There is no application call path, authorized or not, that can
insert a partial configuration or alter an accepted run, because
`service_role` — the only role application/server code ever authenticates
as — cannot perform an ordinary `INSERT`/`UPDATE`/`DELETE` statement
against either table regardless of what the application code attempts —
only the one function can, and only for a complete seven-participant set.
RLS is enabled on both tables with no anon/authenticated policy, matching
the Milestone 5 `cases` pattern.

Case persistence remains the independent Milestone 5 entity boundary: if
Convene needs to create a case, that happens as an ordinary, separately
atomic insert immediately before the run/config freeze, not inside the
same transaction. That insert is itself idempotent — a `kind: "new"`
Convene request is keyed by a nullable, uniquely-constrained
`cases.convene_request_id` column, so a lost-response retry safely reuses
the same case row instead of creating a second one, and a genuinely
different request reusing the same key is rejected with
`409 idempotency_conflict` rather than silently attaching to the wrong
case (ADR Decision 9). `convene_request_id` is never exposed in an M5
public API response. If the subsequent run/config freeze fails after case
resolution, the resolved case may remain persisted — it is a legitimately
valid, independently persistable case, not a partial or orphaned record.

Completed historical outputs/economics/protocol are immutable through normal V1 APIs.

Never accept browser-supplied token/cost/majority values as authoritative.

---

## 17. Dependency Security

When the application stack exists:

- keep dependency count proportional to value
- pin via lockfile
- review new runtime dependencies before adding
- run dependency audit in CI/final hardening
- do not blindly force-upgrade through breaking/security findings without triage
- remove unused dependencies

High-risk or opaque packages that process untrusted content require explicit justification.

### 17.1 First recorded audit (Milestone 13, Issue #36 dependency/supply-chain slice)

`npm audit` (read-only; `npm audit fix`/`--force` deliberately **not** run) reports **8 advisories: 1 moderate, 7 high**, as of this milestone. Every one traces back to exactly one direct dependency: `netlify-cli` (`package.json` `devDependencies`, `^27.3.0`) and its transitive tree (`@netlify/dev` → `extract-zip`; `@netlify/dev` → `@netlify/images` → `ipx` → `sharp`; `qs`, moderate, transitively via `netlify-cli`'s own dependencies).

- **No deployed application-runtime exposure identified** — confirmed by `netlify-cli`'s `devDependency` placement and the existing client-bundle verification (`scripts/verify-client-bundle.mjs`); nothing in this advisory chain ships to the browser or to the deployed Netlify Functions runtime.
- **Dev/CI-toolchain exposure remains** — `netlify-cli`'s dependency tree (including the vulnerable `extract-zip`, `qs`, `sharp`/`ipx` paths) is genuinely present and executable wherever `netlify-cli` itself runs: local `npm run dev:netlify` invocations, and this repository's own CI `npm ci` step (which installs devDependencies).
- **No safe forward fix is currently offered by npm** — the only fix path `npm audit` reports for every `netlify-cli`-rooted advisory is `netlify-cli@23.13.5`, a 4-major-version **downgrade** from the currently pinned `^27.3.0`, not an upgrade. This is **not accepted** — downgrading four major versions of the local dev/deploy CLI risks losing a year of fixes/features for a dev-only, no-deployed-exposure risk.
- **Disposition: accepted/deferred**, evidence-based, not silently ignored. Revisit when `netlify-cli` publishes a forward (v28+) release that resolves these transitively, or when Netlify patches `@netlify/images`/`ipx`/`sharp` forward without requiring a `netlify-cli` downgrade.
- **Install-script warning, recorded and left open, not silently treated as resolved:** `npm install`/`npm ci` reports `5 packages have install scripts not yet covered by allowScripts` (`esbuild`, `fsevents`, `netlify-cli`, `sharp`, `unix-dgram`). No project-level `allowScripts`/lavamoat policy file exists in this repository today. This does **not** block `npm ci` in CI — status: **open, pending**, not addressed by this milestone. A future pass should either adopt an explicit install-script allowlist policy or make a documented, evidence-based decision not to.

---

## 18. Git and Repository Security

- never commit `.env` or secret-bearing local files
- commit `.env.example` placeholders only
- use PRs for meaningful changes
- enable automated secret scanning/pre-commit/CI controls when the application foundation is created
- protect `main` once CI exists
- prompt changes are reviewable code changes

A secret found in Git history must be rotated even if the repository later becomes private.

---

## 19. Security Verification Checklist

Before relevant milestones merge, verify as applicable:

- [ ] no secret values in Git diff/history being introduced
- [ ] browser bundle contains no privileged keys
- [ ] server repeats authoritative validation
- [ ] upload type/size/UTF-8 validation tested
- [ ] malicious HTML renders as text, not executable markup
- [ ] malformed model JSON rejected
- [ ] verdict cannot be guessed from prose
- [ ] prompt-injection-like personality cannot change participant side/schema
- [ ] model has no privileged arbitrary tools
- [ ] cost preflight blocks unsafe configuration
- [ ] retry guard includes budget check
- [ ] duplicate run start is idempotent
- [ ] duplicate worker invocation performs no duplicate calls
- [ ] rate limiting is configured before public production use
- [ ] safe failure categories do not leak secrets
- [ ] logs avoid unnecessary full case/prompt content
- [ ] public-history privacy warning is visible
- [ ] (Milestone 7) `OPENROUTER_API_KEY` absent from client bundle
      (`scripts/verify-client-bundle.mjs`, already includes this
      identifier — confirmed, not a new check)
- [ ] (Milestone 7) no automated test makes a real OpenRouter network
      request; every model/pricing/preflight path is exercised through an
      injectable fake provider
- [ ] (Milestone 7) an ineligible/unresolvable model blocks explicitly
      with a reason code — no silent substitution, no silent paid fallback
- [ ] (Milestone 7) a stale (past-TTL) or unavailable model catalog cache
      never authorizes preflight eligibility — treated as unavailable, not
      silently served
- [ ] (Milestone 7) a run frozen with the pre-Milestone-7 `prompt_version`
      placeholder (`unassigned-pre-m7`) is never reported execution-eligible
- [ ] (Milestone 7) preflight prices the exact provider endpoint a future
      execution attempt would be pinned to, never a model-level average
      or a different endpoint
- [ ] (Milestone 7) an endpoint whose routing tag cannot be proven to
      identify exactly one endpoint (a base provider slug matching
      multiple variants) is blocked (`ENDPOINT_NOT_PINNABLE`), never
      treated as pinned just because `provider.only` names it
- [ ] (Milestone 7) a candidate endpoint with a non-empty conditional
      `pricing.overrides` array blocks eligibility
      (`PRICING_UNREPRESENTABLE`) rather than being priced from its
      top-level default-conditions price alone
- [ ] (Milestone 7) `pricing.discount` is never relied upon to justify a
      cheaper tier or a `FREE` classification; tier/eligibility always
      use the undiscounted base rate; a malformed `discount` (negative,
      `>1`, non-finite) blocks eligibility rather than being treated as `0`
- [ ] (Milestone 7) preflight's input-cost bound is cache-write aware:
      `effectiveInputPricePerToken = MAX(promptPricePerToken,
      cacheReadPricePerToken, cacheWritePricePerToken)`; a non-zero
      automatically-applicable `input_cache_write` rate is never assumed
      to only lower spend, including in the retry reserve
- [ ] (Milestone 7) `input_cache_write_1h` is excluded from the bound only
      because the request contract provably cannot invoke it — never
      documented as "cache pricing can only reduce spend"
- [ ] (Milestone 7) a route with a zero prompt rate but a non-zero
      automatically-applicable cache-write rate is never classified `FREE`
- [ ] (Milestone 7) a dynamic/non-deterministic model construct (Auto
      Router, "latest"-style alias) blocks explicitly rather than being
      silently resolved or substituted
- [ ] (Milestone 7) no authoritative budget/tier comparison uses
      `Number(...)` or native binary floating-point arithmetic
- [ ] (Milestone 7) the one mandatory live metadata integration check
      required before merge performed zero model inference, sent no
      case/prompt content, and recorded no secret
- [ ] (Milestone 13, Issue #36) a database persistence error inside a
      logical call is classified `DATABASE_ERROR`, never mislabeled as a
      participant-earned terminal-failure code, and preserves known
      economics stage-aware (no attempt for a claim-stage failure,
      already-known telemetry for a terminalize-stage failure,
      already-persisted economics untouched for a content-persistence-
      stage failure)
- [ ] (Milestone 13, Issue #36) a phase-level persistence failure
      (`transitionToJudges`/`completeRun`/`failRun` itself) resolves to
      an explicit `DATABASE_ERROR` failure, never an uncaught rejection,
      and the recovery write itself never recurses/rethrows on failure
- [ ] (Milestone 13, Issue #36) both cost-bearing run-start endpoints
      (`POST /api/runs`, `POST /api/demo/jon-snow/runs`) are
      admission-control rate-limited under independent bucket
      namespaces, with idempotent-replay exemption preserved
- [ ] (Milestone 13, Issue #36) prompt-injection tests for the core
      Tribunal path prove containment (untrusted content stays out of
      the system prompt, server-owned side/role/schema are unaffected,
      no privileged tools, malformed output rejected) — never a claim of
      semantic immunity from adversarial free-text reasoning
- [ ] (Milestone 13, Issue #36) hostile Charge Sheet/personality/speech/
      reasoning/participant-identity text renders as literal text with
      zero executable DOM element created, across every real-run display
      surface, not merely one
- [ ] (Milestone 13, Issue #36) `npm audit` advisories are reviewed and
      recorded with an evidence-based disposition (Sec 17.1), never
      silently ignored, and `npm audit fix --force` is never run without
      explicit, separate triage of each breaking change

---

## 20. Explicit Non-Claims

V1 does not claim:

- legal-grade confidentiality
- user identity/private ownership
- semantic immunity from adversarial prompts
- guaranteed correctness of judge reasoning
- guaranteed availability of any external model/provider
- protection against a determined large distributed abuse campaign without stronger authentication/admission controls

The V1 security goal is a bounded, honest, auditable public course demo with protected secrets and financial blast radius.
