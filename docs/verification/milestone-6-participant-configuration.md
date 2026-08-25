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
| 6 | *(this commit)* | `docs: record Milestone 6 pre-live verification` |

Commits 1–3 are the pre-existing planning gate (out of scope for this
implementation pass, listed here only for a complete branch history).
Commits 4–5 are this implementation pass.

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
   either. `service_role` is granted `SELECT` only on both — no direct
   `INSERT`/`UPDATE`/`DELETE` for any role, including `service_role`.

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
- Attempts `INSERT` into `tribunal_runs` directly (not `SELECT`-then-`INSERT`)
  inside a `begin…exception when unique_violation…end` block. The
  `UNIQUE(client_request_id)` constraint is what arbitrates a concurrent
  identical submission; exactly one caller wins.
- On a win: inserts exactly 7 rows into `participant_configs` in a loop,
  deriving `role`/`side` from a fixed internal `CASE` mapping of
  `participant_key` (never accepted as caller parameters — `role`, `side`,
  and `prompt_version` are not present at all in the function's parameter
  list) and writing the literal `prompt_version` placeholder
  `'unassigned-pre-m7'` itself. Any failure in this loop (e.g. a `CHECK`
  violation) propagates and rolls back the *entire* invocation, including
  the just-inserted run row — the function can never leave 1 run +
  1–6 participant rows.
- On a loss: re-selects the existing run by `client_request_id` and compares
  `request_fingerprint`. A match returns the existing run (idempotent replay
  of a lost response); a mismatch raises `idempotency_conflict` with
  `errcode = 'P0001'`, surfaced by the server as `409`.

`EXECUTE` is revoked from `public`/`anon`/`authenticated` and granted only to
`service_role`, in the same migration that creates the function.

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
  only when the built request actually changed since the last attempt.

## Tests

12 test files, 99 tests, all passing:

```text
netlify/functions/health.test.ts          (2)
netlify/server/supabase.test.ts           (3)
netlify/server/importParsers.test.ts      (6)
netlify/server/runs.test.ts               (26)
netlify/functions/import.test.ts          (5)
netlify/functions/cases.test.ts           (8)
netlify/functions/runs.test.ts            (13)
src/app/App.test.tsx                      (4)
src/features/deliberation/deliberation.test.tsx (5)
src/features/results/result.test.tsx      (6)
src/features/history/history.test.tsx     (4)
src/features/case-setup/caseSetup.test.tsx (19)
```

(84 tests existed before this milestone; 15 are new to M6: 26 in
`netlify/server/runs.test.ts` and 13 in `netlify/functions/runs.test.ts`
replace/add to the prior fingerprint/validation/persistence gap, and 8 new
Convene scenarios were added to `caseSetup.test.tsx`.)

`netlify/server/runs.test.ts` — fingerprint determinism (identical input,
case-identity change, existing-vs-new distinction, personality/model/
execution-mode change each change the digest, participant order does not,
empty optional fields normalize deterministically); `validateCreateRunInput`
(valid Shared/Separate, missing/duplicate/unknown-eighth participant key,
caller-supplied `role`/`side`/`promptVersion` rejected, `profileName`/
`personality` bounds, personality source/filename cross-field rules,
`modelId` 1/256/257-char boundaries, control characters/DEL rejected,
Shared-mode model mismatch rejected, malformed case union, invalid `caseId`,
extra structural top-level fields rejected); `validateRunId` (valid/invalid
UUID).

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

`caseSetup.test.tsx` (8 new Convene tests) — successful freeze stays on
Review with the exact expected request shape; Convene disables while pending
and after success without re-arming; a saved case is reused via
`case.kind: "existing"`; a case edited after saving is resubmitted as
`case.kind: "new"`; server `409` and `400` responses are both shown honestly
without navigating away.

## Automated verification

```text
npm run lint        PASS
npm run typecheck   PASS
npm run test        PASS (12 files, 99 tests)
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
"Migration" section above for the underlying detail) — recorded here as an
explicit checklist:

- [x] Neither M5 migration (`20260825000000_create_cases.sql`,
      `20260825204419_fix_cases_source_filename_check.sql`) is modified —
      `git diff origin/main...HEAD` touches neither file.
- [x] Exactly one new migration file.
- [x] No `chr(0)`/NUL-construction expression anywhere (`grep -n "chr("`
      matches only comments documenting its deliberate absence).
- [x] RLS enabled on both `tribunal_runs` and `participant_configs`.
- [x] No `create policy` for either table — no browser/public policy.
- [x] `service_role` has `SELECT` only on both new tables — no
      `INSERT`/`UPDATE`/`DELETE` grant to any role, including
      `service_role`, on either table.
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
task.** No `supabase db push` or equivalent was run. Real Supabase live
smoke testing of this schema/RPC is therefore explicitly **NOT VERIFIED**
and is out of scope for this task by instruction.

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

## Remote state

Pushed to `origin/milestone/06-participant-configuration` after this
evidence commit; local `HEAD` and remote branch `HEAD` match exactly. A PR
to `main` was opened after this push, titled explicitly to make clear it is
**not** ready to merge — see the PR body for the full `DO NOT MERGE` gate
list. It was not merged. Issue #9 remains open. `main` was not touched.
