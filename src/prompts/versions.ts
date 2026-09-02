// Milestone 7 -- role-specific prompt version identifiers
// (ADR Decision 16). `prompt_version` is stored per participant;
// advocates and judges use different base prompts (ARCHITECTURE.md
// Sec 6), so a single undifferentiated version is insufficient.
//
// These constants are the application side of the anti-drift contract
// (ADR Decision 17): the forward migration
// (supabase/migrations/*_prompt_version_bridge*.sql) embeds these exact
// literal values in the freeze function's internal role-derivation logic.
// promptVersionDrift.test.ts asserts the two never diverge silently
// against whichever such migration is chronologically latest.
//
// PRO/CON semantic correction (Issue #30): both bumped from
// advocate-v1/judge-v1 to advocate-v2/judge-v2. advocate-v1 had the
// defendant-facing meaning of PRO/CON reversed by accident (PRO argued
// for the charge/GUILTY, CON argued against it/NOT_GUILTY); advocate-v2
// corrects this to the locked product contract (PRO = Defense, argues
// NOT_GUILTY; CON = Opposition/Prosecution, argues GUILTY). judge-v1
// never referenced PRO/CON, but the Judge's user-message labels
// (netlify/server/tribunal/execution.ts's buildJudgeUserMessage) could
// otherwise be read ambiguously right after that correction, so judge-v2
// adds an explicit semantic legend -- Judge independence, the verdict
// vocabulary (GUILTY/NOT_GUILTY), and the output schema are unchanged.
// advocate-v1/judge-v1's exact historical text is preserved, unedited,
// in src/prompts/advocate/v1.ts / src/prompts/judge/v1.ts -- this is a
// forward-only correction; no historical row is ever reinterpreted.
export const ADVOCATE_PROMPT_VERSION = "advocate-v2";
export const JUDGE_PROMPT_VERSION = "judge-v2";

// The pre-Milestone-7 placeholder every M6 run was frozen with
// (netlify/server/runs.ts PROMPT_VERSION_PLACEHOLDER). Re-exported here
// only for the anti-drift/eligibility checks that need to recognize it --
// never written by any Milestone 7 code path.
export const PROMPT_VERSION_PLACEHOLDER = "unassigned-pre-m7";

// Milestone 7A -- the setup-time package-extraction call's own version
// identifier (ADR 0004 Decision 7). Deliberately never `advocate-vN` or
// `judge-vN`: this is not one of the seven Tribunal logical calls. The
// exact historical prompt text for each version lives in
// src/prompts/package-extraction/vN.ts, resolved only through
// src/prompts/package-extraction/registry.ts -- this constant identifies
// the CURRENT version for new logical extractions only; an existing
// logical extraction's own stored `prompt_version` (frozen at first
// acceptance) governs its own replay/retry, never this current value
// (ADR Decision 15's "Frozen logical-call semantic identity").
//
// PRO/CON semantic correction (Issue #30): bumped from
// package-extraction-v1 to package-extraction-v2 -- v1 never defined
// what PRO/CON mean, risking a free-form dossier's "Prosecution"
// representative being lexically (mis)mapped to a PRO_* seat; v2 makes
// the Defense->PRO / Prosecution/Opposition->CON mapping explicit.
// package-extraction-v1 remains immutable and resolvable for historical
// extraction replay/audit.
export const PACKAGE_EXTRACTION_PROMPT_VERSION = "package-extraction-v2";
