// Milestone 7 -- role-specific prompt version identifiers
// (ADR Decision 16). `prompt_version` is stored per participant;
// advocates and judges use different base prompts (ARCHITECTURE.md
// Sec 6), so a single undifferentiated version is insufficient.
//
// These constants are the application side of the anti-drift contract
// (ADR Decision 17): the forward migration
// (supabase/migrations/*_prompt_version_bridge.sql) embeds these exact
// literal values in the freeze function's internal role-derivation logic.
// promptVersionDrift.test.ts asserts the two never diverge silently.
export const ADVOCATE_PROMPT_VERSION = "advocate-v1";
export const JUDGE_PROMPT_VERSION = "judge-v1";

// The pre-Milestone-7 placeholder every M6 run was frozen with
// (netlify/server/runs.ts PROMPT_VERSION_PLACEHOLDER). Re-exported here
// only for the anti-drift/eligibility checks that need to recognize it --
// never written by any Milestone 7 code path.
export const PROMPT_VERSION_PLACEHOLDER = "unassigned-pre-m7";

// Milestone 7A -- the setup-time package-extraction call's own version
// identifier (ADR 0004 Decision 7). Deliberately never `advocate-v1` or
// `judge-v1`: this is not one of the seven Tribunal logical calls. The
// exact historical prompt text for this version lives in
// src/prompts/package-extraction/v1.ts, resolved only through
// src/prompts/package-extraction/registry.ts -- this constant identifies
// the CURRENT version for new logical extractions only; an existing
// logical extraction's own stored `prompt_version` (frozen at first
// acceptance) governs its own replay/retry, never this current value
// (ADR Decision 15's "Frozen logical-call semantic identity").
export const PACKAGE_EXTRACTION_PROMPT_VERSION = "package-extraction-v1";
