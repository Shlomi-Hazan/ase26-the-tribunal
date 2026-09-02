# The Tribunal — Project Roadmap

> **Course:** Agentic Software Engineering (ASE-26)
> **Rule:** Every milestone ends with verification evidence and a human merge gate.

## 0. Roadmap Principles

The project is intentionally built in layers. Each milestone should leave the repository in a coherent, recoverable state.

Standard milestone loop:

```text
Intent / approved scope
→ specification slice
→ clean Git checkpoint
→ branch
→ implementation plan
→ human approval
→ execution
→ automated verification
→ independent review where useful
→ PR
→ human merge gate
→ evidence
```

Global rule:

> **No gate, no merge.**

Do not begin later milestones by destabilizing incomplete earlier work.

---

## Milestone Status

| Milestone | Name | Status |
|---|---|---|
| 0 | Repository Bootstrap | ✅ Complete |
| 1 | Project Conception | ✅ Complete |
| 2 | Engineering Contract | ✅ Complete |
| 3 | Application Skeleton | ✅ Complete |
| 4 | UI Shell with Mock Data | ✅ Complete |
| 5 | Case Persistence & Import | ✅ Complete |
| 6 | Participant Configuration | ✅ Complete |
| 7 | OpenRouter Infrastructure | ✅ Complete |
| 7A | Smart Tribunal Package Extraction | ✅ Complete |
| 8 | Shared-Model Tribunal | ✅ Complete |
| 9 | Separate-Model Tribunal | ✅ Complete |
| 10 | Protocol & Economics | ✅ Complete |
| 11 | Past Cases & Auditability | ✅ Complete |
| 12 | Canonical Jon Snow Demo | 🟡 Current |
| 13 | Failure & Security Hardening | ⬜ Planned |
| 14 | UI Polish & Accessibility | ⬜ Planned |
| 15 | Production Deployment | ⬜ Planned |
| 16 | Final Verification & Course Audit | ⬜ Planned |

Milestone 2 becomes complete only after the engineering-contract PR containing all required documents is independently reviewed and merged.

---

# M0 — Repository Bootstrap ✅

## Goal

Create a clean repository before product implementation.

## Delivered

- Git repository
- GitHub repository
- `main`
- `.gitignore`
- `.env.example`
- README skeleton
- first clean commit

## Exit evidence

A reviewer can see a minimal root commit with no application code or secrets.

---

# M1 — Project Conception ✅

## Goal

Record the product purpose and constraints before implementation.

## Delivered

- `INTENT.md`
- `docs/conception/problem-statement.md`
- `docs/conception/stakeholders.md`
- `docs/conception/definition-of-done.md`
- `docs/conception/out-of-scope.md`
- `docs/conception/assumptions.md`

## Exit evidence

- conception reviewed independently
- review-driven corrections preserved in Git history
- PR merged with a normal merge commit

---

# M2 — Engineering Contract 🟡

## Goal

Convert product conception into a testable and reviewable engineering contract before code generation.

## Deliverables

- `SPEC.md`
- `ARCHITECTURE.md`
- `ROADMAP.md`
- `AGENTS.md`
- `CLAUDE.md`
- `SECURITY.md`
- `docs/ui-spec.md`
- `docs/economics.md`

## Supporting Reference

- `THE_TRIBUNAL_PROJECT_MASTER_PLAN.md` — comprehensive planning/history reference; not one of the eight focused engineering-contract documents and does not override later focused `INTENT.md`, `SPEC.md`, or `ARCHITECTURE.md` decisions.

## Decisions locked here

- canonical Charge Sheet contract
- strict participant output schemas
- Shared/Separate model execution semantics
- concurrent 4 → barrier → concurrent 3 execution
- retry/timeout policy
- deterministic majority/protocol
- `$5` economics boundary
- React/TypeScript/Vite/MUI frontend
- Netlify Functions + Background Function runtime
- Supabase PostgreSQL persistence
- server-only OpenRouter and privileged database access
- no V1 authentication
- public-demo retention model

## Verification

- cross-document consistency review
- only approved documentation files changed
- `git diff --check`
- no application code/dependencies yet
- human PR review

## Exit condition

All eight documents are coherent on `main` and a new coding agent can explain the product, architecture, limits, UI, economics, security, and workflow without inventing major decisions.

---

# M3 — Application Skeleton

## Goal

Create the smallest executable full-stack foundation with CI, but no real Tribunal behaviour yet.

## Scope

- React + TypeScript + Vite application
- MUI base theme
- React Router
- Netlify Functions foundation
- Supabase project/database connectivity foundation
- Zod/shared schema foundation
- environment-variable documentation
- test/lint/typecheck/build tooling
- GitHub Actions CI
- PR template if not already present

## Explicit non-goals

- no real OpenRouter model calls
- no completed Tribunal flow
- no database feature tables beyond foundation/migrations required for upcoming work unless explicitly included in the milestone spec

## Verification

```text
lint       PASS
typecheck  PASS
tests      PASS
build      PASS
```

Also verify no secrets in client bundle/repository.

## Exit condition

A clean deployed/local shell can render and call one harmless backend health endpoint, and CI gates the branch mechanically.

---

# M4 — UI Shell with Mock Data

## Goal

Validate the complete interaction model before AI adds latency and cost.

## Screens/flow

- New Case / Charge Sheet
- Advocates
- Judges
- Review
- Deliberation
- Result
- History

## Scope

- responsive layouts
- MUI design system
- mock participant/model data
- mock running/retry/failure/completed states
- result information hierarchy
- accessibility baseline

## Verification

- browser/manual review at desktop and mobile widths
- keyboard navigation and labels
- failure visually distinct from verdict
- three judge votes visible together
- no real model calls

## Exit condition

A reviewer can walk the entire product story with mock data and understand every next action/state without explanation.

---

# M5 — Case Persistence & Import

## Goal

Make cases durable and implement deterministic text/file intake, including one strict structured Full Tribunal Package format.

## Scope

- `cases` persistence
- Charge Sheet manual validation
- `.txt` / `.md` deterministic parser
- personality manual/file validation
- optional participant `profileName` metadata in the setup draft
- strict deterministic Full Tribunal Package import
- normalized Tribunal Setup Draft import contract
- source filename/type metadata
- History can display stored cases at a basic level
- raw files discarded after normalization
- M7A Smart Tribunal Package Extraction documented for later

## Verification

- field limits
- UTF-8 validation
- size/type checks
- missing/duplicate markers
- full package header/section/fixed-seat validation
- package import atomicity
- non-LLM parsing proof
- DB persistence/reload

## Exit condition

Valid cases/personality/package text persist or populate setup deterministically; malformed input cannot reach later execution.

---

# M6 — Participant Configuration

## Goal

Persist/freeze the seven-participant configuration independently of real model execution.

## Scope

Exactly:

```text
2 PRO Advocates
2 CON Advocates
3 Judges
```

Per participant:

- stable participant key
- role/side
- optional `profileName` / display-name metadata
- personality
- personality source metadata
- model assignment
- prompt-version placeholder/contract

Execution modes:

- Shared-Model
- Separate-Model

## Verification

- exact participant invariants
- side cannot change
- shared mode maps same model to all seven
- separate mode preserves seven assignments
- configuration freezes when a run is accepted

## Exit condition

The system has a complete, validated, immutable run configuration ready for an execution engine.

---

# M7 — OpenRouter Infrastructure

Planning contract: Issue
[#11](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/11),
`docs/adr/0003-openrouter-infrastructure.md`, `SPEC.md` `MODEL` acceptance
criteria.

## Goal

Build and verify the model gateway safely before orchestrating seven calls.
M7 executes zero advocates, zero judges, zero logical Tribunal calls.

## Scope

- server-side OpenRouter service behind one fakeable provider interface
  (model catalog + per-model endpoint discovery + chat completion)
- exact provider-endpoint resolution (`ResolvedModelRoute`) — pricing is
  bound to the specific endpoint a later execution attempt would be
  pinned to, never a model-level average; the endpoint's routing tag
  must be proven **uniquely pinnable** (never a base provider slug
  matching multiple variants) before it is eligible
- deterministic endpoint eligibility + cheapest-*eligible*-endpoint
  selection; dynamic/alias models (Auto Router, "latest" aliases) blocked;
  a candidate endpoint with a non-empty conditional `pricing.overrides`
  or a malformed `pricing.discount` is blocked as unrepresentable, and a
  valid `pricing.discount` is never relied upon for tier/eligibility
- cache-write-aware conservative input pricing (`effectiveInputPricePerToken`)
  — provider prompt-caching **writes** can cost more than ordinary input
  (not only less, as caching **reads** can); a non-zero
  automatically-applicable cache-write rate is bounded into every
  estimate and retry reserve, never assumed away as a pure discount
- bounded in-process cache with a locked 5-minute authoritative TTL (no
  new infrastructure); stale/unavailable metadata never authorizes
- strict JSON Schema structured output; `require_parameters`;
  `allow_fallbacks: false`
- decimal-safe pricing normalization (a small reviewed dependency, never
  binary floating point for an authoritative comparison) and FREE/BUDGET/
  PREMIUM/ABOVE_PREMIUM/HARD_BLOCK discovery tiers, computed per resolved
  route
- standalone, read-only `POST /api/preflight` per `docs/economics.md` —
  does not modify `POST /api/runs`; execution-time integration is M8's
- per-attempt timeout; normalized provider-error taxonomy
- usage/cost telemetry schema only — `model_call_attempts` is not created
  until a later milestone has a real write path
- role-specific prompt-version bridge (`ADVOCATE_PROMPT_VERSION`/
  `JUDGE_PROMPT_VERSION`): new runs frozen after M7 exists receive a real
  version-controlled prompt version per role; M6 placeholder runs are
  never mutated and never become execution-eligible
- fake/mock service boundary — normal tests never reach the real network
- **one mandatory, manual, metadata-only live OpenRouter integration
  check is required before this milestone merges** (zero model
  inference, no case/prompt data, no secret recorded — see the Issue);
  a further optional real-completion smoke remains separately,
  explicitly, human-authorized and is never part of the automated gate

## Verification

- API key never appears client-side
- strict advocate/judge schema success and failure
- timeout
- provider error
- missing usage/cost behaviour
- pricing/model-endpoint metadata parsing; exact route/price binding
- cache-write pricing never underestimated: a non-zero automatically-
  applicable `input_cache_write` rate raises `effectiveInputPricePerToken`
  above the raw prompt rate when higher, and the retry reserve never
  assumes a cheaper cache hit
- decimal budget correctness at the `$0.50`/`$2.00`/`$5.00` boundaries
- no real OpenRouter network call anywhere in the automated test suite
- the one mandatory live metadata smoke passes before merge

## Exit condition

One logical participant call can be made and audited safely, while normal automated tests remain free of real model spend.

---

# M7A — Smart Tribunal Package Extraction

Full planning contract: `docs/adr/0004-smart-package-extraction.md`
(structured-extraction schema, PDF extraction approach, economics
ceiling, persistence, API/UI contracts, security, testing, live-gate
policy). This section's Goal/Scope/non-goals/Verification/Exit
condition are preserved unchanged below — the ADR resolves the detail
they left open.

## Goal

Allow a user to upload a complete free-form Tribunal dossier and transform it into the same normalized Tribunal Setup Draft used by deterministic M5 imports.

## Scope

- generic free-form document intake
- safe file validation
- deterministic text extraction
- support for `.txt`, `.md`, and text-extractable `.pdf`
- one setup-time structured extraction model call after OpenRouter infrastructure exists
- strict schema validation for Charge Sheet plus exactly `PRO_1`, `PRO_2`, `CON_1`, `CON_2`, `JUDGE_1`, `JUDGE_2`, and `JUDGE_3`
- unresolved/null fields for incomplete or ambiguous extraction
- Review screen with human correction and confirmation before any run starts
- explicit extraction cost/telemetry/budget policy before implementation

## Explicit non-goals

- no hard-coded lecturer/course dossier
- no arbitrary participant creation
- no participant role or side changes
- no model assignment import
- no automatic Tribunal execution
- no OCR unless separately approved
- no eighth Tribunal participant or eighth Tribunal logical call

## Verification

- free-form extraction uses strict structured output
- extracted setup maps only to fixed application seats
- ambiguity becomes `needs review`
- normal setup validation blocks convening until required fields are complete
- extraction cost is displayed separately from seven-call Tribunal run cost
- upload never automatically convenes the Tribunal

## Exit condition

A free-form text or text-extractable PDF dossier can be converted into a reviewable generic Tribunal setup draft, with no hard-coded dossier and no automatic run execution.

---

# M8 — Shared-Model Tribunal ✅

Full planning contract: [Issue #17](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/17)
(execution order, atomic budget/claim state machine, BYOK Background
Function handoff, corrected twice after independent review). This
section's Goal/Scope/Verification/Exit condition are preserved unchanged
below.

**Corrected during implementation (independent review, Issue #17):**
runtime inference is user-funded, reusing the M7A BYOK boundary
unchanged (`docs/economics.md` §22.1) -- the developer/operator's
`OPENROUTER_API_KEY` is never reachable by the execution path. Execution-time
preflight strictly precedes the atomic run claim (`ARCHITECTURE.md` §7.4).

**Closed out (merged via [PR #18](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/18), approved head `0e860386f2ff5636019aaf70d4f8bb2f9e80468e`, merge commit `2159646122795fdccdcdbc3bcabaab4bf89d6ab8`):**
three human-authorized real live Tribunal runs occurred against the
user's own connected OpenRouter credential (never the developer's key).
The first two exposed real integration defects -- reasoning-capable
models exhausting the fixed output cap, then a reasoning
capability/effort compatibility gap -- each driving a source correction
before the next attempt. The third run completed cleanly on the approved
M8 head: 4 concurrent advocates, hard barrier, 3 concurrent judges,
deterministic majority, exactly 7 provider attempts with zero retries
and zero eighth logical model call, total cost $0.001551385. Full
evidence for all three runs is preserved in Issue #17's comment history.

## Goal

Deliver the first complete real Tribunal execution using one model for all seven participants.

## Scope

- idempotent run start
- Background Function worker
- atomic run claim
- four concurrent advocate logical calls
- hard advocate barrier
- three concurrent judge logical calls
- one retry max per logical call
- deterministic majority
- status polling
- failure propagation

## Verification

With mocked OpenRouter:

- 4 advocate requests initiated concurrently
- judges wait for all 4 valid speeches
- 3 judge requests initiated concurrently
- exactly 7 logical calls on no-retry success
- terminal advocate failure blocks judges
- terminal judge failure blocks completion
- duplicate worker does not duplicate calls

Then one explicitly authorized low-cost/free end-to-end real run --
delivered as three human-authorized real runs (see closeout note above);
the third completed the requirement.

## Exit condition

Shared-Model Mode completes a real run without violating output, failure, idempotency, or cost rules. ✅ Met by live run `352a4856-f282-4250-80fd-d78ca90f17e0`.

---

# M9 — Separate-Model Tribunal

## Goal

Support participant-specific models without duplicating orchestration logic.

## Scope

- seven model assignments honored
- model eligibility/pricing per participant
- same worker/execution strategy
- same output contracts and budget rules

## Verification

Mock responses prove each participant routes to its configured model and orchestration remains unchanged.

## Exit condition

The same Tribunal engine works with one shared model or seven independent assignments.

### Closeout (2026-08-31)

Complete. [PR #21](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/21) merged at `ce7a103341447ae530714f7ef82c12013178d13e`. One human-authorized live gate (`7960fc37-28fd-4e01-9547-a1ce9687d6ec`, SEPARATE mode, two distinct real configured models, verdict independently reconciled from persisted evidence and the OpenRouter generation ledger) passed. A small follow-up Result-page UX fix ([PR #22](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/22), verdict semantic coloring + expandable-reasoning affordance) was pulled forward from M14 and merged at `f89e0311b3a4de479a42fdfcabab5ecb42f05d96`.

---

# M10 — Protocol & Economics

**Planning:** [Issue #23](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/23) records a source-truth audit of what M7–M9 already implemented before any M10 code is written. Summary: the execution engine, budget guard, pricing-precedence, and protocol-assembly logic below are already implemented and tested; M10's actual remaining work is almost entirely *exposing* that already-correct, already-persisted data through `GET /api/runs/:id` and the Result page, plus surfacing partial spend on a `FAILED` run. No database migration is expected. See the issue for the full per-requirement classification and decision record.

## Goal

Make the cognified software economics a first-class product output.

## Scope

- final deterministic protocol snapshot
- attempt audit table/detail
- usage/cost source precedence
- pricing snapshots
- deterministic aggregation
- conservative preflight
- runtime budget guard
- `$5` hard intentional-spend ceiling
- no silent paid fallback

## Verification

- known token/price fixtures produce exact decimal costs
- failed attempt null telemetry is not treated as zero
- retries included in totals
- unsafe/unknown pricing blocked
- historical pricing does not change when current model price changes
- protocol uses no eighth LLM call

## Exit condition

A reviewer can explain exactly what each completed run consumed, how cost was derived, and why the run was allowed to start.

### Closeout (2026-09-02)

Complete. Planning: [Issue #23](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/23) (closed). Implementation: [PR #25](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/25), approved head `9da1dd6b8940def5359d64409f604837c2bafb9e`, merged at `fc641f2db6ee49526344f2de76947f94fea412ab`. Final exact-head CI: run [33436781897](https://github.com/Shlomi-Hazan/ase26-the-tribunal/actions/runs/33436781897), SUCCESS. Final verification: 55 test files / 793 tests. No database or schema change, no migration. Zero new Tribunal runs and zero real OpenRouter completions during M10; the two prior M8/M9 historical runs were used read-only for verification. Delivered: persisted economics/audit exposure, historical pricing snapshots, an immutable Economics Policy V1 registry, completed-run admission reconstruction, a strict resolved Protocol (including frozen-participant cross-evidence against the persisted participant configuration), Result-page economics/audit/protocol UX, and honest `FAILED`-run partial-spend disclosure.

---

# M11 — Past Cases & Auditability

**Planning:** [Issue #27](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/27) records an independently reviewed source-truth audit of what M5–M10 already implemented before any M11 code is written. Summary of the approved direction: Milestone 5 already provides persisted Case history and a basic Case Detail view, and Milestone 10 already provides the full historical Run audit/result surface at `GET /api/runs/:id` and `/runs/:runId` — so M11 reuses the existing `RunPage` rather than building a second result page. Case and Run remain distinct concepts; one Case may have zero, one, or many Runs. The genuinely missing piece is a read bridge from a Case to its Runs, added as a dedicated `GET /api/cases/:id/runs`. History remains Case-level browsing and does not fetch Run data per card; Case Detail gains the associated Run list. The `RunSummary` returned by the new endpoint is status/navigation metadata only — no verdict, no cost, no attempt/audit payload — because the narrow summary query cannot reproduce `RunPage`'s existing result-integrity checks; the authoritative verdict remains exclusively on the full `RunPage` behind those checks. Case and Run listings both order deterministically by `created_at DESC, id DESC`. A public-demo retention disclosure is planned on `/history`, `/cases/:caseId`, and `/runs/:runId`. Historical reopen remains strictly read-only across all three surfaces: zero model calls, zero OpenRouter/provider-metadata fetches, zero execution mutation. No database/schema change and no migration is required. See the issue for the full per-requirement classification, cardinality audit, and correction history.

## Goal

Make historical deliberations independently inspectable without rerunning models.

## Scope

- Past Cases listing
- case/run detail
- participant snapshots
- protocol
- economics/audit
- failed-run diagnostic view where appropriate

## Verification

- reopen after reload
- no model call on reopen
- stored outputs/economics match original run
- public-demo retention warning visible

## Exit condition

A historical run is understandable from persisted evidence alone.

### Closeout (2026-09-02)

Complete. Planning: [Issue #27](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/27) (closed). Implementation: [PR #29](https://github.com/Shlomi-Hazan/ase26-the-tribunal/pull/29), merged at `85aec6bb34fc30496297ad9d1dae183f884c1b08`. Delivered: `GET /api/cases/:id/runs` as a read-only Case→Run bridge, Case Detail's associated Run list, and the public-demo retention disclosure on `/history`, `/cases/:caseId`, and `/runs/:runId`. No database/schema change, no migration. Historical reopen remained strictly read-only throughout (zero model calls, zero OpenRouter/provider-metadata fetches, zero execution mutation).

---

# M12 — Canonical Jon Snow Demo

## Status

Current. Planning: [Issue #32](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/32) records an independently reviewed source-truth audit against the lecturer's case-design dossier ("THE TRIBUNAL — Jon Snow and the untimely demise of Daenerys Targaryen," Research edition, August 2026).

**Agent Mode is cancelled and removed from the product plan** (this replaces the milestone's prior "Agent Mode, If Confirmed" scope; it is not deferred or conditional — see [Issue #32](https://github.com/Shlomi-Hazan/ase26-the-tribunal/issues/32) §14–15 for the correction record and every other document touched by the cancellation).

## Goal

A one-click, deterministic, GoT-themed launch of the real Tribunal engine using a fixed canonical case and a fixed seven-participant configuration derived verbatim from the lecturer's dossier — reusing the existing execution engine end-to-end, with no schema change and no duplicate execution/majority/economics/protocol logic.

## Scope

- A small Home surface at `/` (Create/New Tribunal, Past Cases, Featured Jon Snow Demo) — `/` currently redirects straight into the setup flow; no Home page exists yet.
- A deterministic, version-controlled, schema-validated canonical preset (Charge Sheet + all seven participant profiles) — never a runtime Smart Extraction/LLM call.
- Locked seat mapping: PRO I/II = Jon Snow/Tyrion Lannister (defense seat), CON I/II = Daenerys Targaryen/Grey Worm (prosecution seat), Judge I/II/III = Aharon Barak/Menachem Elon/Meir Shamgar judicial-method profiles — procedural seating only, never a fixed opinion or verdict.
- A `/demo/jon-snow` launcher; run viewing stays on the existing generic `/runs/:runId`.
- A shared, non-duplicated run-start submission/navigation path extracted from `ReviewPage.tsx` and reused by the launcher, preserving the existing `clientRequestId` idempotency contract.
- BYOK required to launch (no dev/operator key fallback, no bypass of normal preflight/backend authority) — reuses the existing connected-credential gate unchanged.
- A documented default-model policy that explicitly rejects "cheapest wins," informed by the real `gpt-5-nano` CON II role-adherence miss observed live in run `b091e0e1-29b1-41ea-a990-017f57aaf5cb` (PR #31's gate) — with an explicit no-silent-fallback rule if the default becomes ineligible.
- Theme isolation: GoT presentation confined to the Home Jon Snow card and `/demo/jon-snow`; every other route (including a reopened Jon Snow run) stays Tribunal-generic, decided without content-sniffing heuristics.

## Explicit non-goals

Agent Mode, RAG, new authentication, a new majority/verdict system, a duplicate execution engine, a global GoT reskin, arbitrary user-created presets, runtime dossier extraction, and a role-adherence-classifier subsystem. See Issue #32 §19 for the full list.

## Verification

- The canonical case/seat-mapping/personality-limit content is covered by deterministic tests (no live model call required to verify correctness).
- No database/schema migration lands with this milestone (confirmed by audit).
- Existing engine, verdict vocabulary, deterministic majority, and $5.00 economics ceiling are unchanged.

## Exit condition

The Jon Snow demo launches the real Tribunal engine end-to-end from one click (given BYOK + an eligible default model), produces an ordinary historical run indistinguishable in structure from any other run, and Issue #32's full acceptance-criteria list is satisfied.

---

# M13 — Failure & Security Hardening

## Goal

Prove the system behaves safely when dependencies and models fail.

## Exercise intentionally

- timeout
- OpenRouter/provider unavailable
- malformed JSON/prose
- empty speech/reasoning
- invalid verdict
- duplicate submission
- duplicate worker delivery
- file attacks/oversize/non-UTF-8
- prompt injection attempts
- missing telemetry
- budget rejection
- runtime budget anomaly
- database error
- malicious displayed text/XSS attempts

## Verification

Security checklist in `SECURITY.md` plus automated/manual evidence.

## Exit condition

Every tested failure has an explicit, non-deceptive user state and an actionable, non-secret audit trail.

---

# M14 — UI Polish & Accessibility

## Goal

Polish the already-correct workflow without adding product scope.

## Focus

- typography
- spacing
- responsive behaviour
- card density
- status clarity
- subtle motion
- loading/error/empty states
- keyboard/focus behaviour
- contrast
- reduced-motion support
- long speech/reasoning readability

## Known follow-up (observed during M8 live verification)

On the Result page, Judge reasoning and Advocate arguments sit inside
Accordions (e.g. "Judge I — GUILTY", "PRO I — PRO"), but nothing signals
the row is expandable -- content and function are correct, this is
purely a discoverability gap. Preferred future direction: a visible
expand chevron and/or an explicit "View reasoning" / "View argument"
affordance.

**Pulled forward and completed early** (`fix/result-verdict-affordances`,
post-M9): two specific items from this note were addressed ahead of the
rest of M14's broader polish/accessibility scope -- an explicit
chevron + "View reasoning" / "View argument" affordance on every Judge
and Advocate Accordion, and semantic GUILTY (error) / NOT_GUILTY
(success) verdict coloring on the large verdict, the judge vote cards,
and each Judge Accordion summary, with the literal verdict text always
retained. The rest of M14's scope (typography, spacing, responsive
behaviour, card density, motion, contrast, reduced-motion, etc.) remains
future work -- M14 as a whole is still Planned, not Current or Complete.

## Exit condition

The application feels intentionally designed on desktop and mobile while preserving the simple interaction model.

---

# M15 — Production Deployment

## Goal

Prove the system works outside the developer machine.

## Scope

- production Netlify site/functions/background worker
- production Supabase database/migrations
- production environment secrets
- HTTPS
- rate limiting
- smoke tests
- one real budget-safe Tribunal run

## Verification

- production URL reachable
- critical flow completes
- background run survives browser navigation/refresh
- secrets absent from client/repository
- production economics recorded

## Exit condition

A reviewer can open a public URL and complete the demonstrated flow safely.

---

# M16 — Final Verification & Course Audit

## Goal

Audit the repository as the instructor would.

## Review

- intent
- specification
- architecture
- roadmap
- Git history
- issues/branches/PRs
- CI
- tests
- independent review evidence
- security
- prompts
- economics
- failures
- deployment
- UI
- known limitations

Final question:

> Can every important claim about how The Tribunal was engineered be independently verified from the repository and deployed product?

## Exit condition

The project is functionally demonstrable, secure enough for its stated demo scope, reproducible, documented, and supported by repository evidence rather than verbal claims.
