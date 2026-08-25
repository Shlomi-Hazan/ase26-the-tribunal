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
| 4 | UI Shell with Mock Data | 🟡 Current |
| 5 | Case Persistence & File Input | ⬜ Planned |
| 6 | Participant Configuration | ⬜ Planned |
| 7 | OpenRouter Infrastructure | ⬜ Planned |
| 8 | Shared-Model Tribunal | ⬜ Planned |
| 9 | Separate-Model Tribunal | ⬜ Planned |
| 10 | Protocol & Economics | ⬜ Planned |
| 11 | Past Cases & Auditability | ⬜ Planned |
| 12 | Agent Mode, If Confirmed | ⬜ Conditional |
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

# M5 — Case Persistence & File Input

## Goal

Make cases durable and implement deterministic text/file intake.

## Scope

- `cases` persistence
- Charge Sheet manual validation
- `.txt` / `.md` deterministic parser
- personality manual/file validation
- source filename/type metadata
- History can display stored cases at a basic level
- raw files discarded after normalization

## Verification

- field limits
- UTF-8 validation
- size/type checks
- missing/duplicate markers
- non-LLM parsing proof
- DB persistence/reload

## Exit condition

Valid cases/personality text persist deterministically; malformed input cannot reach later execution.

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

## Goal

Build and verify the model gateway safely before orchestrating seven calls.

## Scope

- server-side OpenRouter service
- eligible model catalog/filter
- strict JSON Schema structured output
- `require_parameters`
- fallback policy
- price metadata retrieval
- per-attempt timeout
- normalized errors
- usage/cost extraction
- fake/mock service boundary
- one controlled real smoke call only when explicitly authorized

## Verification

- API key never appears client-side
- strict advocate/judge schema success and failure
- timeout
- provider error
- missing usage/cost behaviour
- pricing/model metadata parsing
- controlled live call records usage/cost if authorized

## Exit condition

One logical participant call can be made and audited safely, while normal automated tests remain free of real model spend.

---

# M8 — Shared-Model Tribunal

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

Then one explicitly authorized low-cost/free end-to-end real run.

## Exit condition

Shared-Model Mode completes a real run without violating output, failure, idempotency, or cost rules.

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

---

# M10 — Protocol & Economics

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

---

# M11 — Past Cases & Auditability

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

---

# M12 — Agent Mode, If Confirmed

## Status

Conditional. Do not implement unless the course requirement is confirmed precisely.

## Goal

Add a genuinely distinct execution strategy only if required.

## Required before implementation

Document what makes it an agent:

- goal
- model
- loop
- tools/actions if any
- termination condition
- state/context
- output contract
- new cost/security blast radius

Ordinary seven API calls do not qualify.

## Exit condition

If implemented, the distinction from model-call mode is observable and documented, not a naming change.

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
