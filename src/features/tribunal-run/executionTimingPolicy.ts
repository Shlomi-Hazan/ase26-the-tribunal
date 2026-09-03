// Milestone 13 (Issue #36 G2) -- the two safe, non-secret execution
// timing-policy constants BOTH the server execution engine
// (netlify/server/tribunal/execution.ts) and the client's stuck-run
// staleness signal (src/pages/RunPage.tsx) must agree on, so the two can
// never silently drift apart. This module contains ONLY pure, numeric
// policy constants and pure arithmetic -- no server-only imports, no
// Supabase/OpenRouter/execution logic -- so it is safe to import from
// client code. `netlify/server/tribunal/execution.ts` must never itself
// be imported into `src/` -- it depends on server-only modules and could
// pull server-only code paths into the client bundle.
//
// Follows the exact same isomorphic-constant pattern this repository
// already uses for src/features/jon-snow-demo/jonSnowDemoEconomics.ts,
// imported today by both a server module
// (netlify/server/tribunal/jonSnowDemoRun.ts) and multiple client
// components/pages.

// Mirrors execution.ts's own PROVIDER_ATTEMPT_TIMEOUT_MS exactly --
// execution.ts imports this constant rather than defining its own local
// literal, so the two can never independently drift.
export const PROVIDER_ATTEMPT_TIMEOUT_MS = 60_000;

// Mirrors execution.ts's own MAX_ATTEMPTS_PER_LOGICAL_CALL exactly (one
// initial attempt + one retry, SPEC.md Sec 10.1).
export const MAX_ATTEMPTS_PER_LOGICAL_CALL = 2;

// A logical call's own worst-case wall-clock: both permitted attempts,
// sequential (a retry only starts after the first attempt's own timeout
// is reached), never concurrent with each other.
const LOGICAL_CALL_WORST_CASE_MS = PROVIDER_ATTEMPT_TIMEOUT_MS * MAX_ATTEMPTS_PER_LOGICAL_CALL;

// The engine's two participant phases (4 advocates, then 3 judges) are
// each internally CONCURRENT (Promise.allSettled) but sequential with
// each other, separated by the advocate/judge barrier (SPEC.md Sec 9.2)
// -- so the worst case is two logical-call worst-cases added together,
// never four times or seven times one.
const SEQUENTIAL_PHASE_COUNT = 2;

// Separately named and justified (never folded invisibly into a single
// opaque number, per this correction's own requirement): real,
// non-zero-cost work this pure provider-time budget does not account
// for -- the execution-time preflight's own metadata/pricing round-trip,
// the atomic run/attempt claim writes, the per-attempt terminalize
// writes, the advocate/judge barrier transition, and the final
// majority/protocol completion write. Sized generously (a full minute)
// relative to typical Supabase RPC/OpenRouter-metadata latency, while
// remaining a small fraction of the ~240s core provider-time budget --
// not tuned against real production telemetry, since none exists yet
// for this milestone; revisit with observed latency once available.
export const ORCHESTRATION_MARGIN_MS = 60_000;

// The full staleness threshold: two sequential concurrent phases, each
// bounded by one logical call's own worst case, plus the orchestration
// margin above. ~240s of pure provider time + 60s margin = 300s (5
// minutes) with the current constants -- expressed as a computed value,
// never a bare literal, so it can never silently drift out of sync with
// the real engine if PROVIDER_ATTEMPT_TIMEOUT_MS or
// MAX_ATTEMPTS_PER_LOGICAL_CALL ever change.
export function computeStalenessThresholdMs(): number {
  return LOGICAL_CALL_WORST_CASE_MS * SEQUENTIAL_PHASE_COUNT + ORCHESTRATION_MARGIN_MS;
}
