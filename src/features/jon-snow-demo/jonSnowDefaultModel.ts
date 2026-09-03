// Milestone 12 -- Jon Snow demo default-model policy (Issue #32 Sec 8,
// corrected by the human product override: the demo is now operator-
// funded and must stay cheap -- SECURITY.md Sec 3.1.1,
// jonSnowDemoEconomics.ts's JON_SNOW_DEMO_MAX_ESTIMATE_USD).
//
// Selection criteria, all weighed together, no single factor decisive:
// role/instruction-following reliability, structured-output support,
// sufficient context, stable provider pinning/eligibility, reasonable
// latency, and a conservative full-Tribunal discovery estimate at or
// below the demo ceiling ($0.13; preferred comfortably below $0.10).
//
// Metadata-only GET /api/models inspection (zero completions) performed
// on 2026-09-03. Of the 29 eligible models observed, 6 were at or under
// the $0.13 ceiling: openai/gpt-5-nano ($0.024), openai/gpt-4.1-nano
// ($0.040), openai/gpt-4o-mini ($0.060), openai/gpt-5.4-nano ($0.089),
// openai/gpt-5.1-codex-mini ($0.108), openai/gpt-5-mini ($0.119).
//
// openai/gpt-5-nano was rejected -- not for being cheapest, but because
// it is the specific model that showed a real role-adherence miss in the
// live PR #31 semantic gate (run b091e0e1-29b1-41ea-a990-017f57aaf5cb):
// PRO I, PRO II, and CON I correctly followed their assigned stance, but
// CON II argued NOT_GUILTY/acquittal despite being correctly frozen at
// `side: CON`. openai/gpt-4.1-nano and openai/gpt-5.4-nano were also
// rejected: both share the same "nano" naming tier as the model that
// showed that failure, which is the generalizable risk signal here (a
// vendor's smallest tier within a generation), not any one generation
// specifically. openai/gpt-5.1-codex-mini was rejected as a code-
// generation-specialized variant, a poor fit for argumentative/
// deliberative text generation. openai/gpt-5-mini ($0.119) is above the
// $0.10 preferred target with no clear practical reason from current
// metadata to prefer it over a cheaper "mini"-tier candidate.
//
// Selected: openai/gpt-4o-mini. Comfortably below the $0.10 preferred
// target ($0.060 observed), "mini" tier -- a full step up from the
// "nano" tier where the observed CON II failure occurred, and not a
// code-specialized variant. 128,000-token context (comfortably
// sufficient for the ~2.6k-char canonical Act plus up to four advocate
// speeches), `supportsStructuredOutput: true`, served via the same
// stable Azure provider routing as the rest of the eligible catalog.
//
// This is a metadata-snapshot-informed choice, not a live behavioral
// proof for this exact model -- the one authorized live empirical role-
// adherence check for M12 happens in the single live gate before merge
// (mirroring the PR #31 gate's own discipline), not in this planning/
// implementation pass. No completion was made to select this default.
//
// No silent fallback: if this id becomes ineligible, or its current
// conservative estimate exceeds JON_SNOW_DEMO_MAX_ESTIMATE_USD, the
// primary one-click action disables itself with an explicit message
// (both client-side, and authoritatively re-checked server-side in
// netlify/server/tribunal/jonSnowDemoRun.ts) -- the user can still
// explicitly choose another currently-eligible, in-policy model via the
// Modify settings/models page. This constant is the only place the
// default is configured; never hardcoded inline in a component.
export const JON_SNOW_DEFAULT_MODEL_ID = "openai/gpt-4o-mini";
