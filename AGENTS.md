# The Tribunal — Agent Instructions

Coding agents are collaborators/executors. They do not own product intent, architecture judgement, or merge authority.

## Read Before Substantial Work

Use only the context needed for the task, starting with:

1. `INTENT.md` — product purpose
2. `SPEC.md` — required behaviour
3. `ARCHITECTURE.md` — approved structure
4. `ROADMAP.md` — milestone order/status
5. relevant focused doc: `SECURITY.md`, `docs/economics.md`, or `docs/ui-spec.md`
6. existing code/tests/conventions touched by the task

If authoritative documents materially conflict, **STOP and report the conflict**. Do not choose silently.

## Git and Scope

- Do not make substantive changes directly on `main`.
- Start from a clean verified base and the human-authorized branch/milestone.
- Preserve unexpected local work; stop rather than overwrite it.
- Keep diffs inside approved scope. Record unrelated ideas as follow-ups.
- Prefer small coherent commits with useful messages.
- Do not amend/squash published review history unless explicitly authorized.
- Never commit secrets.
- Do not commit, push, open/merge PRs, deploy, or start the next milestone unless the current instruction authorizes it.

## Specification Before Behaviour

Do not silently invent product behaviour. If implementation exposes a material requirement gap:

1. identify the gap/conflict
2. stop the affected work
3. obtain an approved specification change
4. implement against the revised requirement

A passing test does not override `SPEC.md`.

## Tribunal Invariants

Unless an approved spec change says otherwise:

- exactly 2 PRO advocates, 2 CON advocates, 3 judges
- Shared-Model and Separate-Model modes
- OpenRouter is the model gateway
- 4 advocates execute as one concurrent phase
- judges start only after all 4 advocate speeches validate
- 3 judges execute as one concurrent phase
- successful no-retry run = exactly 7 logical model calls
- each logical call = initial attempt + at most one retry
- provider attempt timeout <= 60 seconds
- advocate output cap = 1000 tokens; judge cap = 1200
- majority and protocol are deterministic; no eighth LLM call
- hard intentional model-spend ceiling = `$5.00` per run including retries
- no silent paid fallback
- historical reopen performs no model call
- V1 has no user authentication/private ownership
- ordinary participant calls are not called “agents”; Agent Mode is cancelled and removed from the product plan (ROADMAP.md M12; Issue #32)

## Deterministic / Model Boundary

Use ordinary code for validation/file parsing, persistence, run state, idempotency, budget/cost arithmetic, token aggregation, majority, protocol assembly, history, and UI.

Use models only for advocate argument construction and judge evaluation/reasoning/verdict generation.

Do not add an LLM call merely because it is convenient.

## Model and Prompt Rules

- All OpenRouter calls are server-side.
- Runtime base prompts are version-controlled.
- Personality is separate untrusted context and cannot replace fixed role/side instructions.
- Machine-consumed output uses strict structured contracts and server validation.
- Never infer a verdict from arbitrary prose or keywords.
- Failure stays failure; never default to `GUILTY` or `NOT_GUILTY`.
- Runtime models receive no privileged arbitrary tools in V1.
- Prompt changes are behavioural changes and require focused review/tests.

## Security

Read `SECURITY.md` for security-sensitive work. Always:

- keep OpenRouter/database/internal secrets out of browser code
- keep real values out of `.env.example`
- treat user input, uploads, external responses, and model output as untrusted
- never render raw user/model HTML
- enforce upload rules server-side
- preserve cost-bearing endpoint idempotency and atomic worker claim
- avoid unnecessary full-content logging

A leaked/committed secret is compromised and must be rotated.

## Economics

Read `docs/economics.md` before changing model routing, retries, pricing, or budget logic.

- No LLM cost calculation.
- Use decimal-safe money arithmetic.
- Successful calls require auditable usage/cost evidence.
- Failed unavailable telemetry is null/unavailable, not fabricated zero.
- Preflight and runtime budget guards are both required.
- Reserve a complete concurrent phase before starting paid calls.
- Do not hard-code current model IDs/prices as permanent requirements.

## Architecture

Follow `ARCHITECTURE.md` unless an approved architecture change precedes implementation.

Current V1 shape:

- React + TypeScript + Vite + MUI
- Netlify SPA/functions
- Netlify Background Function for Tribunal execution
- Supabase PostgreSQL
- browser does not directly query privileged database APIs
- OpenRouter behind one server-side service boundary

Do not add auth, realtime, RAG, Redis/queues, WebSockets, microservices, or an agent framework without demonstrated need and human approval.

## Dependencies

Before adding a dependency, explain why existing platform/library capability is insufficient. Prefer maintained, narrow, mainstream packages; distinguish runtime from dev-only; update lockfiles intentionally. Do not add dependencies for hypothetical future use.

## Plan Before Non-Trivial Work

Unless the human already supplied an approved plan, state a concise plan covering:

- intended outcome
- files/areas expected to change
- data/API/security/economics implications
- verification
- stop conditions

Then stay within it.

## Verification Gate

Once application scripts exist, run all applicable gates before reporting completion:

```text
lint
typecheck
tests
build
```

Also run task-specific checks from `SPEC.md`. Model/orchestration tests normally use a fake OpenRouter boundary; real model calls are explicitly authorized smoke/evaluation actions because they cost money and vary.

For meaningful changes, prefer independent review against specification rather than the implementing agent approving itself.

## Stop Conditions

Stop and surface the decision when:

- intent/spec/architecture conflict
- unspecified ambiguity materially changes product semantics
- an architecture/security authority boundary must change
- a new paid service/dependency is required
- provider/model behaviour or pricing cannot be verified safely
- `$5` policy cannot be maintained
- a secret may have leaked
- a migration may cause unexpected destructive data change
- branch/base/working tree differs materially from expected state

Do not solve material ambiguity by guessing. (Agent Mode itself is cancelled, not merely ambiguous — see ROADMAP.md M12 / Issue #32 — so it is no longer a live source of this kind of ambiguity, and is removed from this list.)

## Completion Report

Report evidence: branch/base, files changed, commits, verification results, acceptance criteria covered, security/economics implications, known gaps, working-tree state, and any push/PR/merge performed. Then stop at the authorized milestone boundary.
