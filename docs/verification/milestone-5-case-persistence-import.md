# Milestone 5 — Case Persistence & Import — Verification Evidence

> Recovery/continuation note: this milestone's implementation was started by a
> prior coding agent session (interrupted by expired usage credits) and
> completed/stabilized/verified by a second session. This document records
> the final, independently-verified state.

## Planning references

- Issue: [#7 — Milestone 5 — Case Persistence & Import](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/7)
- Branch: `milestone/05-case-persistence-import`
- Base (merge-base with `origin/main`): `a2704d1ee737123e9efc3a59294fb656ad077f5d`

## Commits on this branch

| # | SHA | Message |
|---|---|---|
| 1 | `7a754a4f2c2b3e6e9a09797f0dd579310a23572b` | `docs: define Tribunal package import strategy` |
| 2 | `55e40819e819e4471c500d0c54cff18dec7e5bb9` | `feat: implement deterministic Tribunal imports` |
| 3 | `8011abfb269d41e6d365062c606ad71e69595262` | `feat: persist Tribunal cases` |
| 4 | *(this evidence commit, recorded after commit)* | `docs: record Milestone 5 verification evidence` |

## Recovery: commit-history reconstruction

The prior session had left the import and persistence work as one interleaved,
uncommitted working tree (plus the already-committed documentation commit).
Several files contained both concerns in the same file (`ReviewPage.tsx`,
`caseSetup.test.tsx`, `netlify.toml`). Since this environment does not support
interactive `git add -p`/`-i`, the split was done by reconstructing an
intermediate "import-only" version of each mixed file (verified byte-for-byte
against the final version by diffing afterward), staging + committing that,
then restoring the persistence-only remainder as the second commit. Each
commit's exact file-system snapshot was validated in isolation with
`git stash push -u --keep-index` (moving every not-yet-staged/untracked file
out of the working tree) before running lint/typecheck/test/build against
that snapshot alone, so both commits are independently coherent, not just the
final combined state.

## Work recovered vs. repaired

Recovered as-is (already correct on inspection):
- shared `TribunalSetupDraft`/`ChargeSheet`/participant Zod schemas
- `setupState.ts` reducer — profile name and personality updates are already
  correctly isolated to their own fields (the two incidents the prior agent
  reported — a state/reducer collision and a profile-name-writes-into-
  personality bug — were independently re-verified and are **not** present in
  the final code)
- `cases` Supabase migration (DB CHECK constraints, RLS, no public policy)
- case repository authority boundary (browser never touches Supabase)

Repaired during this session (see next section for detail):
- `ImportValidationError` message wording
- base64 request-size guard (was missing entirely)
- a required-marker-vs-empty-value conflation in the deterministic parser
- five brittle test selectors/assertions
- an unhandled-exception/stack-trace-leak bug in the live `cases`/`case-by-id`
  Netlify functions (found via live manual testing, not by the existing
  unit tests, which inject the repository and bypass this code path)

## Repairs

1. **`ImportValidationError.message`** (`netlify/server/importParsers.ts`) —
   was hard-coded to `"Import validation failed."`, so `.toThrow(/regex/)`
   assertions against the specific reason always failed. Now
   `errors.join(" ")`; the structured `.errors` array (used by the HTTP JSON
   contract) is unchanged.
2. **Base64 request-size safety** (`netlify/server/importRequest.ts`,
   `netlify/functions/import-*.ts`) — `decodeBase64Content` previously decoded
   the full request body before any size check, so an arbitrarily large
   base64 string was fully allocated/decoded before the parser's byte-length
   check could reject it. `decodeBase64Content` now takes the endpoint's raw
   byte limit and rejects an oversized encoded payload
   (`Math.ceil(maxBytes / 3) * 4 + 4` chars) before calling `Buffer.from`. No
   new dependency. Verified live against the running Netlify function with a
   4&nbsp;MB payload → rejected immediately with
   `"Uploaded file exceeds 16 KiB."`
3. **Required-marker vs. empty-value conflation** (`parseMarkerFields`) — the
   required-field check treated "marker present but empty" the same as
   "marker missing," short-circuiting before the field-limit Zod schema could
   produce the approved user-facing wording (`docs/ui-spec.md` §17: *"Exact
   Question is required."*). The check now only verifies marker **presence**;
   emptiness/length are left to the schema layer, so both the standalone
   Charge Sheet import and the package's nested `[CHARGE_SHEET]` section
   produce the same field-named message.
4. **Test selector/assertion fixes** (`caseSetup.test.tsx`,
   `netlify/server/importParsers.test.ts`) — five tests were written against
   ambiguous/incorrect selectors once the personality-import file input
   (`aria-label="… personality import file"`) was added alongside the
   personality textarea (`label="… personality"`), which made unanchored
   `getByLabelText` regexes match both elements, and against MUI's rendered
   text-node concatenation for `<Typography>Prefix: {value}</Typography>`
   (`getByText("value")` doesn't match; the element's own text is
   `"Prefix: value"`). Fixed with `{ selector: "textarea" }` /
   substring-regex assertions rather than loosening the underlying UI.
5. **Unhandled server-config exception leaking a stack trace** (found via live
   `netlify dev` testing, see below) — `netlify/functions/cases.ts` and
   `case-by-id.ts` constructed `createSupabaseCaseRepository()` as a call
   argument, outside `handleCasesRequest`'s/`handleCaseByIdRequest`'s own
   `try/catch`. When Supabase env vars are absent, that constructor throws
   synchronously and the exception propagated past both try/catches,
   returning a raw stack trace (with local file paths) as the HTTP body
   instead of the safe `{ error: ... }` JSON contract. Fixed by wrapping the
   repository construction + delegation in the exported `handler` itself.
   Added a regression test that invokes the real exported `handler`s (not
   the injectable `handle*Request` used by the rest of the suite) and asserts
   the response is safe JSON, not a stack trace.

None of these repairs changed product behaviour described in `SPEC.md`; all
are either bug fixes or additional test coverage.

## Specification evolution (already present in the inherited documentation commit)

Confirmed present and internally consistent across `SPEC.md`,
`ARCHITECTURE.md`, `ROADMAP.md`, `SECURITY.md`, `docs/ui-spec.md`,
`docs/economics.md`, `docs/adr/0001-tribunal-package-import.md`:

- strict `TRIBUNAL_PACKAGE_V1` Full Tribunal Package format, fixed seats only
- optional `profileName` (≤120 chars, human-facing only, never role/side)
- fixed participant seats remain application-owned; package cannot set
  model/provider/side/execution-mode/budget/prompt-version
- package import is atomic and never auto-convenes the Tribunal
- `M7A — Smart Tribunal Package Extraction` present in `ROADMAP.md` between
  M7 and M8, with later milestones unrenumbered
- M7A's future one-call structured extraction is explicitly **not** one of
  the seven Tribunal participant logical calls, has no hard-coded lecturer
  dossier, and never auto-convenes

## Deterministic imports

| Import | Endpoint | Formats | Max size |
|---|---|---|---|
| Charge Sheet | `POST /api/import/charge-sheet` | `.txt`, `.md`, UTF-8 | 64 KiB |
| Personality | `POST /api/import/personality` | `.txt`, `.md`, UTF-8 | 16 KiB |
| Full Tribunal Package | `POST /api/import/tribunal-package` | `.txt`, `.md`, UTF-8 | 192 KiB |

Package grammar: `TRIBUNAL_PACKAGE_V1` header (exactly once) + `[CHARGE_SHEET]`
+ exactly `[PRO_1]`, `[PRO_2]`, `[CON_1]`, `[CON_2]`, `[JUDGE_1]`, `[JUDGE_2]`,
`[JUDGE_3]`, each with required `PERSONALITY:` and optional `PROFILE_NAME:`.
Unknown sections, duplicate sections/markers, and unsupported structural
fields (`MODEL:`, `SIDE:`, etc.) fail closed with a specific error and leave
existing setup state untouched (verified in
`imports a complete Tribunal package atomically…` and
`keeps existing setup state when a Tribunal package import fails`).

UI flow: Charge Sheet page (manual / Charge Sheet import / Full Tribunal
Package import) → package import navigates straight to Review with an
"Imported Tribunal package…" notice → human review/edit remains available →
explicit `Convene Tribunal` (still routed to the existing M4 mock
`/demo/deliberation` route; no real execution exists yet, per scope).

## Persistence

- Migration: `supabase/migrations/20260825000000_create_cases.sql` —
  `cases` table, UUID PK, DB `CHECK` constraints for canonical Charge Sheet
  lengths and allowed `source_type` values, RLS enabled, no public browser
  policy.
- Source types: `MANUAL`, `CHARGE_SHEET_FILE`, `TRIBUNAL_PACKAGE_FILE`.
- API: `POST /api/cases`, `GET /api/cases`, `GET /api/cases/:id`, all via
  `netlify/server/cases.ts` (`SupabaseCaseRepository`, injectable
  `CaseRepository` interface used directly by tests).
- Client never imports Supabase or sees a service-role key (`grep` over
  `src/` is empty for both).
- `Save Case` is a distinct action from `Convene Tribunal`; only the case
  (Defendant/Act/Exact Question/source metadata) is durable in M5 — no
  participant/run/output/protocol/economics table exists yet.
- History (`/history`) and Case Detail (`/cases/:id`) read real stored cases
  only; neither fabricates verdict, status, speeches, reasoning, model, or
  cost. Existing M4 mock demo routes (`/demo/deliberation`, `/demo/result`)
  are untouched.

## Tests

10 test files, 52 tests, all passing:

```text
netlify/functions/health.test.ts        (2)
netlify/server/supabase.test.ts         (3)
netlify/server/importParsers.test.ts    (6)
netlify/functions/import.test.ts        (5)
netlify/functions/cases.test.ts         (6)
src/app/App.test.tsx                    (5)
src/features/deliberation/deliberation.test.tsx (5)
src/features/results/result.test.tsx    (6)
src/features/history/history.test.tsx   (5)
src/features/case-setup/caseSetup.test.tsx (13)
```

Coverage highlights against the required matrix: Charge Sheet (valid txt/md,
missing/duplicate marker, empty section, over-limit Defendant/Act/Question,
unsupported extension, oversize, invalid UTF-8); personality (valid/empty/
over-limit/unsupported-extension/oversize/invalid-UTF-8); Full Tribunal
Package (valid with/without profile names, over-limit profile name, missing
header/duplicate header/missing or duplicate section, missing advocate/judge,
missing vs. empty vs. over-limit personality, unknown section, unsupported
structural field, invalid nested Charge Sheet, unsupported extension,
oversize, invalid UTF-8, exactly seven canonical seats, model/side/mode
rejected); UI (Charge-Sheet-only import touches only the case, personality
import touches only the target seat, atomic package import fills all seven
seats + notice + Review navigation, execution mode/model assignment
unchanged, invalid package leaves state untouched, no auto-run); cases API
(create/list/get, invalid Defendant/Act/Exact-Question/source-type/filename,
unknown-id 404, browser-supplied id/createdAt/raw-bytes rejected, safe error
response even when repository construction itself throws).

## Database verification

- Migration reviewed against the required `cases` contract (§13 of the
  recovery brief) — matches, plus the recommended DB `CHECK` constraints.
- Fake/injected repository tests: `netlify/functions/cases.test.ts` exercises
  the full HTTP contract (`handleCasesRequest`/`handleCaseByIdRequest`) with
  an injected in-memory `FakeCaseRepository`, independent of live
  infrastructure.
- **Live Supabase persistence smoke test: NOT VERIFIED — environment not
  configured.** No `.env`, no `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are
  present in this environment. Confirmed honestly by exercising the real
  `netlify dev` function against the missing config: it correctly produced
  `ServerConfigError` rather than a fabricated success (and, after the fix
  above, returns that as safe JSON rather than a stack trace).

## Manual UI review

- **Desktop layout** (Vite dev server, `1280`-class viewport): Charge Sheet,
  Advocates, and Review screens visually reviewed — 3 charge-sheet fields,
  four fixed advocate cards with profile-name/personality/import controls,
  Review's case summary/execution mode/7-participant grid/economics/privacy
  warning/Save Case+Convene actions all render as specified.
- **Mobile layout** (375×812 preset): Charge Sheet screen reviewed — stepper
  stacks to one column, fields remain full-width and readable, no horizontal
  overflow.
- **Import/persistence flow through the browser**: partially verified. This
  sandbox's browser tool proxies `netlify dev` (port 8888) in a way that
  serves module scripts (e.g. `/src/main.tsx`) with `content-type: text/html`
  instead of `text/javascript` — confirmed by `curl -I` returning `text/html`
  through the proxy vs. `text/javascript` hitting Vite directly on port 5173
  — which blocks the browser's module loader specifically in this sandboxed
  preview, independent of any code in this diff (the underlying
  `netlify.toml` SPA catch-all predates this milestone). Because of that, the
  actual click-through of file upload → import → Review → Save Case →
  History could not be captured as browser screenshots in this session.
  Instead, the same real `netlify dev` Netlify Functions (port 8888,
  identical code path a browser would hit) were exercised directly:
  - `docs/examples/tribunal-package-v1.txt` uploaded via `POST
    /api/import/tribunal-package` → correct normalized draft with all seven
    seats and profile names.
  - Malformed package (`[PRO_3]`) → `400 {"errors":["Unknown package section
    [PRO_3]."]}`.
  - 4 MB base64 personality payload → rejected immediately with `"Uploaded
    file exceeds 16 KiB."` (confirms the new request-size guard).
  - `POST/GET /api/cases`, `GET /api/cases/:id` → safe JSON error (not a
    stack trace) with Supabase unconfigured, confirming repair #5 above.
  - `GET /api/health` → sanity baseline, unaffected.
  This is real evidence against the live server boundary, not mocks, but it
  is not the same as a human-observed browser click-through — recorded
  honestly rather than claimed as a full pass.

## Verification commands run

```text
npm run lint        PASS
npm run typecheck   PASS
npm run test        PASS (10 files, 52 tests)
npm run build       PASS
npm run verify:client-bundle   PASS (no secret in client bundle)
npm run verify      PASS (full chain)
npm audit --omit=dev --audit-level=high   0 vulnerabilities
git diff --check origin/main...HEAD       clean
```

Both the import commit and the persistence commit were additionally verified
**in isolation** (via `git stash push -u --keep-index` around each commit) —
lint/typecheck/test/build all pass at each commit individually, not only at
the combined branch tip.

No dependency was added or changed (`package.json`/`package-lock.json` diff
against `origin/main` is empty).

## Known limitations

- Live Supabase persistence is unverified in this environment (see above).
- Full browser click-through of the import/persistence flow is unverified in
  this sandbox's `netlify dev` proxy (see above); the equivalent server
  behaviour was verified directly against the same running functions.
- The production build emits a pre-existing "chunk larger than 500 kB"
  warning (single-bundle Vite output); not a regression from this milestone
  and not addressed here.
- `netlify dev` treats every `*.test.ts` file under `netlify/functions/` as a
  function definition (a warning, e.g. `Function name 'cases.test' is
  invalid`); this convention predates M5 (`health.test.ts` already existed
  since M3) and was left as-is rather than restructured mid-milestone.
- Case list ordering is `created_at desc` with no explicit tiebreaker for
  identical timestamps; acceptable for this milestone's scope.

## Explicit scope confirmation

Verified by `grep`/`git diff` over the full branch diff against
`origin/main`:

- no OpenRouter implementation or API call
- no model call of any kind
- no PDF/DOCX parser, no OCR
- no AI/LLM smart extraction
- no live OpenRouter model catalog
- no real economics/cost engine (Review's economics card remains explicitly
  labeled mock/fixture data, unchanged from M4)
- no Tribunal background worker or real execution
- no participant/run/output/protocol persistence (only `cases`)
- no lecturer-specific fixture or hard-coded dossier (only the neutral
  "Alex Rowan" example, matching M4's existing mock convention)
- no deployment changes
- no authentication
- no M6/M7/M7A/M8 implementation (M7A is documented only, inherited from the
  prior documentation commit)
- `package.json`/`package-lock.json` unchanged — no new dependency

## Remote state

Pushed to `origin/milestone/05-case-persistence-import` after this evidence
commit; local `HEAD` and remote branch `HEAD` match exactly (recorded in the
push output below rather than duplicated here to avoid staleness).

No pull request was opened. Issue #7 remains open. `main` was not touched.
