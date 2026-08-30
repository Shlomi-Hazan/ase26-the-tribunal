# The Tribunal — Architecture

> **Status:** V1 architecture decision
> **Companion documents:** `INTENT.md`, `SPEC.md`, `SECURITY.md`, `docs/economics.md`, `docs/ui-spec.md`

## 0. Architectural Goal

The architecture must make the Tribunal simple to reason about, cheap to run, safe with secrets, and auditable after the fact.

The central constraint is unusual for a small student app: one user action can trigger seven external model calls, with a dependency barrier between four concurrent advocates and three concurrent judges. That makes request duration, retries, duplicate execution, and cost part of the system shape rather than implementation trivia.

The approved V1 stack stays close to the course toolbox while keeping each responsibility explicit.

---

## 1. Approved Technology Stack

### Frontend

- **React**
- **TypeScript**
- **Vite**
- **React Router**
- **Material UI (MUI)**
- **Zod** for shared runtime schemas/validation

Why:

- React + TypeScript is mature, inspectable, and easy for agentic development.
- Vite keeps the project small and avoids server-rendering complexity that this product does not need.
- MUI provides accessible, consistent primitives while still allowing a polished custom visual language.
- Zod gives one explicit contract for form/API/model-output validation without introducing a large framework.

Avoid adding global state/query libraries until a concrete need appears. Prefer React state/hooks and small service modules first.

### Backend and deployment

- **Netlify** for static frontend hosting and server-side functions
- **Netlify synchronous Functions** for short request/response API operations
- **Netlify Background Function** for the long-running Tribunal worker

Why the background worker is required:

A normal synchronous Netlify Function has a 60-second execution limit, while a Background Function can run for up to 15 minutes and returns `202` immediately. A two-phase workflow with up to seven calls plus one permitted retry per participant should therefore not hold one browser request open for the entire deliberation.

The browser starts a run, receives a run ID quickly, and polls durable state while the Background Function performs the deliberation.

### Database

- **Supabase PostgreSQL**

V1 uses Supabase as a hosted relational database, not as the primary long-running execution environment.

Why PostgreSQL:

- the domain is relational: cases → runs → participant configurations → attempts/outputs
- historical audit data benefits from explicit constraints and foreign keys
- transactions and uniqueness constraints help prevent duplicate spend
- SQL makes the repository's data model easy to inspect and verify

### Database access policy

The browser does **not** directly query Supabase in V1.

All database operations go through Netlify server-side functions. Server functions hold the Supabase privileged credential. This keeps validation, write authority, audit rules, and cost-bearing operations behind one backend boundary.

RLS should still be enabled as defense-in-depth with no public browser policies required for V1.

### Model gateway

- **OpenRouter**
- use a small typed server-side wrapper around the OpenRouter HTTP API (native `fetch`) rather than binding the architecture to a provider SDK

Why plain `fetch` initially:

- the API surface needed is small
- it avoids SDK churn and unnecessary dependency coupling
- requests/responses remain visible and easy to mock
- OpenRouter remains replaceable behind one service boundary

If a later SDK provides concrete maintainability value, adding it requires an explicit dependency decision.

---

## 2. System Context

```text
┌──────────────────────────────┐
│          Browser             │
│ React / TypeScript / MUI     │
│                              │
│ Forms · Progress · Results   │
└──────────────┬───────────────┘
               │ HTTPS, same-origin API
               ▼
┌──────────────────────────────┐
│       Netlify Functions      │
│                              │
│ Short API handlers           │
│ + Background Tribunal worker │
└───────┬─────────────┬────────┘
        │             │
        │ SQL/API     │ HTTPS
        ▼             ▼
┌───────────────┐   ┌───────────────────┐
│   Supabase    │   │    OpenRouter     │
│  PostgreSQL   │   │   model gateway   │
└───────────────┘   └───────────────────┘
```

The browser never calls OpenRouter directly and never receives privileged database credentials.

---

## 3. Request and Execution Model

### 3.1 Setup requests

Short setup operations use synchronous functions:

```text
Browser
  → API Function
     → validate
     → optional DB/OpenRouter metadata read
  ← JSON response
```

Examples:

- parse text upload
- retrieve eligible model catalog
- budget preflight
- list history
- fetch stored case/run

### 3.2 Start-run request

Starting a run is intentionally split from executing it.

```text
Browser
   │ POST /api/runs
   ▼
Synchronous start function
   ├─ authoritative validation
   ├─ authoritative budget preflight
   ├─ idempotent case/run/config persistence
   ├─ status = READY
   ├─ invoke background worker
   └─ return 202 + run_id
                │
                ▼
       Background worker
```

The browser then polls run state.

### 3.3 Polling

```text
Browser
  → GET /api/runs/:id
  ← run state + participant statuses + completed outputs/economics
```

Initial polling cadence may be around 1–2 seconds while running, with basic backoff if desired. Exact UI cadence is implementation detail; it must avoid needless request storms.

Polling is chosen instead of Supabase Realtime for V1 because it preserves the server-only database boundary and keeps the architecture smaller.

---

## 4. Tribunal Background Worker

### 4.1 Invocation protection

The background worker is not a public user API.

Invocation must require an `INTERNAL_FUNCTION_SECRET` (or equivalent unguessable server-only token) and POST-only semantics.

The browser never receives this secret.

### 4.2 Atomic run claim

Background execution must be safe against duplicate delivery.

At worker start, atomically transition only an eligible `READY` run into `ADVOCATES_RUNNING` (or use an equivalent claim field/transaction).

If the run is already claimed/completed/failed, the duplicate worker exits without model calls.

This invariant is mandatory because background delivery/retry or accidental invocation must not double-spend.

### 4.3 Advocate phase

```text
                ┌─ Advocate PRO 1 attempt
                ├─ Advocate PRO 2 attempt
RUN CLAIMED ────┼─ Advocate CON 1 attempt
                └─ Advocate CON 2 attempt
                         │
                         ▼
                  await all settled
                         │
                 validate all four
```

Implementation should use a concurrent primitive such as `Promise.allSettled` over four logical-call runners.

Each logical-call runner owns:

- attempt 1
- validation
- optional one retry
- attempt audit persistence
- terminal success/failure

The worker does not proceed to judges unless all four logical calls succeed.

### 4.4 Judge phase

After the barrier:

```text
status = JUDGES_RUNNING
        │
        ├─ Judge 1 logical call
        ├─ Judge 2 logical call
        └─ Judge 3 logical call
                 │
                 ▼
          await all settled
```

Every judge input is assembled from the same persisted/frozen four speeches.

If any judge terminally fails, the run becomes `FAILED` and no majority is stored.

### 4.5 Completion

When all three judges succeed:

1. deterministically calculate majority
2. deterministically aggregate economics
3. deterministically assemble versioned protocol
4. persist immutable final outputs
5. set `COMPLETED` and `completed_at`

No model call occurs during completion.

---

## 5. OpenRouter Service Boundary

Create one server-side module/service responsible for all OpenRouter interaction.

It owns:

- model-catalog retrieval
- request construction
- provider-routing restrictions
- timeout handling
- response/usage extraction
- error normalization

It does **not** own Tribunal orchestration or database policy.

### 5.1 Strict structured output

Requests use OpenRouter structured outputs when supported:

- `response_format.type = "json_schema"`
- schema `strict = true`
- `additionalProperties: false` for V1 participant contracts
- provider routing requires support for supplied parameters

Separate schemas:

**Advocate**

```json
{
  "type": "object",
  "properties": {
    "speech": { "type": "string", "minLength": 1 }
  },
  "required": ["speech"],
  "additionalProperties": false
}
```

**Judge**

```json
{
  "type": "object",
  "properties": {
    "verdict": {
      "type": "string",
      "enum": ["GUILTY", "NOT_GUILTY"]
    },
    "reasoning": { "type": "string", "minLength": 1 }
  },
  "required": ["verdict", "reasoning"],
  "additionalProperties": false
}
```

The backend still validates returned content with its own runtime schema before accepting it.

### 5.2 Provider routing policy

For V1 model calls:

- `require_parameters: true`
- `allow_fallbacks: false`
- prefer/sort eligible provider endpoints by price where useful
- apply `max_price` derived from approved pricing policy where practical
- prefer providers whose data policy satisfies the project's current privacy choice

Disabling automatic provider fallback makes the actual route and pricing more auditable; the application itself already owns the single permitted retry.

### 5.3 Model catalog vs. resolved execution route (Milestone 7)

`GET /api/models` does not blindly proxy the entire OpenRouter model list.

**Model catalog (`GET /models`, OpenRouter's top-level model list,
including its `top_provider` summary) is coarse discovery metadata —
enough to say "this model exists," not enough to authorize spend.** One
OpenRouter model can be served by multiple provider endpoints with
different pricing, capabilities, context limits, and availability
(`GET /models/{author}/{slug}/endpoints`). Authoritative preflight
(Milestone 7) always resolves and prices the exact endpoint a later
execution attempt would be pinned to — never a model-level average, and
never a different, cheaper endpoint than the one actually selected. See
`docs/adr/0003-openrouter-infrastructure.md` Decisions 2, 4, 4A, and 5
for the full `ResolvedModelRoute` contract, eligibility checklist,
unique-pinnability rule, and deterministic selection algorithm.

**Corrected (route-pinning pass):** an endpoint's provider-routing `tag`
alone is not automatically proof it identifies exactly one endpoint —
OpenRouter's provider slugs have base-slug-matches-multiple-variants
semantics (e.g. base slug `deepinfra` can match several
region/quantization variants including `deepinfra/turbo`). A candidate
endpoint is only eligible when its `tag` is provably **uniquely
pinnable** in the current candidate set (`ResolvedModelRoute.isUniquelyPinnable`,
Decision 4A); otherwise it is blocked with `ENDPOINT_NOT_PINNABLE`,
regardless of price.

**Corrected (cache-economics pass):** pricing is bound conservatively
using a cache-aware `effectiveInputPricePerToken`, never the raw
`promptPricePerToken` alone. OpenRouter endpoint pricing exposes a
genuine cache-**write** rate (`input_cache_write`, and a
separately-priced `input_cache_write_1h`) alongside the cheaper
cache-read rate (`input_cache_read`); provider docs confirm cache writes
can cost *more* than ordinary input (e.g. Anthropic's documented 1.25x/
2x multipliers, OpenAI's documented 1.25x for its GPT-5.6+ family,
triggerable with no request-side opt-in). A prior pass's assumption that
implicit caching "can only reduce spend" was false and is retracted —
see `docs/adr/0003-openrouter-infrastructure.md` Decision 7B.

Backend filtering keeps only models/endpoints meeting V1 needs, including:

- text/chat capability
- structured-output support
- the current (non-deprecated) bounded-output parameter support
- adequate context length for judge prompts
- pricing that can be represented/bounded by V1 economics rules, with no
  unrepresentable conditional `pricing.overrides`, no malformed
  `pricing.discount`, and no cache-related pricing field outside the
  documented, conservatively-bounded set (Decisions 7A, 7B)
- a **uniquely pinnable** provider-routing identity (never a dynamic/alias
  construct whose executed model cannot be fixed before execution, and
  never a base provider slug that currently matches more than one
  candidate endpoint)

Return a sanitized model/route view to the browser, for example:

```ts
type EligibleModel = {
  id: string;
  name: string;
  contextLength: number;
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  isFree: boolean;
  priceTier: "FREE" | "BUDGET" | "PREMIUM" | "ABOVE_PREMIUM";
};
```

### 5.4 Fakeable provider boundary (Milestone 7)

All OpenRouter interaction is behind one small interface:

```ts
interface OpenRouterProvider {
  listModels(): Promise<RawOpenRouterModel[]>;
  listEndpoints(author: string, slug: string): Promise<RawOpenRouterEndpoint[]>;
  createChatCompletion(request: ProviderChatRequest): Promise<ProviderChatResult>;
}
```

`listEndpoints` resolves `GET /models/{author}/{slug}/endpoints` — the
call that actually returns per-provider pricing/capability/routing-tag
data (§5.3). One real (`fetch`-based) and one deterministic in-memory
fake implementation satisfy every consumer — route resolution,
preflight, and later Milestone 8 execution. No second provider
abstraction is introduced for hypothetical future gateways; OpenRouter is
the only V1 gateway (`SPEC.md` §8). Normal automated tests inject the
fake and never make a real network call. See
`docs/adr/0003-openrouter-infrastructure.md` Decision 1.

### 5.5 Model/endpoint metadata caching (Milestone 7)

The fetched catalog/endpoint data is cached in an in-process,
per-Function-instance bounded cache keyed by model ID with a stored fetch
timestamp — not a database table, not Redis, not a queue (§16). It is
treated as fresh only within a locked, exact TTL:

```ts
const MODEL_METADATA_TTL_MS = 300_000; // 5 minutes
```

Past that TTL, or when metadata cannot be fetched and no fresh cached
copy exists, authoritative preflight treats pricing as unavailable and
**blocks** — it never serves stale pricing to an
eligibility decision and never invents economics (`docs/economics.md`
§15). Injectable clock in tests. See
`docs/adr/0003-openrouter-infrastructure.md` Decision 3.

---

## 6. Prompt Architecture

Runtime prompts are code and live in version control.

Proposed logical layout once implementation begins:

```text
src/
  prompts/
    advocate-system.ts
    judge-system.ts
    schemas.ts
    versions.ts
```

Do not create seven independent prompt implementations.

### 6.1 Advocate prompt composition

```text
FIXED ADVOCATE ROLE + OUTPUT RULES
          +
ASSIGNED SIDE
          +
PARTICIPANT PERSONALITY
          +
CANONICAL CHARGE SHEET
```

### 6.2 Judge prompt composition

```text
FIXED JUDGE ROLE + OUTPUT RULES
          +
PARTICIPANT PERSONALITY
          +
CANONICAL CHARGE SHEET
          +
ALL FOUR LABELED SPEECHES
```

User content must be delimited/labeled as data. Fixed system instructions state that embedded instructions in Charge Sheet/speeches/personality cannot change the required role, output schema, or system policy.

Each participant config stores the prompt-version identifier used in that historical run.

---

## 7. API Surface

Exact route filenames are implementation details, but the V1 HTTP contract should map to these operations.

### 7.1 Imports

`POST /api/import/charge-sheet`

- multipart/text upload
- server validates extension, bytes, UTF-8, markers, field limits
- returns normalized Defendant/Act/Question
- does not persist raw file by default

`POST /api/import/personality`

- validates `.txt`/`.md`, bytes, UTF-8, normalized character limit
- returns normalized text and safe source metadata

`POST /api/import/tribunal-package`

- validates `.txt`/`.md`, bytes, UTF-8, strict `TRIBUNAL_PACKAGE_V1` grammar, required sections, and field limits
- returns one normalized Tribunal Setup Draft that targets exactly the seven fixed participant seats
- rejects unsupported structural fields such as model/provider/execution/prompt/pricing/budget fields
- does not persist raw file bytes
- performs no LLM call
- never starts Tribunal execution

### 7.2 Models

`GET /api/models`

- server-side OpenRouter metadata fetch/filter
- no API key exposed
- eligible models only

### 7.3 Preflight (Milestone 7 — standalone, locked)

`POST /api/preflight`

Request: `{ "runId": "<UUID>" }` — operates on an already-frozen run.

- rejects a run whose `prompt_version` is still the pre-M7 placeholder
- resolves each participant's exact `ResolvedModelRoute` (§5.3), not a
  model-level average
- validates endpoint-level eligibility and computes conservative cost
  using exact decimal arithmetic
- assigns discovery price tier (`FREE`/`BUDGET`/`PREMIUM`/
  `ABOVE_PREMIUM`) per participant, informational only
- returns eligibility, per-participant reason codes, and the conservative
  estimate — see `docs/adr/0003-openrouter-infrastructure.md`
  Decision 15 for the exact response shape
- performs no model inference, no persistence, no run mutation

**Locked (Milestone 7 scope boundary):** this is the *only* Milestone 7
touch point for preflight. It does not call, and is not called from,
`POST /api/runs` (§7.4 step 5). See
`docs/adr/0003-openrouter-infrastructure.md` Decision 14.

### 7.4 Start run

`POST /api/runs`

Request includes a stable `client_request_id`, a discriminated `case`
field (`{ kind: "existing", caseId }` or `{ kind: "new", ...CreateCaseInput }`
— never both), and seven participant configurations.

Server, in the following precise order (`docs/adr/0002-participant-configuration-freeze.md`
Decision 10 — the exact ordering is the fix for a real defect an
independent review found in an earlier draft, see below):

1. validates the request again independently of browser
2. resolves the *canonical semantic* case input: `kind: "existing"` loads
   and trusts the already-immutable M5 case by ID (rejecting an unknown
   ID) without writing anything; `kind: "new"` validates the normalized
   case fields but does **not** create the row yet
3. normalizes the seven participant configs
4. computes a deterministic `request_fingerprint` (SHA-256, Node built-in
   `crypto`) over the **canonical case input from step 2** — `{kind:
   "existing", caseId}` or `{kind: "new", defendant, act, exactQuestion,
   sourceType, sourceFilename}` — **never** a generated/resolved case
   UUID, plus execution mode and the normalized seven-participant
   configuration (ADR Decision 11) — server-computed, never
   browser-authoritative. Computing this *before* any case row exists is
   deliberate: fingerprinting a `kind: "new"` case's *resolved* ID instead
   would make a legitimate retry after a lost HTTP response mint a second
   case UUID and produce a different fingerprint, incorrectly reporting a
   conflict for an identical request
5. reruns authoritative preflight *(from Milestone 8 onward, once real
   execution exists to gate; Milestone 6 has no preflight to run since no
   model pricing exists yet — see below. **Locked:** Milestone 7 ships
   only the standalone, read-only `POST /api/preflight` endpoint (§7.3);
   it does not modify this endpoint's write path and does not persist
   `BLOCKED_BUDGET`. Wiring preflight synchronously into this step —
   which needs a further forward migration to the freeze function's
   currently-hardcoded `'READY'` status literal — is Milestone 8's
   integration, because only Milestone 8 actually has execution to block.
   See `docs/adr/0003-openrouter-infrastructure.md` Decision 14.)*
6. resolves/creates the case idempotently — for `kind: "new"`, an ordinary
   insert keyed by `convene_request_id = client_request_id`, falling back
   to a compare-and-reuse (or `409`) read on a unique-constraint conflict;
   race-safe by construction, no new database function required (ADR
   Decision 9)
7. calls the freeze function (`SECURITY DEFINER`, the only write path for
   `tribunal_runs`/`participant_configs` — see §8.3.1) with
   `client_request_id`, the `request_fingerprint` from step 4,
   `execution_mode`, the `case_id` resolved in step 6, and the seven
   participant entries. The function is the **final** atomic authority
   (ADR Decision 6): it atomically reuses an existing run if the
   fingerprint matches, rejects with a conflict if it doesn't, or inserts
   exactly the run row + seven `participant_configs` rows and returns them
8. returns `202`/`201` with `run_id`, or `409 idempotency_conflict` if
   either case resolution (step 6) or the freeze function (step 7)
   detected a same-key/different-payload conflict
9. invokes worker *(from Milestone 8 onward; Milestone 6 performs no
   execution and stops at `READY`)*

Milestone 6 implements this endpoint's validation, case resolution, and
atomic freeze. It performs zero model/OpenRouter calls and never
transitions a run past `READY`. `READY` means accepted/frozen
configuration only — it does not by itself mean execution-eligible (see
ADR Decision 12 on the `prompt_version` placeholder).

**Corrected (Milestone 8 implementation, [Issue #17](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/17)):**
step 5's "reruns authoritative preflight" and step 9's "invokes worker"
are two separate gates, not one. The actual implemented executable order
is:

```text
freeze/reuse idempotent run (steps 1-8 above, unchanged)
  -> synchronous preflight, using the connected user's own OpenRouter
     credential (never the operator's) -- the user's pre-spend
     confirmation gate, not the final authority
       ineligible -> atomic READY -> BLOCKED_BUDGET (block_tribunal_run_budget
         RPC), no worker invocation
       eligible   -> server-to-server invocation of the Background
         Function, forwarding INTERNAL_FUNCTION_SECRET (server-only) and
         the user's credential as headers -- the browser never receives
         either
  -> worker: fresh, zero-completion metadata + route resolution + a
     SECOND, independent run of the same preflight logic (the final
     execution-time authority, since a resolved route cannot cross the
     synchronous-function -> Background-Function boundary in memory)
       ineligible -> atomic READY -> BLOCKED_BUDGET, zero completion calls
       eligible   -> atomic READY -> ADVOCATES_RUNNING
             (claim_tribunal_run_for_execution RPC) -- only past this
             point does any paid completion call occur
```

The two `READY`-originating atomic transitions
(`block_tribunal_run_budget`, `claim_tribunal_run_for_execution`) are
mutually exclusive by construction: both are `WHERE status = 'READY'`
updates, so whichever commits first prevents the other. See
`netlify/server/tribunal/execution.ts` and
`netlify/server/tribunal/triggerExecution.ts`.

**Known limitation, documented rather than solved (P1, out of M8's
submission scope):** if the Background Function process dies
catastrophically after winning the `ADVOCATES_RUNNING`/`JUDGES_RUNNING`
claim but before any terminal write, the run has no automatic
reconciliation and can remain stuck in that state. No lease/heartbeat/
queue system was built for this pass.

### 7.5 Read run/history

- `GET /api/runs/:id`
- `GET /api/cases`
- `GET /api/cases/:id`

Read endpoints return sanitized public-demo data only.

No V1 delete/edit-history API is required unless the specification changes.

---

## 8. Database Model

Use UUID primary keys and UTC timestamps. Monetary fields should use fixed-precision numeric/decimal semantics, not binary floating point.

### 8.1 `cases`

Purpose: canonical submitted case.

```text
id                  uuid PK
defendant           text NOT NULL
act                 text NOT NULL
exact_question      text NOT NULL
source_type         text NOT NULL   -- MANUAL | CHARGE_SHEET_FILE | TRIBUNAL_PACKAGE_FILE
source_filename     text NULL
created_at          timestamptz NOT NULL
```

Server validation remains authoritative even if DB checks are also added.

Milestone 5 source types distinguish at minimum:

- `MANUAL`
- `CHARGE_SHEET_FILE`
- `TRIBUNAL_PACKAGE_FILE`

Milestone 5 persists normalized case data only. It does not create participant/run/output/protocol tables early.

A future Milestone 6 forward migration (not yet created) adds exactly one
nullable column, `convene_request_id text` (`UNIQUE` when non-null — plain
PostgreSQL `UNIQUE` semantics, so any number of `NULL` rows remain
allowed), so a Convene-created `kind: "new"` case is itself idempotent
under a lost-response retry (`docs/adr/0002-participant-configuration-freeze.md`
Decision 9). Standalone M5 `Save Case` is unaffected and continues to
write `NULL`. This column is internal persistence metadata only — it is
never added to the public `StoredCase`/browser response shape, since the
case repository already selects an explicit column list rather than
`select *`. No other `cases` column, constraint, or grant changes; the
existing Milestone 5 privilege model (`service_role`: `SELECT` + `INSERT`
only, no `UPDATE`/`DELETE`; `anon`/`authenticated`: no access; RLS
enabled) is unchanged.

### 8.2 `tribunal_runs`

Milestone 6 creates only the columns needed to accept and freeze a
configuration. Execution/economics columns below are **not** created by
Milestone 6; they are added by a later forward migration when M8/M10
actually need them (see `docs/adr/0002-participant-configuration-freeze.md`).

Milestone 6 columns:

```text
id                  uuid PK
case_id             uuid FK -> cases NOT NULL
client_request_id   text UNIQUE NOT NULL
request_fingerprint text NOT NULL   -- SHA-256 of the canonical semantic request (never a resolved case UUID); see ADR Decision 11
execution_mode      text NOT NULL   -- SHARED | SEPARATE
status              text NOT NULL   -- CHECK against the full SPEC.md §14 vocabulary;
                                     -- M6 itself only ever writes READY
created_at          timestamptz NOT NULL
```

`client_request_id` is the first duplicate-spend guard, and doubles as the
Milestone 6 Convene idempotency key even though no spend occurs yet.
`request_fingerprint` lets the freeze function distinguish a genuine retry
(same key, same fingerprint → reuse) from a same-key/different-payload
conflict (→ `409 idempotency_conflict`), atomically, without trusting a
client-supplied fingerprint.

Deferred to M8/M10 (documented here for forward reference only — not part
of the Milestone 6 migration):

```text
majority_verdict    text NULL
total_input_tokens  bigint NULL
total_output_tokens bigint NULL
total_tokens        bigint NULL
advocate_cost_usd   numeric NULL
judge_cost_usd      numeric NULL
total_cost_usd      numeric NULL
failure_code        text NULL
failure_message     text NULL
started_at          timestamptz NULL
completed_at        timestamptz NULL
```

### 8.3 `participant_configs`

Exactly seven rows per run, inserted atomically together with the
`tribunal_runs` row (see §8.3.1).

```text
id                          uuid PK
run_id                      uuid FK -> tribunal_runs NOT NULL
participant_key             text NOT NULL
role                        text NOT NULL   -- ADVOCATE | JUDGE
side                        text NULL       -- PRO | CON for advocates, NULL for judges
profile_name                text NULL       -- optional, <=120 normalized chars
personality_text            text NOT NULL
personality_source          text NOT NULL   -- manual | individual_file | tribunal_package
personality_source_filename text NULL
model_id                    text NOT NULL
prompt_version              text NOT NULL   -- placeholder constant until M7 prompts exist
created_at                  timestamptz NOT NULL

UNIQUE(run_id, participant_key)
```

Participant keys use the application's established `ParticipantId`
convention (`advocate-pro-1`, `advocate-pro-2`, `advocate-con-1`,
`advocate-con-2`, `judge-1`, `judge-2`, `judge-3` — see
`src/schemas/tribunalSetup.ts`), **not** the Milestone 5 Tribunal Package
seat identifiers (`PRO_1`, `CON_1`, `JUDGE_1`, …), which are a distinct,
narrower namespace used only for parsing the `TRIBUNAL_PACKAGE_V1` file
format. `personality_source` uses the same three-value taxonomy already
established by Milestone 5 (`personalitySourceSchema`), not the two-value
`MANUAL | FILE` this document previously (and incorrectly) implied.

#### 8.3.1 Atomic freeze and privilege model

No client can perform a cross-table transaction against Supabase's REST
Data API. Milestone 6 therefore defines one `SECURITY DEFINER` Postgres
function, invoked via `supabase.rpc(...)`, that is the **only** write path
for `tribunal_runs` and `participant_configs`:

- **`service_role` is granted `SELECT` only** on both tables — no
  `INSERT`/`UPDATE`/`DELETE` grant at all. `anon`/`authenticated` have no
  privileges. RLS is enabled with no public/browser policy.
- The freeze function runs `SECURITY DEFINER` (required, since the calling
  role deliberately cannot `INSERT` directly), with `SET search_path = ''`
  and every referenced object schema-qualified, no dynamic SQL, no
  user-controlled identifiers, and the smallest parameter contract that
  works (`role`/`side`/`prompt_version` are never caller-supplied — the
  function derives them internally from a fixed mapping of the seven known
  `participant_key` values).
- `EXECUTE` on the function is explicitly revoked from `PUBLIC`, `anon`,
  and `authenticated`, and granted only to `service_role`, in the same
  migration that creates the function.
- The function independently re-validates exactly seven known participant
  keys, performs the idempotency fingerprint check (§7.4), and inserts the
  run row plus all seven `participant_configs` rows in one implicit
  transaction — either the complete accepted configuration exists, a
  conflict is reported, or nothing new is written. It performs no
  model/provider/network work.

See `docs/adr/0002-participant-configuration-freeze.md` Decision 6 for the
full rationale and the rejected alternative (an `INSERT` grant to
`service_role` alongside the function, which would let server code bypass
the invariant).

Once a run is accepted, no application-facing role (`service_role`,
`anon`, `authenticated`, `PUBLIC`) has an `UPDATE`/`DELETE` grant for
either table — immutability is a structural database privilege, not only
an application code path that happens not to expose one. (Administrative/
function-owner privileges necessarily exist so the `SECURITY DEFINER`
function above can insert, but that ownership authority is never itself
an application call path.) Case persistence is a separate, ordinarily-
atomic predecessor step, not part of this same transaction — see ADR
Decision 7.

### 8.4 `model_call_attempts`

**Not created by Milestone 7.** Milestone 7 makes zero real provider
calls, so it has nothing of its own to persist here — the same reasoning
that kept M6 from creating `tribunal_runs`' execution/economics columns
early (§8.2). Milestone 7 defines the equivalent TypeScript
interface/Zod schema (the telemetry contract) so Milestone 8's design and
tests can depend on a stable shape; the table and its forward migration
are created when Milestone 8/10 has a real write path that needs them.
The telemetry contract also carries the exact resolved-route identity
(`providerEndpointTag`, canonical model ID — §5.3) alongside the
configured model ID, not just the latter. See
`docs/adr/0003-openrouter-infrastructure.md` Decision 18.

One row per actual provider attempt.

```text
id                        uuid PK
run_id                    uuid FK
participant_config_id     uuid FK
attempt_number            smallint NOT NULL  -- 1 or 2
status                    text NOT NULL
model_id                  text NOT NULL
provider_request_id       text NULL

input_tokens              bigint NULL
output_tokens             bigint NULL
total_tokens              bigint NULL
input_price_per_million   numeric NULL
output_price_per_million  numeric NULL
actual_cost_usd           numeric NULL
derived_cost_usd          numeric NULL
pricing_observed_at       timestamptz NULL

latency_ms                bigint NULL
error_category            text NULL
error_message             text NULL
started_at                timestamptz NOT NULL
completed_at              timestamptz NULL

UNIQUE(participant_config_id, attempt_number)
```

Null telemetry on failed attempts means unavailable, not zero.

### 8.5 `advocate_speeches`

```text
id                    uuid PK
run_id                uuid FK
participant_config_id uuid UNIQUE FK
speech                text NOT NULL
created_at            timestamptz NOT NULL
```

### 8.6 `judge_verdicts`

```text
id                    uuid PK
run_id                uuid FK
participant_config_id uuid UNIQUE FK
verdict               text NOT NULL
reasoning             text NOT NULL
created_at            timestamptz NOT NULL
```

DB constraint/check should restrict `verdict` to the V1 vocabulary.

### 8.7 `protocols`

```text
id             uuid PK
run_id         uuid UNIQUE FK
schema_version text NOT NULL
protocol_json  jsonb NOT NULL
created_at     timestamptz NOT NULL
```

The protocol is the deterministic historical snapshot. It should not depend on reconstructing current prompts/model metadata later.

---

## 9. Data Lifecycle and Immutability

### Before execution

Draft/setup exists primarily in browser state until accepted by `POST /api/runs`.

### At run acceptance

Persist:

- canonical case
- execution mode
- seven participant configurations
- chosen model IDs
- prompt versions
- pricing/preflight context required for audit *(from Milestone 7/10
  onward; Milestone 6 has no pricing/preflight to persist yet, since no
  OpenRouter infrastructure exists — see M6 columns in §8.2)*

These inputs are frozen for that run. The case is persisted first, as an
ordinary independently-atomic step (reused if already saved); only the run
plus its seven participant configurations are guaranteed atomic together,
via the `SECURITY DEFINER` freeze function (§8.3.1). A case can end up
persisted without a corresponding frozen run if the freeze step
subsequently fails or conflicts — that is an accepted outcome, not a bug.

### During execution

Persist attempts and validated participant outputs incrementally so polling and failure diagnostics reflect durable state.

### After terminal state

A `COMPLETED` run's configuration, speeches, verdicts, protocol, and per-attempt pricing/economics are historical evidence and should not be mutated through normal APIs.

Failed-run diagnostics may be retained according to the same audit principle.

---

## 10. Economics Architecture

`docs/economics.md` owns formulas and precedence. Architecturally:

- current pricing is obtained server-side from OpenRouter model metadata
- preflight is deterministic and conservative
- actual successful-call token/cost data comes from the OpenRouter `usage` object
- pricing snapshots are stored with the attempt
- budget checks happen before run and before each provider attempt
- all money calculations use decimal-safe arithmetic

Do not use an LLM to estimate or calculate cost.

---

## 11. Security Architecture

See `SECURITY.md` for the full threat model.

Key boundaries:

```text
Browser = untrusted
User content = untrusted
Model output = untrusted
External API response = untrusted until validated
Netlify server functions = trusted application boundary
Database constraints = defense in depth
```

Secrets are environment variables available only to server runtime.

The model receives no database credentials, function secrets, arbitrary tool execution, or privileged action capability.

---

## 12. UI Architecture

Use a single SPA with route-level screens corresponding to the product flow.

Proposed logical routes:

```text
/                       new case / setup entry
/case/new               charge sheet
/case/new/advocates     advocate config
/case/new/judges        judge config
/case/new/review        review/preflight
/runs/:runId            live deliberation or terminal result
/history                 past cases
/cases/:caseId           stored historical case/run view
```

Exact URL details may be adjusted if implementation demonstrates a cleaner route model, provided the flow in `docs/ui-spec.md` remains intact.

Setup state should be held in a bounded React context/reducer or equivalent local application state; do not introduce a global state library without evidence it is needed.

---

## 13. Repository Structure

Create folders only when they become useful.

Intended structure as implementation grows:

```text
/
├── INTENT.md
├── SPEC.md
├── ARCHITECTURE.md
├── ROADMAP.md
├── AGENTS.md
├── CLAUDE.md
├── SECURITY.md
├── docs/
│   ├── conception/
│   ├── ui-spec.md
│   ├── economics.md
│   ├── adr/            # only when real ADRs exist
│   └── verification/   # milestone evidence as it becomes useful
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   ├── services/
│   ├── schemas/
│   ├── prompts/
│   └── types/
├── netlify/
│   └── functions/
├── supabase/
│   └── migrations/
└── tests/
```

Do not pre-create empty directories for appearance.

---

## 14. Verification Architecture

Once application code exists, the default gate is:

```text
install
→ lint
→ typecheck
→ tests
→ build
→ scope/diff review
→ human acceptance when UI/runtime behaviour matters
```

### Unit level

Pure deterministic domain/economics/validation modules should be easy to test without network/database access.

### Integration level

OpenRouter must be behind a fakeable boundary so orchestration tests can inject success, malformed JSON, timeout, provider errors, and token/cost data without spending money.

Database integration tests should verify uniqueness/claim/idempotency invariants where practical.

### E2E

Use a browser E2E framework selected during application foundation. Core flow should be testable with a fake model boundary; real OpenRouter smoke tests remain separately controlled because they cost money and are variable.

---

## 15. Deployment Shape

### Production

- Netlify deploys SPA + API Functions + Background Function.
- Supabase hosts PostgreSQL.
- OpenRouter serves model requests.
- Environment secrets configured in Netlify, not repository.

### Local development

Use Netlify's local development environment or equivalent so frontend and functions are exercised with same-origin routes.

Database migrations are version-controlled and applied to a development Supabase project/local environment as appropriate.

Real OpenRouter calls must be opt-in during development; normal automated tests use fakes.

---

## 16. Architecture Decisions Deliberately Not Taken

V1 does not add:

- Next.js/server-side rendering
- custom persistent Node server
- Supabase Auth
- browser-side Supabase client data access
- Supabase Realtime
- Supabase Storage for text uploads
- Redis/queue infrastructure
- WebSockets
- RAG/vector store
- arbitrary model tools
- framework for “agents”
- separate microservices

Each would add complexity or attack/cost surface without solving a current V1 requirement.

---

## 17. Future Agent Execution Compatibility

If the course later requires true agent execution, introduce it behind an execution-strategy boundary rather than rewriting the product model.

Conceptually:

```ts
interface TribunalExecutionStrategy {
  execute(runId: string): Promise<void>;
}
```

V1 implements the fixed two-phase model-call strategy.

A future agent strategy must define genuine model + tools + loop/autonomy semantics before being added. The existence of this interface alone must not be presented as implementing Agent Mode.

---

## 18. Architecture Invariants

The following require an approved architecture/specification change to violate:

1. OpenRouter key never enters the browser.
2. Browser is not authoritative for cost or model output validity.
3. Four advocates form one concurrent phase.
4. Judges start only after four valid speeches.
5. Three judges form one concurrent phase.
6. Majority and protocol are deterministic.
7. A successful no-retry run has exactly seven logical model calls.
8. Each logical call has at most one retry.
9. Duplicate start/worker delivery must not duplicate paid execution.
10. `$5` is a hard intentional-spend ceiling including retries.
11. Successful runs preserve auditable usage/cost evidence.
12. Historical runs do not rerun models when opened.
13. Runtime model calls receive no privileged arbitrary tools.
14. Model/user/external data is validated before trust.

---

## 19. Smart Tribunal Package Extraction (Milestone 7A)

`M7A - Smart Tribunal Package Extraction` is the current milestone,
planned in full in `docs/adr/0004-smart-package-extraction.md`
(structured-extraction schema, PDF extraction approach, economics,
persistence, API/UI contracts, security). This section records the
locked architectural shape; the ADR is authoritative for detail.

Flow:

```text
Free-form document
  -> safe file validation
  -> deterministic text extraction
  -> one setup-time structured extraction model call
  -> strict schema validation
  -> application normalization
  -> Extraction Review (staged preview)
  -> human correction/confirmation -> Apply
  -> existing setup Review
  -> explicit Convene Tribunal
  -> 7 Tribunal participant logical calls
```

The extraction call is a setup/import operation, resolved and priced
through the existing M7 OpenRouter provider boundary (exact endpoint
resolution, unique pinnability, decimal economics, no silent fallback)
under its own economics ceiling separate from the $5.00 Tribunal
ceiling. It is not one of the seven Tribunal participant logical calls,
does not create an eighth participant, and occurs before run creation.
The resulting draft is staged for human review and is never
automatically applied to the active setup or used to convene.

This path shares the same normalized Tribunal Setup Draft target as
deterministic Milestone 5 imports — the extraction model fills the
existing fixed-seat keys (`PRO_1`/`PRO_2`/`CON_1`/`CON_2`/`JUDGE_1`/
`JUDGE_2`/`JUDGE_3`) directly, mapped through the same
`packageSeatToParticipantId` lookup M5's import already uses. It must
not hard-code any lecturer/course dossier, fictional character set,
judicial profile set, or specific case as product configuration.

M7A supports text-extractable PDF via server-only, text-layer-only
extraction (`docs/adr/0004-smart-package-extraction.md` Decision 4). It
must not add OCR unless separately approved.
