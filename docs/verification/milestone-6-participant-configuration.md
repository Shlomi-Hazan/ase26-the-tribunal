# Milestone 6 — Participant Configuration — Verification Evidence

## Planning references

- Issue: [#9 — Milestone 6 — Participant Configuration](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/9)
- Design contract: `docs/adr/0002-participant-configuration-freeze.md` (planning
  gate, corrected twice after independent review before implementation began)
- Branch: `milestone/06-participant-configuration`
- Branch start / merge-base with `origin/main`: `79b83f904291c2a785869f46c26f625917cd54e3`
- `origin/main` at implementation time: `fece1e159dff7e18fb53d186564cfb298d4ae6eb`

## Commits on this branch (planning + implementation)

| # | SHA | Message |
|---|---|---|
| 1 | `113e2b3…` | `docs: define Milestone 6 participant configuration contract` |
| 2 | `9c1be58…` | `docs: harden Milestone 6 freeze contract` |
| 3 | `79b83f9…` | `docs: finalize Milestone 6 idempotency contract` |
| 4 | `4bee58f…` | `feat: add Tribunal configuration persistence` |
| 5 | `a33edf4…` | `feat: wire Tribunal configuration freeze` |
| 6 | `73a6ea9…` | `docs: record Milestone 6 pre-live verification` |
| 7 | `2a2eb32…` | `fix: harden Milestone 6 freeze boundary` |
| 8 | *(this commit)* | `docs: correct Milestone 6 pre-live evidence` |

Commits 1–3 are the pre-existing planning gate (out of scope for this
implementation pass, listed here only for a complete branch history).
Commits 4–6 are the implementation pass. Commits 7–8 are this narrow
pre-live correction pass (see "Pre-live correction pass" below).

## Scope implemented

Review → explicit `Convene Tribunal` → authoritative server-side
validation → idempotent case resolution → immutable run/configuration
freeze → `READY` → remains on Review. No model/OpenRouter call exists
anywhere in this scope.

## Migration (NOT applied to any real database in this task)

`supabase/migrations/20260825214212_participant_configuration.sql` — one
new forward migration, created via
`npx supabase@2.115.0 migration new participant_configuration`. Neither
existing, already-applied M5 migration
(`20260825000000_create_cases.sql`,
`20260825204419_fix_cases_source_filename_check.sql`) is modified;
`git diff origin/main...HEAD -- supabase/migrations/2026082500*` is empty.

1. `cases.convene_request_id` — nullable `text`, `unique` constraint. Standard
   PostgreSQL `UNIQUE` semantics allow unlimited `NULL`s, so standalone M5
   `Save Case` (which always writes `NULL` here) is unaffected. No other
   `cases` column, constraint, RLS setting, or grant changes; `cases`' public
   API response shape (`caseSelectColumns` in `netlify/server/cases.ts`) does
   not include this column.
2. `tribunal_runs` — `id`, `case_id` (FK to `cases`), `client_request_id`
   (`unique`), `request_fingerprint` (`CHECK ~ '^[0-9a-f]{64}$'`),
   `execution_mode` (`CHECK` in `SHARED`/`SEPARATE`), `status` (`CHECK`
   against the full `SPEC.md` §14 vocabulary — M6 itself only ever writes
   `READY`), `created_at`.
3. `participant_configs` — `id`, `run_id` (FK), `participant_key` (`CHECK` in
   the 7 known internal `ParticipantId`s only — the M5 Tribunal Package seat
   grammar `PRO_1`/`CON_1`/`JUDGE_1`/… is never persisted here),
   `role`/`side` (`CHECK`, plus a table-level
   `participant_configs_role_side_consistency` mapping each of the 7 keys to
   its exact fixed role+side), `profile_name` (nullable, 1–120 chars when
   present), `personality_text` (1–4,000 trimmed chars), `personality_source`
   (`manual`/`individual_file`/`tribunal_package`),
   `personality_source_filename` (nullable; required exactly when the source
   isn't `manual`; safe-filename rules mirroring the M5-fixed pattern:
   1–255 chars, not `.`/`..`, no `/`\`, `.txt`/`.md` extension),
   `model_id` (1–256 chars, rejects C0 control characters and DEL),
   `prompt_version`, `created_at`. `UNIQUE(run_id, participant_key)`.
4. `freeze_participant_configuration(...)` — a single `SECURITY DEFINER`
   `plpgsql` function, the sole write path for both new tables (see below).
5. RLS is enabled on both new tables; no browser/public policy is created on
   either. `service_role` is granted `SELECT` only on both — **no
   application-facing role has direct `INSERT`/`UPDATE`/`DELETE` authority**
   on either table (precise wording: the function/table owner necessarily
   retains ownership authority, which is what `SECURITY DEFINER` runs as;
   that owner/admin authority is not an application authentication path —
   no server or browser code ever authenticates as it. The freeze RPC is
   the sole *application* write path.)

No `chr(0)`/NUL-construction expression appears anywhere in this migration —
`grep -n "chr(" supabase/migrations/20260825214212_*.sql` matches only three
comment lines that document its deliberate absence, never an actual
expression — the exact defect this project already hit and fixed in M5
(`20260825204419_fix_cases_source_filename_check.sql`).

## Cases idempotency (new-case Convene branch)

`IdempotentCaseRepository.createIdempotent(input, conveneRequestId)`
(`netlify/server/cases.ts`) inserts with `convene_request_id` set; on a
`23505` unique-violation specifically on that column it falls back to
`SELECT … WHERE convene_request_id = …` and compares the stored case's
content against the request. Matching content returns the existing case
(idempotent replay of a lost HTTP response); mismatched content throws
`IdempotencyConflictError` → `409`. Insert-first, not select-then-insert —
race-safe by construction, matching the DB `UNIQUE` constraint that
arbitrates concurrent identical requests.

## Freeze RPC (sole write path, race-safe, atomic)

`freeze_participant_configuration` is `security definer`,
`set search_path = ''`, every object reference fully schema-qualified
(`public.tribunal_runs`, `public.participant_configs`), no dynamic SQL.

- Validates `execution_mode`, fingerprint format
  (`^[0-9a-f]{64}$`), that `p_participants` is a JSON array of exactly 7
  elements, and that its `participant_key`s are exactly the 7 known keys
  (sorted-array-equality check) with no duplicates and no unknown key.
- **Independently enforces the Shared-mode model_id invariant at the DB
  layer** (pre-live correction — see "Independent pre-live review
  findings" below): before any row is written, every participant's
  `model_id` is extracted from the JSONB array via `jsonb_array_elements`
  and `btrim(elem ->> 'model_id')`, and rejected with `errcode = '22023'`
  if it is missing/null, blank, or fails the same 1–256-char/no-C0-or-DEL
  bound as `participant_configs_model_id_check`. When
  `p_execution_mode = 'SHARED'`, the function additionally requires
  `count(distinct model_id) = 1` across all seven — a caller cannot bypass
  this by calling the RPC directly, only by having already-validating
  Netlify code in front of it. `SEPARATE` mode carries no equality
  requirement, only the per-participant structural check. No model
  catalog/OpenRouter validation is performed.
- Attempts `INSERT` into `tribunal_runs` directly (not `SELECT`-then-`INSERT`)
  inside a `begin…exception when unique_violation…end` block. The
  `UNIQUE(client_request_id)` constraint is what arbitrates a concurrent
  identical submission; exactly one caller wins. The `INSERT` targets
  `public.tribunal_runs as new_run` and its `RETURNING new_run.id` is
  alias-qualified rather than a bare `RETURNING id` — see "Independent
  pre-live review findings" below for why a bare reference is unsafe here.
- On a win: inserts exactly 7 rows into `participant_configs` in a loop,
  deriving `role`/`side` from a fixed internal `CASE` mapping of
  `participant_key` (never accepted as caller parameters — `role`, `side`,
  and `prompt_version` are not present at all in the function's parameter
  list) and writing the literal `prompt_version` placeholder
  `'unassigned-pre-m7'` itself. `profile_name`, `personality_text`,
  `personality_source_filename`, and `model_id` are `btrim()`-normalized
  before insertion — the Netlify Zod layer remains the user-facing
  authoritative normalizer, but the RPC is the sole write path and should
  not persist an obviously non-normalized (leading/trailing/whitespace-only)
  value if ever invoked directly. This is ordinary text trimming, unrelated
  to and not a substitute for the C0-control-character/`chr(0)` handling
  discussed elsewhere. Any failure in this loop (e.g. a `CHECK`
  violation) propagates and rolls back the *entire* invocation, including
  the just-inserted run row — the function can never leave 1 run +
  1–6 participant rows.
- On a loss: re-selects the existing run by `client_request_id` and compares
  `request_fingerprint`. A match returns the existing run (idempotent replay
  of a lost response); a mismatch raises `idempotency_conflict` with
  `errcode = 'P0001'`, surfaced by the server as `409`.

`EXECUTE` is revoked from `public`/`anon`/`authenticated` and granted only to
`service_role`, in the same migration that creates the function.

## Independent pre-live review findings (this correction pass)

This section records, honestly and without hiding it, what an independent
pre-live review found and what was corrected — **before** the migration was
ever applied to any real database (see "Remote Supabase status" below; it
still has not been applied at the time of this correction).

1. **Shared-mode model_id invariant was enforced only in TypeScript.** The
   Netlify Zod layer (`validateCreateRunInput`'s `.superRefine`) already
   rejected a Shared request whose seven model IDs differed, but
   `freeze_participant_configuration` — the function that is deliberately
   the *sole* structural write path — did not independently enforce the
   same invariant, so a direct RPC caller (bypassing ordinary server code)
   could have written inconsistent Shared-mode rows. **Corrected** by
   adding the DB-level check described above, in the still-unapplied
   migration, before any row is written (`errcode = '22023'`, an
   input/validation-style SQLSTATE, never an idempotency conflict).
2. **A `RETURNING id INTO v_new_run_id` identifier-ambiguity risk.** The
   function is declared `RETURNS TABLE (id uuid, case_id uuid,
   client_request_id text, execution_mode text, status text, created_at
   timestamptz)`, which makes each of those names a PL/pgSQL
   output-parameter variable in scope for the whole function body.
   PostgreSQL's default `plpgsql.variable_conflict = 'error'` (confirmed
   against the current PostgreSQL documentation, not assumed — see
   [plpgsql-implementation.html](https://www.postgresql.org/docs/current/plpgsql-implementation.html))
   raises `column reference "id" is ambiguous` at execution time for a
   bare `RETURNING id` in this situation, because `id` could refer to
   either that output variable or `tribunal_runs.id`. **Corrected** by
   qualifying the insert with a table alias — `INSERT INTO
   public.tribunal_runs AS new_run (...) ... RETURNING new_run.id INTO
   v_new_run_id` — confirmed valid, current PostgreSQL syntax against
   [sql-insert.html](https://www.postgresql.org/docs/current/sql-insert.html)
   (`INSERT INTO table_name [ AS alias ]`; `RETURNING` may reference that
   alias). Every other SQL statement in the function was inspected for the
   same class of collision (`id`, `case_id`, `client_request_id`,
   `execution_mode`, `status`, `created_at`) — all others already qualify
   every table-column reference via the `tr.` alias
   (`FROM public.tribunal_runs AS tr`) or via `v_existing.<field>`
   record-field access (which is inherently unambiguous — there is no
   competing table/alias in that no-`FROM` `SELECT`), so no further change
   was needed.
3. **`CasePersistenceError` was unmapped in `runErrorResponse`,** so a
   genuine cases-table failure during run acceptance (existing-case
   lookup, idempotent new-case insert, or its idempotent fallback SELECT)
   fell through to the generic `run_request_failed` category instead of
   the stable `run_persistence_failed` one `RunPersistenceError` already
   gets. **Corrected** in `netlify/server/runResponses.ts` — see "Case
   persistence error mapping" below.
4. **`SupabaseRunRepository.loadRun()` returned participants in
   database-return order,** which PostgreSQL does not promise without an
   explicit `ORDER BY` (none was applied). **Corrected** by sorting into
   the canonical `participantIds` application order before the run ever
   becomes a public response — see "Participant read ordering" below.
5. **Stale mock-era Review copy.** `ReviewPage.tsx` still read *"This is
   the final mock review gate before the UI-only deliberation route"* and
   *"Mock Tribunal cannot be convened yet"* even though Convene now
   performs a real persistent M6 freeze. **Corrected** — see "Review copy"
   below.

None of these five findings required any change to the two already-applied
M5 migrations, to the fingerprint contract, to the idempotency semantics
already approved for the freeze RPC, or to any M7/M7A/M8 scope.

## Server request validation (`POST /api/runs`)

`netlify/server/runs.ts` — `validateCreateRunInput` reuses M5's case-source
validation (`toCaseFingerprintInput` calls the exported
`createCaseInputSchema`/`fileSourceFilenameSchema` from `cases.ts` for the
`kind: "new"` case branch) and layers a `z.discriminatedUnion("kind", …)` on
top for `existing` (a validated case UUID) vs. `new` (full case fields). Each
of the 7 participant objects is a `z.strictObject` (via a
`z.discriminatedUnion("personalitySource", …)` mirroring `cases.ts`'s
personality-source pattern) exposing only `participantId`, `profileName`,
`personality`, `personalitySource`, `personalitySourceFilename`, `modelId` —
`role`/`side`/`promptVersion` are not fields in the schema at all, so a
caller cannot supply them; `strictObject` additionally rejects any other
unknown key. A top-level `.superRefine` enforces that Shared-Model Mode
requires all 7 `modelId`s to be identical.

## Semantic fingerprint

`computeRequestFingerprint` — Node built-in `crypto.createHash("sha256")`
(no new dependency) over a canonical JSON string (sorted object keys, fixed
`ParticipantId` array order) built from `toCaseFingerprintInput` (canonical
case identity: the existing `caseId`, or the new case's normalized
`defendant`/`act`/`exactQuestion`/`sourceType`/`sourceFilename` — **never** a
generated/resolved case UUID, since that UUID does not exist yet when a new
case's fingerprint is computed) plus `toParticipantFingerprintInputs`
(normalized participant fields) plus `executionMode`. Computed at step D of
`acceptRun`'s processing order, strictly before case resolution/creation at
step F — this is the fix from the final M6 planning-consistency-correction
commit (`79b83f9…`), verified still in effect by the
`distinguishes an existing case from an equivalent-looking new case` and
`changes when the case identity changes` fingerprint tests.

## Run API

- `POST /api/runs` → `acceptRun` (steps A–H: validate → resolve case input →
  normalize participants → compute fingerprint → optional pre-check →
  resolve/create case → call the freeze RPC, which is the final authority →
  map to response) → `201` with `{ run: … }`, or a mapped error (`400
  invalid_run`/`404 case_not_found`/`409` idempotency conflict/`500`).
- `GET /api/runs/:id` → `{ run: … }` or `404`.
- `toRunResponse` (`netlify/server/runResponses.ts`) excludes
  `request_fingerprint`, `convene_request_id`, and `client_request_id` from
  every response — none are part of the documented public contract, and the
  fingerprint in particular is never returned to the browser.
- **Case persistence error mapping (pre-live correction).**
  `runErrorResponse` now imports and maps `CasePersistenceError` (from
  `netlify/server/cases.ts`) to the same stable `500
  run_persistence_failed` category as `RunPersistenceError`, instead of
  letting it fall through to the generic `run_request_failed`. This is the
  category a genuine cases-table/database failure during `acceptRun` step
  F (existing-case lookup, idempotent new-case insert, or its idempotent
  fallback SELECT) must reach — `case_not_found` (missing case, `404`) and
  `idempotency_conflict` (`409`) are unaffected and still take priority via
  their own dedicated error types. No raw Supabase/Postgres detail is ever
  exposed either way.
- **Deterministic participant read order (pre-live correction).**
  `SupabaseRunRepository`'s `loadRun` no longer trusts
  `participant_configs`' database-return order (PostgreSQL makes no such
  promise without an explicit `ORDER BY`, and none is applied). The newly
  exported pure function `sortParticipantsCanonically` (`netlify/server/
  runs.ts`) sorts the loaded participants into the fixed canonical
  `participantIds` application order — the same order used for fingerprint
  computation, the freeze RPC's known-key check, and the UI — before a run
  is ever returned publicly. Implemented as an exported, independently
  unit-testable pure function rather than a speculative DB ordering column
  for a seven-row, sort-in-memory case.
- `RunRepository`/`SupabaseRunRepository` (real) and an in-memory
  `FakeRunRepository`/`FakeIdempotentCaseRepository` pair (tests) follow the
  same fakeable-repository pattern M5 established for `CaseRepository`.
- Routes wired via `netlify.toml` (`/api/runs`, `/api/runs/:id`), with
  repository construction wrapped in the exported `handler`'s own
  `try/catch` (the M5 stack-trace-leak fix pattern), not left as a bare
  constructor call outside it.

## Saved-case identity / Convene UI (`ReviewPage.tsx`, `setupState.ts`)

- `SavedCaseIdentity`/`recordSavedCase`/`isSavedCaseCurrent` — a saved case
  is reused (`case.kind: "existing"`) only while the currently displayed
  Charge Sheet and source metadata still exactly match what was actually
  saved; any edit to those fields (including a fresh Charge Sheet or Full
  Tribunal Package import, both of which already update
  `chargeSheet`/`caseSource`) makes it stale automatically, with no separate
  invalidation action. Participant/personality/model edits never affect it.
  Both `Save Case` and a successful `Convene Tribunal` (for a newly created
  case) record this identity.
- Convene builds the request from setup state (case branch, execution mode,
  7 participants — Shared mode always sends the one shared model for every
  participant regardless of each participant's individually stored
  `modelId`), calls `convene()`, and on success **remains on Review**,
  disables the button (no re-arm after success — the accepted run state is
  retained), and shows *"Tribunal configuration frozen. Model execution is
  not enabled yet."* plus the run id. It never navigates to
  `/demo/deliberation` or any fabricated deliberation route. A `409`/`400`
  server response is shown honestly and the button re-arms so the user can
  retry.
- Client `client_request_id` lifecycle: a `useRef`-held id/snapshot pair is
  reused across a retry of the identical semantic submission and regenerated
  only when the built request actually changed since the last attempt. Two
  dedicated tests now prove this explicitly (see "Tests" below): retrying
  an unchanged submission after an ambiguous/network failure sends the same
  `clientRequestId`, and retrying after materially editing the Charge Sheet
  sends a fresh one.
- **Review copy corrected (pre-live correction).** Removed the stale
  mock-era copy *"This is the final mock review gate before the UI-only
  deliberation route"* and *"Mock Tribunal cannot be convened yet"* — both
  predated real persistence and were misleading now that Convene performs
  an actual freeze. Replaced with *"Review the case and seven-participant
  configuration before freezing it"* and *"Tribunal configuration cannot be
  frozen yet."* The explicitly-labeled mock economics preflight is
  unchanged and still honestly labeled mock/fixture data (real OpenRouter
  pricing is M7 scope). No copy implies model execution occurs, and Convene
  still never navigates to `/demo/deliberation`.

## Tests

The test breakdown recorded in this document's initial (pre-correction)
version was inaccurate. The table below is corrected against the exact
count from the last CI run **before** this correction pass, then shows what
this correction pass added.

| File | Before this pass | Added | After this pass |
|---|---|---|---|
| `netlify/functions/health.test.ts` | 2 | — | 2 |
| `netlify/server/supabase.test.ts` | 3 | — | 3 |
| `netlify/server/importParsers.test.ts` | 6 | — | 6 |
| `netlify/server/runs.test.ts` | 25 | +3 (`sortParticipantsCanonically`) | 28 |
| `netlify/functions/import.test.ts` | 5 | — | 5 |
| `netlify/functions/cases.test.ts` | 8 | — | 8 |
| `netlify/functions/runs.test.ts` | 13 | +2 (`CasePersistenceError` mapping) | 15 |
| `src/app/App.test.tsx` | 4 | — | 4 |
| `src/features/deliberation/deliberation.test.tsx` | 5 | — | 5 |
| `src/features/results/result.test.tsx` | 5 | — | 5 |
| `src/features/history/history.test.tsx` | 4 | — | 4 |
| `src/features/case-setup/caseSetup.test.tsx` | 19 | +2 (client_request_id lifecycle) | 21 |
| **Total** | **99** | **+7** | **106** |

**12 test files, 106 tests, all passing** — verified by an actual local run
of `npm run test` in this session (not carried forward from memory), listed
test-by-test with `vitest run --reporter=verbose` and cross-checked against
this table. The prior version of this document additionally claimed "84
tests existed before this milestone; 15 are new to M6" — that specific
84/15 split was not derived from Git history and is retracted rather than
repeated; the verified-correct total immediately before this correction
pass was 99 (per the table above), not re-derived further back.

New this correction pass:

- `netlify/server/runs.test.ts` — `sortParticipantsCanonically`: normalizes
  a shuffled persisted participant array into canonical
  `advocate-pro-1…judge-3` order; does not mutate its input array; is
  idempotent on already-canonical input.
- `netlify/functions/runs.test.ts` — a genuine cases-table failure during
  the existing-case lookup maps to `500 run_persistence_failed` (not the
  generic `run_request_failed`); the same for a genuine cases-table failure
  during idempotent new-case creation.
- `src/features/case-setup/caseSetup.test.tsx` — retrying an *unchanged*
  submission after an ambiguous/network failure sends the same
  `clientRequestId`; retrying after a *materially edited* (Charge Sheet)
  resubmission sends a fresh `clientRequestId`.

Carried forward from the implementation pass:

`netlify/server/runs.test.ts` — fingerprint determinism (identical input,
case-identity change, existing-vs-new distinction, personality/model/
execution-mode change each change the digest, participant order does not,
empty optional fields normalize deterministically); `validateCreateRunInput`
(valid Shared/Separate, missing/duplicate/unknown-eighth participant key,
caller-supplied `role`/`side`/`promptVersion` rejected, `profileName`/
`personality` bounds, personality source/filename cross-field rules,
`modelId` 1/256/257-char boundaries, control characters/DEL rejected,
Shared-mode model mismatch rejected — **note: this specific test proves
only the TypeScript/Zod-level rejection; the newly added DB-level Shared
invariant inside the freeze RPC has not yet been exercised against a real
Postgres engine, see "Migration security inspection" below** —, malformed
case union, invalid `caseId`, extra structural top-level fields rejected);
`validateRunId` (valid/invalid UUID).

`netlify/functions/runs.test.ts` — valid accept returns `READY` with no
internal metadata (`fingerprint`/`convene_request_id`/`client_request_id`)
leaked; role/side derived correctly and independent of request participant
order; `404` for a referenced case that doesn't exist; same-key/same-payload
retry reuses the existing run (lost-response retry); same-key/
different-config retry → `409 idempotency_conflict`; a lost-response retry of
a **new**-case request reuses the same Convene-created case; same-key/
different-new-case-content retry → `409`; malformed JSON/non-POST handled
safely; safe JSON error (no stack trace) when server config is missing; an
explicit assertion that no OpenRouter/model `fetch` call occurs anywhere in
the accept path; `GET /api/runs/:id` success/404/400.

`caseSetup.test.tsx` (8 Convene tests from the implementation pass) —
successful freeze stays on Review with the exact expected request shape;
Convene disables while pending and after success without re-arming; a saved
case is reused via `case.kind: "existing"`; a case edited after saving is
resubmitted as `case.kind: "new"`; server `409` and `400` responses are both
shown honestly without navigating away.

## Automated verification

```text
npm run lint        PASS
npm run typecheck   PASS
npm run test        PASS (12 files, 106 tests)
npm run build       PASS
npm run verify:client-bundle   PASS (no secret in client bundle)
npm run verify      PASS (full chain)
npm audit --omit=dev --audit-level=high   0 vulnerabilities
git diff --check origin/main...HEAD       clean
```

No dependency was added or changed (`computeRequestFingerprint` uses Node's
built-in `crypto`, not a new package); `package.json`/`package-lock.json`
diff against `origin/main` is empty.

## Migration security inspection (static, pre-apply)

Performed by direct reading of
`supabase/migrations/20260825214212_participant_configuration.sql` (see the
"Migration" and "Independent pre-live review findings" sections above for
the underlying detail) — recorded here as an explicit checklist. **This is
a static review of the SQL source, not an execution of it.** Normal
TypeScript fake-repository tests exercise the Netlify Zod validation layer
and the *shape* of the RPC's request/response contract, but they cannot
prove the real PL/pgSQL function's runtime behavior (that a bare
`RETURNING id` would actually raise `column reference "id" is ambiguous`,
or that the DB-level Shared-mode check actually rejects a mismatched
request against a real Postgres engine) — that is deferred to the live
Supabase gate, and this document does not claim otherwise.

- [x] Neither M5 migration (`20260825000000_create_cases.sql`,
      `20260825204419_fix_cases_source_filename_check.sql`) is modified —
      `git diff origin/main...HEAD` touches neither file.
- [x] Exactly one new migration file.
- [x] No `chr(0)`/NUL-construction expression anywhere (`grep -n "chr("`
      matches only comments documenting its deliberate absence).
- [x] RLS enabled on both `tribunal_runs` and `participant_configs`.
- [x] No `create policy` for either table — no browser/public policy.
- [x] `service_role` has `SELECT` only on both new tables — no
      application-facing role, including `service_role`, has a direct
      `INSERT`/`UPDATE`/`DELETE` grant on either table (the table
      owner/admin necessarily retains ownership authority, which is what
      `SECURITY DEFINER` runs as, but that authority is not an application
      authentication path).
- [x] **Shared-mode model_id equality is independently enforced inside the
      freeze function**, before any row is written, via
      `jsonb_array_elements` + `count(distinct btrim(model_id))`, with a
      `22023` (input/validation-style) SQLSTATE — not trusting that the
      Netlify Zod layer already checked it.
- [x] **Separate mode permits distinct model IDs** — the DB-level check
      above only applies the equality requirement when
      `p_execution_mode = 'SHARED'`; `SEPARATE` still gets the
      per-participant structural check (non-empty, 1–256 chars, no
      C0/DEL) but no equality constraint.
- [x] **The `INSERT ... RETURNING` in the race-safe insert block is
      alias-qualified** (`INSERT INTO public.tribunal_runs AS new_run (...)
      ... RETURNING new_run.id INTO v_new_run_id`), not a bare
      `RETURNING id` — avoiding the `RETURNS TABLE` output-parameter/
      column-name collision described in "Independent pre-live review
      findings" above. Every other SQL statement in the function was
      inspected for the same collision class (`id`, `case_id`,
      `client_request_id`, `execution_mode`, `status`, `created_at`) and
      already qualifies every reference.
- [x] Exactly seven participant keys are enforced (sorted-array-equality
      against the fixed canonical key list — no duplicates, no unknown
      eighth key).
- [x] `role`/`side` are derived internally via a fixed `CASE` mapping of
      `participant_key`, never accepted as caller parameters.
- [x] `prompt_version` is an application-owned literal
      (`'unassigned-pre-m7'`) written by the function itself, never
      accepted as a caller parameter.
- [x] Fingerprint format is validated (`^[0-9a-f]{64}$`) before use.
- [x] Atomic insert behavior: any failure while inserting the seven
      `participant_configs` rows propagates and rolls back the entire
      invocation, including the just-inserted `tribunal_runs` row.
- [x] `freeze_participant_configuration` is `security definer`.
- [x] `set search_path = ''` on the function.
- [x] Every object reference inside the function is schema-qualified
      (`public.tribunal_runs`, `public.participant_configs`).
- [x] No dynamic SQL (`execute` as a dynamic-SQL statement) inside the
      function.
- [x] `role`/`side`/`prompt_version` are not parameters of the function at
      all — derived internally, not caller-controlled.
- [x] `EXECUTE` revoked from `public`/`anon`/`authenticated`, granted only
      to `service_role`, in the same migration.
- [x] `cases` table grants/RLS/policies are unchanged (only a new nullable
      unique column + constraint is added).
- [x] `cases.convene_request_id` is not selected by `caseSelectColumns`
      (`netlify/server/cases.ts`) — never returned by any public case API
      response; confirmed by `grep -n "convene_request_id\|fingerprint" netlify/server/cases.ts netlify/server/caseResponses.ts netlify/server/runResponses.ts` (only appears in
      internal-repository code and in `runResponses.ts`'s own comment
      documenting the exclusion).
- [x] No secret, credential, project ref, or `.env` content appears in the
      migration or in this document.

**This migration has NOT been applied to any real Supabase database in this
task.** No `supabase db push` or equivalent was run. Read-only confirmation
via `npx supabase@2.115.0 migration list --linked` (a listing call, not a
schema-modifying one) shows both M5 migrations as `local == remote` and the
M6 migration with an **empty** `remote` field — i.e. not applied. Real
Supabase live smoke testing of this schema/RPC (including the two
corrections in this pass) is therefore explicitly **NOT VERIFIED** and is
out of scope for this task by instruction; the corrected migration is to
receive one more independent audit before remote application.

## Explicit scope confirmation

Verified by `grep`/reading over the full branch diff against `origin/main`:

- no OpenRouter implementation or API call anywhere (explicit test
  assertion in `netlify/functions/runs.test.ts`: `no OpenRouter/model call
  occurs anywhere in the accept path`)
- no speeches, verdicts, judge votes, or economics computation — `status`
  never leaves `READY` in this scope
- no Tribunal background worker or real execution
- no M7/M7A/M8 implementation
- the two existing, already-applied M5 migrations are byte-for-byte
  unchanged
- `main` was not touched; no merge occurred
- Issue #9 was not closed
- `package.json`/`package-lock.json` unchanged — no new dependency

## Known limitations

- Real Supabase live smoke testing of the M6 schema/RPC is unverified —
  explicitly out of scope for this task (migration not applied).
- Browser click-through of the Convene flow was not captured as screenshots
  in this session; the equivalent behavior was verified through the full
  automated test suite driving the real component tree
  (`renderWithAppProviders`/`AppRoutes`) with a mocked `fetch`, exercising
  the same client code path a browser would.
- The production build's pre-existing "chunk larger than 500 kB" warning is
  unchanged from M5 and not addressed here.
- The two SQL-level corrections in this pass (Shared-mode DB invariant,
  `RETURNING` alias qualification) are verified only by static reading and
  by the authoritative PostgreSQL documentation cited above — not by
  executing the function against a real Postgres engine. No disposable
  local Supabase/Postgres stack was available for this repository in this
  environment without provisioning new infrastructure (a local Supabase
  stack was running, but it belonged to an unrelated project on the same
  machine and was not used), so this remains deferred to the live gate,
  consistent with instruction for this task.

## Pre-live correction pass

An independent pre-live review of PR #10 (head `73a6ea9…` at the time of
review) found the five issues recorded in "Independent pre-live review
findings" above, all in the still-unapplied M6 migration and its
surrounding server code. All five were corrected **in place** in this
still-unapplied migration (not via a new remediation migration, since it
had not yet been applied anywhere) plus the corresponding server files.
Two further, non-bug hardening items were also applied alongside them: a
narrow defense-in-depth `btrim()` normalization of free-text
`participant_configs` fields inside the freeze RPC (see "Freeze RPC"
above), and two new tests making the already-approved client
`client_request_id` lifecycle explicit rather than only implicit in its
implementation (see "Saved-case identity / Convene UI" and "Tests" above).
Verified by the full automated suite (106 tests, up from 99), and recorded
here rather than hidden. See "Commits" in the PR/branch history for the
exact commit(s).

## Remote state

Pushed to `origin/milestone/06-participant-configuration` after this
correction pass's commits; local `HEAD` and remote branch `HEAD` match
exactly (see the PR for the exact SHA). PR #10 to `main` remains open,
still explicitly marked **not** ready to merge — see the PR body for the
full `DO NOT MERGE` gate list, updated to reflect this correction pass. It
was not merged. Issue #9 remains open. `main` was not touched. The M6
migration remains unapplied to any real Supabase database (confirmed via
the read-only `migration list --linked` check above).
