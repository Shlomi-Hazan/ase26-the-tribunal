# The Tribunal — Claude Code Context

Read and follow `AGENTS.md` first. It is the standing agent contract for this repository.

## Source of Truth

For substantial work, use this precedence:

1. `INTENT.md` — product purpose
2. `SPEC.md` — required behaviour
3. `ARCHITECTURE.md` — approved structure
4. focused docs (`SECURITY.md`, `docs/economics.md`, `docs/ui-spec.md`)
5. `ROADMAP.md` — milestone sequencing
6. existing code/tests/conventions

If two authoritative documents materially conflict, stop and surface it.

## Claude Code Working Style

- Keep context focused; do not load the whole repository without need.
- Inspect relevant files before planning changes.
- For broad exploration, use a separate subagent/reviewer when useful and bring back a concise evidence summary.
- Do not rely on chat memory for standing rules; update repository documentation only when the human approves a durable change.
- Do not autonomously commit, push, open/merge PRs, deploy, or spend model credits unless the current instruction authorizes that action.
- Prefer reversible, minimal changes over speculative refactors.

## Commands

Do not invent project commands before they exist.

When `package.json` is introduced, this file should be updated with the canonical commands for:

```text
install
run dev
lint
typecheck
test
build
```

Use repository scripts rather than tool-specific ad-hoc equivalents once scripts exist.

## Tribunal Reminders

- 4 concurrent advocates → hard barrier → 3 concurrent judges.
- Strict JSON-schema model outputs; no prose verdict guessing.
- Majority/protocol are deterministic; no eighth LLM call.
- One retry maximum per logical participant call.
- `$5.00` run ceiling includes retries.
- All OpenRouter calls and privileged DB access remain server-side.
- Agent Mode is not implemented unless separately confirmed and specified.
