# ADR 0002 - Participant Configuration Freeze (Milestone 6)

## Status

Accepted (planning gate, corrected after independent review)

## Context

Milestone 6 must persist and freeze the complete seven-participant Tribunal
run configuration independently of real model execution. `ARCHITECTURE.md`
already sketches `tribunal_runs` and `participant_configs`, but that sketch
predates Milestone 5's `profileName` field and three-value personality
source taxonomy, uses a different participant-identifier convention than
the one actually established in application code, includes several
execution/economics columns that are not M6 concerns, and does not specify
how "exactly seven participant configs per run" is enforced atomically.

An independent review of the first version of this ADR found it overstated
the atomic boundary (implying case + run + configs were one transaction),
under-specified the freeze function's privilege model (a plain function
plus an ordinary `INSERT` grant to `service_role` would let server code
bypass the invariant), used imprecise participant-identifier wording, and
left idempotency-conflict, case-request, and post-Convene UX semantics
undefined. This revision corrects all of those.

## Decisions

### 1. Participant-key convention

`participant_configs.participant_key` persists the application's existing
`ParticipantId` convention already established in
`src/schemas/tribunalSetup.ts` since Milestone 4/5 — `advocate-pro-1`,
`advocate-pro-2`, `advocate-con-1`, `advocate-con-2`, `judge-1`, `judge-2`,
`judge-3`.

There are two distinct namespaces and only one of them is ever persisted:

- **Package seats** (`PRO_1`, `PRO_2`, `CON_1`, `CON_2`, `JUDGE_1`,
  `JUDGE_2`, `JUDGE_3`) — the Milestone 5 `TRIBUNAL_PACKAGE_V1` file-format
  section identifiers. This grammar is unchanged by M6.
- **Internal `ParticipantId` / persisted `participant_key`**
  (`advocate-pro-1`, …) — the application's actual participant identity,
  used in setup state, imports, and now `participant_configs`.

The fixed *semantic* seats remain exactly 2 PRO advocates + 2 CON advocates
+ 3 judges; that count/role invariant is independent of which string
encodes it in a given namespace. `participant_configs` persists only the
internal `ParticipantId` values, never the package-seat strings.

### 2. Minimal `tribunal_runs` columns now; execution/economics columns deferred

M6 creates only what accepting/freezing a configuration needs: `id`,
`case_id`, `client_request_id`, `request_fingerprint` (see Decision 5),
`execution_mode`, `status`, `created_at`.

`majority_verdict`, token/cost totals, `failure_code`/`failure_message`,
`started_at`, `completed_at` are M8/M10 concerns and are **not** created by
this migration. They will be added by a forward migration when M8/M10
actually need them, following the same "never edit an applied migration"
discipline established in M5 (`20260825204419_fix_cases_source_filename_check.sql`
is the precedent). `status` uses a `CHECK` against the full run-state
vocabulary already fixed in `SPEC.md` §14 (`DRAFT, READY,
ADVOCATES_RUNNING, JUDGES_RUNNING, COMPLETED, FAILED, BLOCKED_BUDGET`) —
that vocabulary is an existing approved requirement, not something M6
invents, so constraining against it now avoids a future `ALTER TYPE`/`CHECK`
migration purely to widen an enum. M6 itself only ever writes `READY`.

### 3. `profileName` is a first-class persisted column

`SPEC.md` §4.1 already states "Milestone 6 persists/freezes this field in
full participant configuration." `participant_configs.profile_name` is
added: nullable, trimmed, `<=120` characters — identical bound to the
existing `profileNameLimit` used since M5.

### 4. `personality_source` vocabulary matches the established 3-value taxonomy

`ARCHITECTURE.md`'s original sketch predates Milestone 5's Tribunal Package
import and only listed `MANUAL | FILE`. The actual established taxonomy
(`src/schemas/tribunalSetup.ts`, `personalitySourceSchema`) has three
values: `manual | individual_file | tribunal_package`. The M6 migration's
`CHECK` constraint uses the three-value taxonomy.

### 5. Freeze is a `SECURITY DEFINER` function that is the *only* write path

**Corrected from the first version of this ADR**, which called for a plain
(non-`SECURITY DEFINER`) function alongside an ordinary `INSERT` grant to
`service_role`. That combination is self-defeating: if `service_role` can
`INSERT` directly, server code (buggy or otherwise) can create a partial
run or a `participant_configs` row set that isn't exactly seven, bypassing
the freeze function entirely. The corrected model:

**Table grants** (`public.tribunal_runs`, `public.participant_configs`):

- `service_role`: `SELECT` only. **No** `INSERT`/`UPDATE`/`DELETE` grant.
- `anon`, `authenticated`: no privileges at all.
- RLS enabled on both tables; no public/browser policy.

**Freeze function** (name/signature to be finalized at implementation
time, not in this planning task):

- Declared `SECURITY DEFINER` — it must run with the privileges needed to
  insert, since the calling role (`service_role`) deliberately does not
  have `INSERT` on either table. This is the one narrowly-scoped exception
  to "no direct insert," and it exists *because* it is the sole gate that
  can enforce the invariant, not in spite of it.
- `SET search_path = ''` in the function definition, so no unqualified
  identifier can resolve against an unexpected schema.
- Every referenced table/function/type is fully schema-qualified
  (`public.tribunal_runs`, `public.participant_configs`, …).
- No dynamic SQL (no `EXECUTE`-with-string-concatenation); no
  user-controlled identifiers of any kind.
- Smallest possible parameter contract: `case_id`, `client_request_id`,
  `request_fingerprint`, `execution_mode`, and a fixed-shape array/JSON of
  exactly the participant-specific fields the caller may vary
  (`participant_key`, `profile_name`, `personality_text`,
  `personality_source`, `personality_source_filename`, `model_id`). The
  caller **cannot** pass `role`, `side`, or `prompt_version` as free-form
  parameters — the function derives `role`/`side` internally from a fixed
  mapping of the seven known `participant_key` values (so a caller cannot,
  by bug or otherwise, assign `advocate-pro-1` a `CON` side) and writes the
  one application-owned `prompt_version` placeholder itself (see
  Decision 8).
- Independently re-validates that the input contains exactly the seven
  known `participant_key` values, no duplicates, no unknown keys —
  defense-in-depth behind the application's own Zod validation, which
  remains authoritative for user-facing error messages.
- Performs the idempotency check (Decision 6) and the insert in the same
  implicit transaction: either the complete run + seven configs are
  visible, or a conflict/duplicate is reported and nothing new is written.
  A failed freeze never leaves a partial `tribunal_runs` row or a
  `participant_configs` row count other than 0 or 7 for that run.
- Performs no model/provider/network work of any kind — pure, deterministic
  SQL/PL/pgSQL.
- Function creation and its privilege grants/revokes happen in the same
  migration:

  ```sql
  revoke execute on function public.freeze_participant_configuration(...)
  from public, anon, authenticated;

  grant execute on function public.freeze_participant_configuration(...)
  to service_role;
  ```

This function is not created in this planning task — only its contract is
locked here.

**Alternative considered and rejected:** granting `service_role` ordinary
`INSERT` on both tables alongside the function, reasoning that the
function would be used "by convention." Rejected because a structural
invariant that depends on server code always remembering to call the
function through the intended path is not structural — it is procedural
with extra steps. Revoking `service_role`'s `INSERT` entirely and making
the `SECURITY DEFINER` function the sole path is what actually makes
"exactly seven, immutable" a database-enforced guarantee rather than a
convention.

### 6. Case persistence is an independent, non-atomic predecessor step

**Corrected from the first version of this ADR**, which implied case
creation happened "within the same atomic acceptance" as the run/config
freeze. It does not, and should not: a case has been an independently
valid, independently persistable M5 entity since Milestone 5 (`Save Case`
already ships as its own action with its own endpoint), and folding case
creation into the freeze transaction would mean the freeze function must
also own case validation/creation — expanding its blast radius for no
real benefit.

The locked contract:

- If Convene needs to create a case (see Decision 7 for exactly when), the
  server creates it **immediately before** invoking the freeze function,
  using the unchanged M5 case-creation path (`validateCreateCaseInput` /
  `SupabaseCaseRepository.create`). This is an ordinary, already-atomic
  single-table insert — not a new pattern.
- The hard atomic invariant (`SECURITY DEFINER` function, single implicit
  transaction) applies specifically and only to **`tribunal_runs` +
  exactly seven `participant_configs` rows**.
- If case creation succeeds but the subsequent freeze call fails (e.g. a
  same-key/different-payload idempotency conflict, or an unexpected
  server error), the created case **remains persisted**. This is
  acceptable and intentional: it is a legitimately valid, independently
  useful M5 case (it will already appear in Past Cases), not an orphaned
  or partial record of anything. A retried Convene reuses that same case
  by ID rather than creating a duplicate (see Decision 7).
- Case creation is never moved into the freeze function merely to claim a
  broader atomic boundary than the invariant actually requires.

### 7. Case request contract — one unambiguous branch, never both

The request must not be able to supply both an existing `caseId` and
competing inline case fields. The API accepts a discriminated union:

```text
case:
  { kind: "existing", caseId: string }
  | { kind: "new", ...normalized M5 CreateCaseInput }
```

- `kind: "existing"` — the server loads the case by ID and treats its
  already-validated, already-immutable M5 content as canonical (M5 cases
  have no update API, so a resolved case's content cannot have drifted
  since it was saved). An unknown/invalid ID is rejected before any freeze
  attempt.
- `kind: "new"` — the server runs the exact same authoritative M5
  case-creation validation and creates the case first (Decision 6), then
  proceeds to freeze.
- A request supplying both, or neither, branch's required fields is
  rejected as a structural validation error before any persistence.

**Stale-case avoidance:** because M5 cases are immutable once saved, the
only way a browser could freeze content the user no longer intends is if
the user edits the Charge Sheet *after* a successful `Save Case` and then
Convenes without saving again. The browser is responsible for tracking
whether setup state has changed since its last successful `Save Case`; if
it has, Convene sends `kind: "new"` (creating a fresh case row reflecting
the current fields) rather than reusing the now-stale `caseId`. If setup
state is unchanged since the last save, Convene sends `kind: "existing"`
with that `caseId`. This tracking/branch-selection is browser-side UX
logic only — it is not authoritative; the server always independently
validates whichever branch it receives.

### 8. Idempotency: same-key/same-payload reuse, same-key/different-payload conflict

A repeated `client_request_id` must not silently do the wrong thing.
Locked contract:

- **Same `client_request_id` + semantically identical normalized request**
  → return the existing run. No second case/run/config freeze occurs.
- **Same `client_request_id` + materially different normalized request**
  → reject with `HTTP 409`, stable error category `idempotency_conflict`.
  Never silently return an unrelated old run. Never create another run.

**Mechanism — server-computed deterministic fingerprint, not a new
dependency:** the server (ordinary Node code, not the database) computes a
SHA-256 digest (Node built-in `crypto`, no new dependency) over a
canonical JSON representation of:

- the *resolved* case identity — the `case_id` after Decision 7's branch is
  resolved (not raw case text; once resolved, a case's content is
  immutable, so its ID is a sufficient stable proxy for its content),
- `execution_mode`,
- for each of the seven participant keys, in the fixed canonical key order
  (`advocate-pro-1, advocate-pro-2, advocate-con-1, advocate-con-2,
  judge-1, judge-2, judge-3`): normalized (trimmed) `profile_name`
  (empty string if absent), normalized `personality_text`,
  `personality_source`, normalized `personality_source_filename` (empty
  string if absent), normalized `model_id`,
- the current application-owned `prompt_version` value (Decision 9) — this
  is currently a constant, but is included so a future real prompt-version
  bump naturally changes the fingerprint rather than silently colliding
  with a pre-existing idempotency key.

Canonical form: keys in the fixed order above, object keys within each
participant entry alphabetically sorted, stable `JSON.stringify` (no
whitespace ambiguity), UTF-8 encoded, then SHA-256 hex digest.

The browser is never authoritative for the fingerprint — it only supplies
`client_request_id` (a fresh UUID generated once per Convene attempt/retry
cycle) and the underlying setup fields; the server computes the
fingerprint itself before calling the freeze function. The fingerprint is
integrity metadata, not a secret, and is stored on `tribunal_runs.request_fingerprint`
(`text NOT NULL`) so the freeze function can perform the
conflict-or-reuse check atomically, in the same transaction as the insert,
against a stored value rather than trusting a client-supplied one.

Function behavior: look up an existing row by `client_request_id`; if
found and `request_fingerprint` matches → return the existing run (no
insert); if found and it differs → raise a distinguishable exception that
the calling Netlify function maps to `HTTP 409 idempotency_conflict`; if
not found → insert the new run + seven configs with this fingerprint.

### 9. `prompt_version` placeholder — configuration-stage only, not execution-eligible

No real prompts exist before M7 (`ARCHITECTURE.md` §6's
`src/prompts/versions.ts` is not implemented yet). M6 writes one fixed,
version-controlled, application-owned placeholder constant (e.g.
`PROMPT_VERSION_PLACEHOLDER = "unassigned-pre-m7"`) identically to all
seven rows, written by the freeze function itself (never a caller
parameter — see Decision 5).

Explicit semantics, locked now so they are not missed later:

- The placeholder is application-owned and never user/import-controlled.
- A run frozen with the pre-M7 placeholder is a **configuration-stage M6
  record**. It is **not** execution-eligible.
- **M8 must never execute a run whose `prompt_version` is still the
  pre-M7 placeholder.** This is a forward-looking gate M8's design must
  include; M6 does not implement it, but records the requirement here so
  it is not silently assumed away.
- Once real versioned prompts exist (M7), *newly* accepted runs receive
  the real application-owned prompt version at freeze time. Historical M6
  runs (including live-smoke-test runs created before M7 exists) are
  **never** mutated to backfill a real prompt version — that would violate
  the immutability contract (Decision 5/§8.3.1) for no product benefit.
- **`READY` in M6 means "accepted/frozen configuration" only.** It does
  **not** by itself mean "safe/eligible for model execution." Preflight
  and execution eligibility (including the prompt-version gate above)
  remain a separate, later (M7/M8) gate layered on top of `READY`, not
  redefined by it.

### 10. Temporary post-Convene UX (M6 only)

The current mock `Convene Tribunal` button navigates to
`/demo/deliberation?scenario=running`. M6 performs zero model calls, so
that navigation — which implies a deliberation is in progress — would be
actively misleading once Convene is wired to the real freeze endpoint.

Locked temporary M6 UX (React implementation is out of scope for this
planning task; this is the contract a later implementation task must
follow):

```text
Review
  → Convene Tribunal (disabled while request is pending)
  → real POST /api/runs
  → accepted/frozen READY configuration
  → remain on Review
  → success state: "Tribunal configuration frozen. Model execution is
    not enabled yet." (plus the run ID, if useful for debugging/audit)
```

- No navigation to `/demo/deliberation` on success.
- No fabricated advocate/judge/progress/result content of any kind.
- Duplicate activation is disabled client-side as UX, but the server-side
  idempotency contract (Decision 8) remains the actual control, exactly as
  already established for `Save Case`.

`docs/ui-spec.md` gets a narrowly-scoped M6 transitional note recording
this, because its existing Review section describes Convene as "the last
human gate before cost-bearing execution" — true from M8 onward, not yet
true in M6.

### 11. `modelId` — conservative structural validation, no semantic catalog check

**Corrected wording** from the first version of this ADR, which used the
vague phrase "safe character set." Locked conservative contract:

- string, trimmed, non-empty
- bounded length (generous enough for real OpenRouter IDs, which commonly
  look like `provider/model-name:variant` and may contain `/`, `-`, `.`,
  `:`, `~`)
- reject control characters and line breaks (`\n`, `\r`, `\0`, other C0
  control characters)
- **no** semantic/catalog validation — M6 has no live model-catalog
  authority; that is explicitly M7's job

Selectable values continue to come from the existing frontend mock model
catalog established in M4 (`src/mocks/tribunalMockData.ts`) until M7
replaces it with `GET /api/models`. Mock model IDs remain acceptable
input for M6's structural validator.

## Consequences

- `participant_configs`/`tribunal_runs` land with the exact columns M6
  needs, not a speculative superset; M8/M10 add their columns via their own
  forward migrations.
- A `SECURITY DEFINER` function is a materially new, higher-trust Supabase
  access pattern relative to M5 (which only ever used simple single-table
  `insert`/`select` under ordinary `service_role` grants). It is
  documented explicitly, narrowly scoped, and is the *only* place either
  new table can be written, rather than one of several possible paths.
- No `UPDATE`/`DELETE` grant exists for either table under any role,
  including `service_role`; immutability is structural. `service_role`
  additionally has no `INSERT` — the freeze function is the sole write
  path, which is the property that actually makes "exactly seven" a
  database-enforced guarantee rather than a convention.
- Case creation and run/config freezing are two separate, sequential
  operations with two different atomicity guarantees: the case insert is
  ordinarily atomic on its own (nothing new); only the run+seven-configs
  insert (plus the idempotency check) is guaranteed atomic together. A
  case can legitimately end up persisted without a corresponding frozen
  run, and that is an accepted, understood outcome, not a bug.
- The case request contract, idempotency fingerprint, and post-Convene UX
  are now precisely specified enough to implement without further
  invention.
