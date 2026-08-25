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

### 5.3 Model catalog

`GET /api/models` does not blindly proxy the entire OpenRouter model list.

Backend filtering should keep only models meeting V1 needs, including:

- text/chat capability
- structured-output support
- required max-token parameter support
- adequate context length for judge prompts
- pricing that can be represented/bounded by V1 economics rules

Return a sanitized model view to the browser, for example:

```ts
type EligibleModel = {
  id: string;
  name: string;
  contextLength: number;
  promptPricePerMillion: string;
  completionPricePerMillion: string;
  isFree: boolean;
};
```

Cache model metadata briefly server-side/in memory where useful, but refresh it before authoritative preflight according to `docs/economics.md`.

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
- returns normalized text

### 7.2 Models

`GET /api/models`

- server-side OpenRouter metadata fetch/filter
- no API key exposed
- eligible models only

### 7.3 Preflight

`POST /api/preflight`

- validates complete case/configuration
- resolves current eligible model pricing
- returns conservative estimate and eligibility
- performs no model inference

### 7.4 Start run

`POST /api/runs`

Request includes a stable `client_request_id` plus case and seven participant configurations.

Server:

- validates again independently of browser
- reruns authoritative preflight
- writes immutable run snapshot
- idempotently returns existing run if same request was already accepted
- invokes worker
- returns `202` with `run_id`

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
source_type         text NOT NULL   -- MANUAL | FILE
source_filename     text NULL
created_at          timestamptz NOT NULL
```

Server validation remains authoritative even if DB checks are also added.

### 8.2 `tribunal_runs`

```text
id                  uuid PK
case_id             uuid FK -> cases
client_request_id   text UNIQUE NOT NULL
execution_mode      text NOT NULL
status              text NOT NULL
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
created_at          timestamptz NOT NULL
```

`client_request_id` is the first duplicate-spend guard.

### 8.3 `participant_configs`

Exactly seven rows per run.

```text
id                          uuid PK
run_id                      uuid FK -> tribunal_runs
participant_key             text NOT NULL
role                        text NOT NULL   -- ADVOCATE | JUDGE
side                        text NULL       -- PRO | CON for advocates
personality_text            text NOT NULL
personality_source          text NOT NULL   -- MANUAL | FILE
personality_source_filename text NULL
model_id                    text NOT NULL
prompt_version              text NOT NULL
created_at                  timestamptz NOT NULL

UNIQUE(run_id, participant_key)
```

Participant keys are stable logical identities such as `PRO_1`, `PRO_2`, `CON_1`, `CON_2`, `JUDGE_1`, `JUDGE_2`, `JUDGE_3`.

### 8.4 `model_call_attempts`

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
- pricing/preflight context required for audit

These inputs are frozen for that run.

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
