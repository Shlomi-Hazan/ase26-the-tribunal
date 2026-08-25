# ADR 0002 - Participant Configuration Freeze (Milestone 6)

## Status

Accepted (planning gate, corrected twice after independent review)

## Context

Milestone 6 must persist and freeze the complete seven-participant Tribunal
run configuration independently of real model execution. `ARCHITECTURE.md`
already sketches `tribunal_runs` and `participant_configs`, but that sketch
predates Milestone 5's `profileName` field and three-value personality
source taxonomy, uses a different participant-identifier convention than
the one actually established in application code, includes several
execution/economics columns that are not M6 concerns, and does not specify
how "exactly seven participant configs per run" is enforced atomically.

A first independent review found the original draft overstated the atomic
boundary, under-specified the freeze function's privilege model, used
imprecise participant-identifier wording, and left idempotency-conflict,
case-request, and post-Convene UX semantics undefined. That revision fixed
those.

A **second** independent review found one remaining design contradiction:
the idempotency fingerprint fingerprinted the *resolved/generated*
`case_id`, but for `case.kind = "new"` that UUID is created **before** the
freeze — so a legitimate retry of an identical request (e.g. after a lost
HTTP response) would create a second case row with a new UUID, producing a
*different* fingerprint and an incorrect `409 idempotency_conflict` for
what should have been a transparent, safe retry. That review also found
two stale internal `Decision N` cross-references (§5's own text pointed to
the wrong decision numbers for the idempotency check and the prompt-version
placeholder) and requested precision fixes to the database-role wording and
the `model_id` length bound. This revision fixes all of that and
renumbers every decision consistently; every `Decision N` reference below
has been re-verified to point at its actual current section.

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
`case_id`, `client_request_id`, `request_fingerprint` (see Decision 11),
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

### 5. Personality source ↔ filename cross-field contract at freeze time

The freeze path re-validates the same source-metadata cross-field rules
Milestone 5 already established, rather than trusting whatever the browser
supplied:

- `personality_source = manual` → `personality_source_filename` **must**
  be null/absent.
- `personality_source = individual_file` → `personality_source_filename`
  is **required** and must be a safe `.txt`/`.md` filename.
- `personality_source = tribunal_package` → `personality_source_filename`
  is **required** and must be a safe package `.txt`/`.md` filename.

"Safe filename" uses the same rules already established for `cases` in
Milestone 5 (`netlify/server/cases.ts` `fileSourceFilenameSchema`, mirrored
from the import boundary's `sanitizeFilename`): trimmed, non-empty,
`<=255` characters, not `"."` or `".."`, no `/` or `\`, no NUL, and a
`.txt`/`.md` extension. A participant entry whose `personality_source` and
`personality_source_filename` are structurally inconsistent is rejected
before persistence — the freeze path does not persist a browser-supplied
combination merely because it was supplied.

### 6. Freeze is a `SECURITY DEFINER` function that is the *only* write path

**Corrected in the first review** from an original draft that called for a
plain (non-`SECURITY DEFINER`) function alongside an ordinary `INSERT`
grant to `service_role`. That combination is self-defeating: if
`service_role` can `INSERT` directly, server code (buggy or otherwise) can
create a partial run or a `participant_configs` row set that isn't exactly
seven, bypassing the freeze function entirely. The corrected model:

**Table grants** (`public.tribunal_runs`, `public.participant_configs`):

- `service_role`: `SELECT` only. **No** `INSERT`/`UPDATE`/`DELETE` grant.
- `anon`, `authenticated`, `PUBLIC`: no direct table write authority at
  all.
- RLS enabled on both tables; no public/browser policy.

**Precise database-role wording** (corrected in the second review — "no
role" is too broad for PostgreSQL, since table/function *owners* and
administrative roles necessarily retain ownership authority regardless of
grants, and a `SECURITY DEFINER` function executes with its *owner's*
privileges, not the caller's):

- No **application-facing** role (`service_role`, `anon`, `authenticated`,
  `PUBLIC`) receives direct `INSERT`/`UPDATE`/`DELETE` on either table.
- `service_role` — the only role application/server code ever authenticates
  as — receives `SELECT` only on both tables.
- The function's **owner** (an administrative/superuser-equivalent role,
  not an application-facing one) necessarily has the privileges the
  `SECURITY DEFINER` function needs to perform its narrowly-scoped insert.
  That ownership authority is never itself an application call path — no
  server code, browser code, or public API ever authenticates as the
  function owner.
- This does not weaken the RPC-only write invariant: the *only* way
  application/server code can cause a row to be written to either table is
  by calling the function as `service_role`, which can `EXECUTE` it but
  cannot bypass it.

**Freeze function** (name/signature to be finalized at implementation
time, not in this planning task):

- Declared `SECURITY DEFINER` for the reason above.
- `SET search_path = ''` in the function definition, so no unqualified
  identifier can resolve against an unexpected schema.
- Every referenced table/function/type is fully schema-qualified
  (`public.tribunal_runs`, `public.participant_configs`, …).
- No dynamic SQL (no `EXECUTE`-with-string-concatenation); no
  user-controlled identifiers of any kind.
- Smallest possible parameter contract: `case_id`, `client_request_id`,
  `request_fingerprint` (computed by the *calling server code* per
  Decision 11 — the function only compares/stores it, never derives it),
  `execution_mode`, and a fixed-shape array/JSON of exactly the
  participant-specific fields the caller may vary (`participant_key`,
  `profile_name`, `personality_text`, `personality_source`,
  `personality_source_filename`, `model_id`). The caller **cannot** pass
  `role`, `side`, or `prompt_version` as free-form parameters — the
  function derives `role`/`side` internally from a fixed mapping of the
  seven known `participant_key` values (so a caller cannot, by bug or
  otherwise, assign `advocate-pro-1` a `CON` side) and writes the one
  application-owned `prompt_version` placeholder itself (see Decision 12).
- Independently re-validates that the input contains exactly the seven
  known `participant_key` values, no duplicates, no unknown keys, and the
  personality-source/filename cross-field contract (Decision 5) —
  defense-in-depth behind the application's own Zod validation, which
  remains authoritative for user-facing error messages.
- Performs the idempotency check (Decision 11) and the insert in the same
  implicit transaction: either the complete run + seven configs are
  visible, or a conflict/duplicate is reported and nothing new is written.
  A failed freeze never leaves a partial `tribunal_runs` row or a
  `participant_configs` row count other than 0 or 7 for that run. This is
  the *final* atomic authority — the ordinary application-code pre-check
  in Decision 10 step E is an optimization only, never trusted as the race
  guard.
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

### 7. Case persistence is an independent, non-atomic predecessor step

**Corrected in the first review** from an original draft that implied case
creation happened "within the same atomic acceptance" as the run/config
freeze. It does not, and should not: a case has been an independently
valid, independently persistable M5 entity since Milestone 5 (`Save Case`
already ships as its own action with its own endpoint), and folding case
creation into the freeze transaction would mean the freeze function must
also own case validation/creation — expanding its blast radius for no
real benefit.

The locked contract:

- If Convene needs to create a case (Decision 8 defines exactly when), the
  server resolves/creates it **before** invoking the freeze function
  (precise ordering in Decision 10), using the unchanged M5 case-creation
  path (`validateCreateCaseInput` / `SupabaseCaseRepository.create`),
  extended only by the idempotent get-or-create wrapper in Decision 9.
- The hard atomic invariant (`SECURITY DEFINER` function, single implicit
  transaction) applies specifically and only to **`tribunal_runs` +
  exactly seven `participant_configs` rows**.
- If case creation/resolution succeeds but the subsequent freeze call
  fails (e.g. a same-key/different-payload idempotency conflict at the run
  level, or an unexpected server error), the resolved case **remains
  persisted**. This is acceptable and intentional: it is a legitimately
  valid, independently useful M5 case (it will already appear in Past
  Cases), not an orphaned or partial record of anything. A retried
  Convene reuses that same case (Decision 9) rather than creating a
  duplicate.
- Case creation is never moved into the freeze function merely to claim a
  broader atomic boundary than the invariant actually requires.

### 8. Case request contract — one unambiguous branch, never both

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
  case-creation validation, then resolves the case idempotently (Decision 9)
  before proceeding to freeze.
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

### 9. Convene-created cases are themselves idempotent

**New in the second review**, closing the gap that motivated it. A
`kind: "new"` Convene request must not create a second case row on a
legitimate retry (e.g. the freeze succeeded but the HTTP response was
lost, and the browser retries the identical request). It also must not let
a genuinely different `kind: "new"` request that happens to reuse a
`client_request_id` silently attach to someone else's case.

**Schema addition (planned for the future M6 forward migration on
`cases`, not created in this task):** `cases.convene_request_id` — nullable
`text`, `UNIQUE` when non-null (ordinary PostgreSQL `UNIQUE` semantics: any
number of `NULL` rows remain allowed, since `NULL <> NULL`). Standalone M5
`Save Case` continues to create rows with `convene_request_id = NULL`,
unaffected. Convene's `kind: "new"` path sets
`convene_request_id = client_request_id`. This column is internal
persistence metadata; it is **not** added to the public
`StoredCase`/browser response shape — the M5 case repository already
selects an explicit column list rather than `select *`
(`netlify/server/cases.ts` `caseSelectColumns`), so it is excluded by
construction, not by an extra filtering step.

**Get-or-create behavior**, using the *existing* M5 `cases` grants
(`service_role`: `SELECT` + `INSERT`, no `UPDATE`/`DELETE` — unchanged, see
Decision 14) — no new database function is needed for this step, only for
the run/config freeze in Decision 6:

1. Attempt an ordinary `INSERT` of the normalized case fields with
   `convene_request_id = client_request_id`.
2. If it succeeds, that row's ID is the resolved `case_id`.
3. If it fails on the `UNIQUE(convene_request_id)` constraint (Postgres
   unique-violation, SQLSTATE `23505`) — meaning a case already exists for
   this exact Convene request, most likely a retry — `SELECT` that
   existing row by `convene_request_id` and compare its canonical
   persisted content (`defendant`, `act`, `exact_question`, `source_type`,
   `source_filename`) against the current normalized `kind: "new"`
   request:
   - **identical** → reuse that exact case ID.
   - **different** → reject with `HTTP 409 idempotency_conflict`; do
     **not** modify the existing case; do **not** proceed to freeze.
4. The existing case row is **never** `UPDATE`d by this flow (consistent
   with `service_role` never holding `UPDATE` on `cases` at all).
5. No second case is ever created for the same valid Convene request ID.

**Race-safety:** two simultaneous, identical `kind: "new"` Convene
submissions for the same `client_request_id` are safe by construction —
`UNIQUE(convene_request_id)` is enforced by Postgres itself, so exactly
one concurrent `INSERT` wins; the other observes a unique-violation and
falls through to the compare-and-reuse step above. Neither request needs
to wait for or coordinate with the other beyond what the constraint
already guarantees. No `DELETE` path is required or introduced.

### 10. Server request order

Locked processing order for the run-acceptance boundary:

```text
A. strict request validation
B. resolve canonical semantic case input
     existing -> load case, no write
     new      -> validate normalized case fields, do not create yet
C. normalize the seven participant configs
D. compute the semantic request fingerprint (Decision 11) --
     BEFORE any case creation, from the canonical case input in B,
     never from a generated/resolved case UUID
E. optional, non-authoritative pre-check: if an obviously matching
     client_request_id result already exists, this MAY short-circuit
     as an optimization -- it is never trusted as the final race guard
F. resolve/create the case idempotently (Decision 9), now that the
     fingerprint no longer depends on this step's outcome
G. call the freeze function with case_id (from F), client_request_id,
     request_fingerprint (from D), execution_mode, and the seven
     participant entries
H. the freeze function (Decision 6) remains the final atomic authority
     for: client_request_id uniqueness, fingerprint match/conflict,
     the run insert, and the exactly-seven config inserts
```

Step D happening before step F is the entire fix: the fingerprint is
computed from the *semantic* case input (an existing `caseId`, or the
new case's normalized fields), never from a case UUID that does not yet
exist at fingerprinting time. The freeze function (H) remains race-safe
even if two server invocations pass step E's ordinary pre-check
concurrently, because H's conflict/reuse decision is made atomically
inside the same transaction as the insert, exactly as already established
in Decision 6.

### 11. Idempotency: semantic fingerprint, same-key/same-payload reuse, same-key/different-payload conflict

**Corrected in the second review.** The original fingerprint used the
*resolved* `case_id` — the UUID generated when a `kind: "new"` case is
created. Because that case is created before the freeze (Decision 7), a
legitimate retry of an identical request (e.g. the freeze succeeded but
the HTTP response was lost) could not deterministically reproduce the same
`case_id` input to the fingerprint calculation without first re-resolving
the case — and if case resolution itself weren't idempotent (fixed by
Decision 9), a retry would mint a *second* case UUID, changing the
fingerprint and incorrectly triggering `409 idempotency_conflict` for what
should have been a transparent, safe retry.

**Corrected mechanism:** the server (ordinary Node code, computed at
Decision 10 step D, before any case creation) computes a SHA-256 digest
(Node built-in `crypto`, no new dependency) over a canonical JSON
representation of:

- the **canonical case portion**, not a generated ID:
  - for `kind: "existing"`: `{ kind: "existing", caseId: <normalized,
    validated UUID> }`
  - for `kind: "new"`: `{ kind: "new", defendant, act, exactQuestion,
    sourceType, sourceFilename }` — the same normalized fields Decision 9
    uses for its content-equality check, normalized exactly as the
    existing M5 `CreateCaseInput` schema already normalizes them (trimmed;
    `sourceFilename` represented consistently, e.g. `null` when absent,
    never sometimes-`null`/sometimes-`""`)
- `execution_mode`,
- for each of the seven participant keys, in the fixed canonical key order
  (`advocate-pro-1, advocate-pro-2, advocate-con-1, advocate-con-2,
  judge-1, judge-2, judge-3`): normalized (trimmed) `profile_name` (empty
  string if absent), normalized `personality_text`, `personality_source`,
  normalized `personality_source_filename` (empty string if absent),
  normalized `model_id`,
- the current application-owned `prompt_version` value (Decision 12) —
  currently a constant, but included so a future real prompt-version bump
  naturally changes the fingerprint rather than silently colliding with a
  pre-existing idempotency key.

Canonical form: keys in the fixed order above, object keys within each
entry alphabetically sorted, stable `JSON.stringify` (no whitespace
ambiguity), UTF-8 encoded, then SHA-256 hex digest.

The browser is never authoritative for the fingerprint — it only supplies
`client_request_id` (a fresh UUID generated once per Convene attempt/retry
cycle) and the underlying setup fields; the server computes the
fingerprint itself, before case resolution, and passes it into the freeze
function. The fingerprint is integrity metadata, not a secret, and is
stored on `tribunal_runs.request_fingerprint` (`text NOT NULL`) so the
freeze function can perform the conflict-or-reuse check atomically, in the
same transaction as the insert, against a stored value rather than
trusting a client-supplied one.

**Locked contract:**

- **Same `client_request_id` + same semantic fingerprint** → the existing
  run is returned; no second run/config set is created; the same
  Convene-created case (Decision 9) is reused. This now correctly covers
  the lost-response retry case described above.
- **Same `client_request_id` + different semantic fingerprint** → `HTTP
  409`, stable error category `idempotency_conflict`; no new run/config
  set is created; an unrelated old run is never silently returned.
- For `kind: "new"` specifically, a same-`client_request_id` conflict may
  surface at either of two points, both resulting in the same external
  `409 idempotency_conflict`: at case resolution (Decision 9, if the
  normalized new-case content itself differs from what was already stored
  under that `convene_request_id`), or at the freeze function (Decision 6,
  if the case content matched but the participant/model configuration
  differs, since the fingerprint covers both).

Freeze-function behavior (unchanged in substance from the first review,
now operating on the corrected fingerprint input): look up an existing row
by `client_request_id`; if found and `request_fingerprint` matches →
return the existing run (no insert); if found and it differs → raise a
distinguishable exception the calling Netlify function maps to `HTTP 409
idempotency_conflict`; if not found → insert the new run + seven configs
with this fingerprint.

### 12. `prompt_version` placeholder — configuration-stage only, not execution-eligible

No real prompts exist before M7 (`ARCHITECTURE.md` §6's
`src/prompts/versions.ts` is not implemented yet). M6 writes one fixed,
version-controlled, application-owned placeholder constant (e.g.
`PROMPT_VERSION_PLACEHOLDER = "unassigned-pre-m7"`) identically to all
seven rows, written by the freeze function itself (never a caller
parameter — see Decision 6).

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
  the immutability contract (Decision 6) for no product benefit.
- **`READY` in M6 means "accepted/frozen configuration" only.** It does
  **not** by itself mean "safe/eligible for model execution." Preflight
  and execution eligibility (including the prompt-version gate above)
  remain a separate, later (M7/M8) gate layered on top of `READY`, not
  redefined by it.

### 13. Temporary post-Convene UX (M6 only)

The current mock `Convene Tribunal` button navigates to
`/demo/deliberation?scenario=running`. M6 performs zero model calls, so
that navigation — which implies a deliberation is in progress — would be
actively misleading once Convene is wired to the real freeze endpoint.

Locked temporary M6 UX (React implementation is out of scope for this
planning task; this is the contract a later implementation task must
follow):

```text
Review
  -> Convene Tribunal (disabled while request is pending)
  -> real POST /api/runs
  -> accepted/frozen READY configuration
  -> remain on Review
  -> success state: "Tribunal configuration frozen. Model execution is
     not enabled yet." (plus the run ID, if useful for debugging/audit)
```

- No navigation to `/demo/deliberation` on success.
- No fabricated advocate/judge/progress/result content of any kind.
- Duplicate activation is disabled client-side as UX, but the server-side
  idempotency contract (Decision 11) remains the actual control, exactly
  as already established for `Save Case`.

`docs/ui-spec.md` carries a narrowly-scoped M6 transitional note recording
this, because its existing Review section describes Convene as "the last
human gate before cost-bearing execution" — true from M8 onward, not yet
true in M6.

### 14. `cases` table grants remain unchanged; `modelId` structural validation is precisely bounded

**`cases` grants:** the future M6 forward migration adds only
`convene_request_id` to `cases` (Decision 9). It does not alter the
existing Milestone 5 privilege model: `service_role` keeps `SELECT` +
`INSERT` only (no `UPDATE`/`DELETE`); `anon`/`authenticated` keep no direct
access; RLS remains enabled. `convene_request_id` is never exposed in an
M5 public API response (Decision 9).

**`modelId` structural validation — corrected wording** from an original
draft that used the vague phrase "safe character set," then further
tightened to an exact bound in the second review (a "generous bounded
length" was not implementation-ready). Locked conservative contract:

- string, trimmed
- minimum **1** character, maximum **256** characters
- reject C0 control characters (`0x00`–`0x1F`, including `\n`, `\r`, NUL)
  and `DEL` (`0x7F`)
- otherwise **no** allowlist regex — `/`, `-`, `.`, `:`, `~` (all common in
  real OpenRouter IDs such as `provider/model-name:variant`) remain valid
- **no** semantic/catalog validation — M6 has no live model-catalog
  authority; that is explicitly M7's job

Selectable values continue to come from the existing frontend mock model
catalog established in M4 (`src/mocks/tribunalMockData.ts`) until M7
replaces it with `GET /api/models`. Mock model IDs remain acceptable
input for M6's structural validator.

## Consequences

- `participant_configs`/`tribunal_runs` land with the exact columns M6
  needs, not a speculative superset; M8/M10 add their columns via their own
  forward migrations. `cases` gains exactly one new nullable column
  (`convene_request_id`); no other M5 schema/grant changes.
- A `SECURITY DEFINER` function is a materially new, higher-trust Supabase
  access pattern relative to M5 (which only ever used simple single-table
  `insert`/`select` under ordinary `service_role` grants). It is
  documented explicitly, narrowly scoped, and is the *only* place either
  new table can be written, rather than one of several possible paths. No
  new database function is needed for case idempotency — an ordinary
  insert-then-fallback-select pattern under the existing `cases` grants is
  sufficient and race-safe by construction.
- No **application-facing** role has `UPDATE`/`DELETE` on either new
  table, and `service_role` additionally has no `INSERT` — the freeze
  function is the sole write path, which is the property that actually
  makes "exactly seven" a database-enforced guarantee rather than a
  convention. Administrative/ownership authority required to define such
  a function is not itself an application call path.
- Case creation/resolution and run/config freezing are two separate,
  sequential operations with two different atomicity guarantees: case
  resolution is idempotent and race-safe on its own (Decision 9); only the
  run+seven-configs insert (plus its idempotency check) is guaranteed
  atomic together (Decision 6). A case can legitimately end up persisted
  without a corresponding frozen run, and that is an accepted, understood
  outcome, not a bug.
- Computing the idempotency fingerprint from the *semantic* case input
  (never a generated case UUID) and resolving the case idempotently before
  the freeze together make a lost-response retry of an identical request
  transparently safe: same run returned, same case reused, nothing
  duplicated.
