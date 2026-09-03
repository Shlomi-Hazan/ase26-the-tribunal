// Milestone 13 (Issue #36 G3) -- admission-control rate limiting for the
// two cost-bearing Tribunal run-start endpoints, mirroring
// netlify/server/extraction/constants.ts's own rate-limit section
// exactly in shape and reasoning.

// The exact, already-locked generic policy (SECURITY.md Sec 10):
// "3 accepted start attempts per 180 seconds per source IP" for
// POST /api/runs.
export const RUN_START_RATE_LIMIT = {
  maxAcceptedRequests: 3,
  windowMs: 180_000
} as const;

// The operator-funded Jon Snow demo (POST /api/demo/jon-snow/runs) is a
// DISTINCT admission pool from generic run starts (its own bucket
// namespace, "jon-snow-demo-start" -- never shared capacity with
// "run-start"). Same abuse-control principle, deliberately a slightly
// higher ceiling than the generic policy for two reasons specific to
// this surface: (1) presentation-safety -- a live lecture demo may
// legitimately involve a lecturer re-running the canonical demo a few
// times in quick succession (testing the room's projector/network,
// recovering from a misclick) in front of an audience, where a spurious
// 429 mid-presentation is a materially worse outcome than for the
// generic product; (2) the per-run cost exposure is already far lower
// here ($0.13 JON_SNOW_DEMO_MAX_ESTIMATE_USD vs. the generic $5.00 hard
// ceiling), so a slightly higher start-frequency ceiling still bounds
// worst-case financial exposure to a materially smaller number than the
// generic endpoint's own worst case. This remains a firm, bounded cap,
// never unlimited -- it exists specifically so a leaked/shared access
// capability cannot mint unbounded fresh clientRequestIds from one
// source, per this correction's own requirement.
export const JON_SNOW_DEMO_RUN_START_RATE_LIMIT = {
  maxAcceptedRequests: 5,
  windowMs: 180_000
} as const;
