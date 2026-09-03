// Milestone 12 -- human product override (PR #34 correction pass). The
// Jon Snow demo is operator-funded (SECURITY.md Sec 3.1.1): a strictly
// lower, additional ceiling applies on top of the generic product's
// existing $5.00 hard run ceiling, which is completely unchanged and
// remains authoritative underneath. This is the single reusable source
// of truth for that demo-specific ceiling -- imported by both the client
// (Home/Modify-settings display and gating) and the server (the
// authoritative, independent re-check in
// netlify/server/tribunal/jonSnowDemoRun.ts). A decimal-safe string,
// like every other money figure in this codebase, never a raw float.
export const JON_SNOW_DEMO_MAX_ESTIMATE_USD = "0.13";

// The softer, preferred-but-not-required target mentioned in the human
// override: "prefer the best reasonable/reliable eligible model
// comfortably below $0.10." Not itself enforced anywhere -- it only
// informs which candidate is selected for JON_SNOW_DEFAULT_MODEL_ID.
export const JON_SNOW_DEMO_PREFERRED_ESTIMATE_USD = "0.10";
