# ADR 0002 - Participant Configuration Freeze (Milestone 6)

## Status

Accepted (planning gate)

## Context

Milestone 6 must persist and freeze the complete seven-participant Tribunal
run configuration independently of real model execution. `ARCHITECTURE.md`
already sketches `tribunal_runs` and `participant_configs`, but that sketch
predates Milestone 5's `profileName` field and three-value personality
source taxonomy, uses a different participant-identifier convention than
the one actually established in application code, includes several
execution/economics columns that are not M6 concerns, and does not specify
how "exactly seven participant configs per run" is enforced atomically.

This ADR locks the M6-specific decisions needed to implement unambiguously.

## Decisions

### 1. Participant-key convention

Use the application's existing `ParticipantId` convention already
established in `src/schemas/tribunalSetup.ts` since Milestone 4/5
(`advocate-pro-1`, `advocate-pro-2`, `advocate-con-1`, `advocate-con-2`,
`judge-1`, `judge-2`, `judge-3`), not `ARCHITECTURE.md`'s stale
`PRO_1`/`CON_1`/`JUDGE_1`-style examples. That style is the Milestone 5
**Tribunal Package seat identifier** — a distinct, narrower namespace used
only for parsing the `TRIBUNAL_PACKAGE_V1` file format — not the
application's internal participant identity. Conflating the two namespaces
in the database schema would require an unnecessary translation layer
throughout M6-M11.

### 2. Minimal `tribunal_runs` columns now; execution/economics columns deferred

M6 creates only what accepting/freezing a configuration needs: `id`,
`case_id`, `client_request_id`, `execution_mode`, `status`, `created_at`.

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

### 5. Atomic "exactly seven" enforcement via one Postgres function

Supabase's REST Data API executes one statement per request; there is no
cross-table transaction available to application code without a database
function. Because "exactly seven participant configs, immutable once
frozen" is a hard, non-negotiable product invariant (`SPEC.md` §14, `ARGS.md`
Tribunal Invariants), M6 defines one `SECURITY DEFINER`-free PL/pgSQL
function (invoked via `supabase.rpc(...)`) that, in a single implicit
Postgres transaction:

1. validates the input carries exactly seven entries with exactly the seven
   known participant keys (defense-in-depth backing the application's own
   Zod validation, which runs first and is authoritative for user-facing
   error messages);
2. inserts the `tribunal_runs` row;
3. inserts exactly seven `participant_configs` rows;
4. returns the accepted run.

If any step fails, the whole operation rolls back — no partial run is ever
visible. This is a genuinely new Supabase access pattern relative to M5
(which only ever used simple single-table `insert`/`select`), which is why
it is recorded here rather than assumed silently.

**Alternative considered and rejected for M6:** a simpler
insert-run-as-pending → insert seven rows → update-run-to-`READY` sequence
using only ordinary single-table calls, accepting a small window where a
mid-sequence failure leaves an orphaned non-`READY` run row. Rejected
because M6 already needs a `service_role` grant plan, and getting true
atomicity is cheap (one small function) — there is no reason to accept a
weaker guarantee for a hard invariant the rest of the project treats as
non-negotiable.

### 6. Convene creates the case inline if not already saved

`ARCHITECTURE.md` §7.4 describes `POST /api/runs` accepting "case and seven
participant configurations" without saying whether "case" is inline fields
or a reference to an already-`Save Case`d M5 row. M5 shipped `Save Case` as
an independent, separately-triggered action; the core product flow
(`INTENT.md` §5, `docs/ui-spec.md` §4) never requires a distinct
"save the case" step before Convene.

Decision: the Convene (`POST /api/runs`) boundary accepts the case fields
directly. Server-side, within the same accept operation: if the browser
already holds a `caseId` from a prior `Save Case` call, that case is reused
(existence is still authoritatively re-validated); otherwise the server
creates the case first, using the exact same validated M5 case-creation
path (`validateCreateCaseInput`), before creating the run. The user is
never required to click "Save Case" separately before Convening — it
remains available as an independent convenience.

### 7. `prompt_version` placeholder

No real prompts exist before M7 (`ARCHITECTURE.md` §6's
`src/prompts/versions.ts` is not implemented yet). M6 writes one fixed,
version-controlled placeholder constant (e.g.
`PROMPT_VERSION_PLACEHOLDER = "unassigned-pre-m7"`) identically to all
seven rows. This satisfies the column's `NOT NULL` contract and the
product requirement that each participant config record the prompt version
used, without inventing real prompt content prematurely.

### 8. `modelId` — structural validation only, sourced from the existing mock catalog

M6 does not verify a model ID against a real OpenRouter catalog (M7's
job). `modelId` is validated only for shape: non-empty, bounded length,
safe character set. Selectable values continue to come from the existing
frontend mock model catalog established in M4 (`src/mocks/tribunalMockData.ts`)
until M7 replaces it with `GET /api/models`.

## Consequences

- `participant_configs`/`tribunal_runs` land with the exact columns M6
  needs, not a speculative superset; M8/M10 add their columns via their own
  forward migrations.
- A new Supabase RPC/function access pattern is introduced; document and
  test it explicitly rather than let it fall out of ordinary single-table
  repository code.
- No UPDATE/DELETE grant exists for either table, which is both least
  privilege and a structural (not just procedural) immutability guarantee.
- Convene absorbs "save the case if needed," so the product flow never
  forces a redundant manual save step, while `Save Case` remains available
  standalone.
