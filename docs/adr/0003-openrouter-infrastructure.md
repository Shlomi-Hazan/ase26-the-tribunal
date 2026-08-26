# ADR 0003 — OpenRouter Infrastructure (Milestone 7)

## Status

Accepted (planning gate). Locks the architectural decisions needed before
Milestone 7 implementation begins. Does not authorize implementation,
a real OpenRouter request, or any change to the live Supabase database.

## Context

Milestone 6 froze participant configuration with zero model calls and a
fixed placeholder `prompt_version = 'unassigned-pre-m7'`
(`docs/adr/0002-participant-configuration-freeze.md` Decision 12).
Milestone 7 must build the provider/pricing/preflight infrastructure
Milestone 8 needs to actually execute the Tribunal, without executing it
itself. Several concrete design questions have no single obviously-correct
answer and materially affect later milestones, so they are locked here
rather than left to be improvised during implementation.

The already-applied M6 migration
(`supabase/migrations/20260825214212_participant_configuration.sql`) is
immutable historical truth and is not edited by this ADR or by M7. Any
schema/function change M7 needs is a **new** forward migration.

## Decision 1 — One provider abstraction, one fake

M7 introduces exactly one server-side interface:

```ts
interface OpenRouterProvider {
  listModels(): Promise<RawOpenRouterModel[]>;
  createChatCompletion(request: ProviderChatRequest): Promise<ProviderChatResult>;
}
```

One real implementation (`fetch`-based, per `ARCHITECTURE.md` §1/§5 — no
SDK dependency) and one deterministic in-memory fake implementation
satisfy every consumer (catalog resolution, preflight, and — later, in
M8 — actual execution). **No second provider abstraction is introduced for
hypothetical future gateways.** OpenRouter is the only V1 model gateway
(`SPEC.md` §8); adding a provider-agnostic layer now would be speculative
infrastructure the project's own principles reject
(`ARCHITECTURE.md` §16, `AGENTS.md` "Dependencies").

Rejected alternative: a generic multi-provider abstraction "for later."
Rejected because V1 has exactly one required gateway and the extra
indirection would add surface area without a current requirement driving
it.

## Decision 2 — Model catalog: bounded in-process cache, no new infrastructure

M7 fetches OpenRouter's model catalog server-side and caches it in an
in-process (per Netlify Function instance) bounded cache — not a
database table, not Redis, not a queue (`ARCHITECTURE.md` §16 already
rules these out for V1).

- **TTL:** the fetched catalog is treated as fresh for a short, explicitly
  configured window (implementation detail; on the order of minutes, not
  hours — pricing/availability can change, and `docs/economics.md` §16
  already establishes that historical pricing must never silently drift).
  The exact numeric TTL is an implementation-task decision, not locked
  here, because it is a tuning parameter, not a product behavior.
- **Invalidation:** the cache is never trusted past its TTL; a preflight
  call that needs current pricing always re-fetches or serves a
  known-fresh cached copy, never a silently-stale one past TTL.
- **Failure behavior:** if the catalog cannot be fetched (network/provider
  failure) and no fresh cached copy exists, **preflight blocks** — it does
  not fall back to a stale copy and does not invent pricing
  (`docs/economics.md` §15, `SPEC.md` §16.1). A cached copy that is
  merely *stale* (past TTL) is treated the same as unavailable for
  authoritative preflight; it may still be used for a non-authoritative
  UI hint if a later milestone wants that, but never for the eligibility
  decision itself.
- **No new dependency.** The cache is a plain in-memory structure keyed by
  model ID with a stored fetch timestamp — no new package.

Rejected alternative: a `model_catalog` database table refreshed by a
scheduled job. Rejected as premature infrastructure — M7 has no
requirement that survives a cold Netlify Function instance, and a stale
row in a database is no safer than a stale in-memory entry; both need the
same TTL/re-validation discipline, and the in-memory version needs no
migration, no write path, and no new privilege surface.

## Decision 3 — `model_call_attempts` is not created in M7

`ARCHITECTURE.md` §8.4 already designs this table's shape, but M7 makes
**zero** real provider calls, so it has nothing of its own to persist into
it. Creating the table now would be schema speculation ahead of a real
write path — the same category of premature-infrastructure mistake M6's
own migration explicitly avoided for `tribunal_runs`' execution/economics
columns (`ARCHITECTURE.md` §8.2: "Execution/economics columns... are not
created by Milestone 6; they are added by a later forward migration when
M8/M10 actually need them").

M7 defines the **TypeScript interface / Zod schema** for a provider
attempt record (telemetry contract) so M8's design and tests can depend on
a stable shape, but the table itself — and the forward migration that
creates it — is M8/M10 work, created when a real write path exists.

## Decision 4 — Prompt-version bridge: a new forward migration replaces the freeze function's internal literal

`docs/adr/0002-participant-configuration-freeze.md` Decision 12 already
requires: newly-accepted runs receive the real application-owned prompt
version once M7's real prompts exist; M6 historical runs are never
mutated; `prompt_version` remains non-caller-controlled.

The freeze function currently writes a hardcoded literal
(`'unassigned-pre-m7'`) inside its own `plpgsql` body — never a caller
parameter, by original M6 design (`docs/adr/0002...` Decision 6: role,
side, and `prompt_version` are all derived internally, never accepted as
function parameters, specifically so no caller — buggy or malicious — can
set them).

**Decision:** preserve that non-caller-controlled property. The mechanism
for a real prompt version is a **new forward migration** that
`CREATE OR REPLACE FUNCTION public.freeze_participant_configuration(...)`
with the *same signature, privileges, and grants*, replacing only the
internal `prompt_version` literal (or the small internal expression that
derives it) with the current application-owned version identifier from
`src/prompts/versions.ts`. This does not edit the already-applied M6
migration file — it is a new, separately reviewed migration, consistent
with "prompt changes are behavioural changes and require review like code
changes" (`AGENTS.md`, `INTENT.md` §22). Each future prompt-version bump
is therefore its own small, reviewable, auditable migration — not a
runtime-configurable value a compromised or buggy code path could set.

Rejected alternative: accept `p_prompt_version` as a new function
parameter, validated against a `CHECK` constraint enumerating allowed
versions. Rejected because it reopens exactly the caller-control surface
Decision 6 deliberately closed for this class of field, for a marginal
convenience (avoiding a migration per version bump) that the project's own
principles say is not a real cost — prompt changes should already require
review.

This migration is **not written in this planning task.** Writing and
applying it is M7 implementation work, gated by the same live-Supabase
review discipline M6 used (static review → application → live
re-verification), and only once real prompt text/versions actually exist
to assign.

## Decision 5 — Preflight ships as a standalone read-only service in M7 (recommended, pending explicit approval)

`ARCHITECTURE.md` §7.4 step 5 annotates `POST /api/runs`'s conceptual
request lifecycle with "reruns authoritative preflight (from Milestone 7
onward)," which could be read as requiring M7 to wire preflight
synchronously into the run-acceptance write path — persisting a
`BLOCKED_BUDGET`-status frozen run when preflight fails at Convene time.
That would require a second new forward migration (the freeze function's
`INSERT ... VALUES (..., 'READY')` currently hardcodes the literal status;
supporting `BLOCKED_BUDGET` there means accepting a computed status
value).

`ARCHITECTURE.md` §7.3 already documents `POST /api/preflight` as its own
**separate** endpoint: "validates complete case/configuration... returns
conservative estimate and eligibility... performs no model inference."
This is a real, coherent, self-contained M7 deliverable that requires no
schema or freeze-RPC change at all.

**This ADR treats these as two distinct, separable decisions, and records
the second one as unresolved rather than silently picking one:**

- The **preflight service and its standalone endpoint** are locked M7
  scope (Decision, not open): compute-only, no persistence, callable from
  Review before Convene and reusable by M8 at execution time.
- **Whether `POST /api/runs` itself changes** to call that service inline
  and persist `BLOCKED_BUDGET` at freeze time is **left open**,
  recorded in the M7 Issue as an explicit unresolved question.
  **Recommendation:** defer this to M8, when a `BLOCKED_BUDGET` run
  actually blocks something real (execution) rather than merely
  previewing a number the standalone endpoint already shows. This avoids
  touching the freeze RPC a second time in M7 for a behavior with no
  consumer yet.

## Consequences

- M7 adds exactly one new environment variable read path
  (`OPENROUTER_API_KEY`, via `readOpenRouterServerConfig()` mirroring
  `netlify/server/env.ts`'s existing Supabase pattern), no new runtime
  dependency, and — if Decision 5's default holds — no live-database
  change at all in M7; the prompt-version-bridge migration (Decision 4)
  is the one schema change M7 is expected to eventually make, and only
  once real prompt versions exist to assign.
- M8 inherits a stable `OpenRouterProvider` interface, a stable pricing
  representation, a stable preflight result shape, a stable provider-error
  category enum, and a stable attempt-telemetry interface, without
  inheriting a `model_call_attempts` table it doesn't yet need or a
  `POST /api/runs` behavior change it hasn't asked for yet.
- Every M7 test runs against the fake provider; CI never spends money or
  depends on OpenRouter's availability.
