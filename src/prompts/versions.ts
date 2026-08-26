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
