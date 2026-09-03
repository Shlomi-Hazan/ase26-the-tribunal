// Milestone 12 -- Jon Snow demo default-model policy (Issue #32 Sec 8).
//
// Explicit non-goal: cheapest wins. The PR #31 live semantic gate (run
// b091e0e1-29b1-41ea-a990-017f57aaf5cb, `openai/gpt-5-nano`, correctly
// classified BUDGET tier, $0.001640265 total cost) showed PRO I, PRO II,
// and CON I all correctly followed their assigned Defense/Prosecution
// stance, but CON II did not -- it argued NOT_GUILTY/acquittal despite
// being correctly frozen at `side: CON`, `promptVersion: advocate-v2`. A
// genuine model instruction-following miss, not a persistence defect.
// That is exactly the failure mode the Jon Snow demo cannot risk on a
// public, lecturer-facing launch: seven fixed adversarial roles,
// including two advocates each arguing a stance a casual reader might
// intuitively expect to run the other way (CON arguing GUILTY against a
// broadly sympathetic-seeming Jon Snow; PRO's own Tyrion arguing
// NOT_GUILTY despite having personally warned Jon about Daenerys).
//
// Selection criteria (Issue #32 Sec 8, all weighed together, no single
// factor decisive): role/instruction-following reliability, structured-
// output support, sufficient context for the ~2.6k-char Act plus up to
// four advocate speeches, stable provider pinning/eligibility, reasonable
// latency for a live demo, reasonable cost, and the complete retry-
// inclusive run staying well inside the existing $5.00 hard ceiling.
//
// Metadata-only inspection performed at implementation time (GET
// /api/models -- zero-cost catalog metadata, the same existing endpoint
// AdvocatesPage/JudgesPage/ReviewPage already use; zero completions) on
// 2026-09-03. The full eligible catalog at that time (29 models) was
// screened against the criteria above. `openai/gpt-5-nano` and every
// other BUDGET-tier model were rejected as the default for the reason
// above (cheapest is not proven reliable at role adherence).
// ABOVE_PREMIUM-tier models (e.g. `anthropic/claude-fable-5.1`,
// $4.57204 conservative full-Tribunal estimate) were rejected as a
// public one-click default: the $5.00 ceiling must cover the whole run
// including the one-retry-per-call policy, and a public demo default
// should not consume nearly all of that headroom on tier alone.
//
// Selected: `anthropic/claude-sonnet-5`. PREMIUM tier ($0.914408
// conservative full-Tribunal estimate at observation time -- well under
// the PREMIUM_MAX threshold and leaving large headroom under $5.00 even
// with retries), 1,000,000-token context (comfortably sufficient),
// `supportsStructuredOutput: true`, served via the same stable Azure
// provider routing as the rest of the eligible catalog (no unusual
// pinning risk), and a frontier-generation model of the same lineage
// this session's own assistant runs on, whose class is built and
// evaluated specifically for reliable instruction-following/role
// adherence under structured output constraints -- directly addressing
// the CON II failure mode above, not merely avoiding its price tier.
//
// No silent fallback: if this id becomes ineligible (removed from the
// catalog, repriced out of policy, deprecated), the Jon Snow launcher's
// primary one-click action must disable itself with an explicit message
// rather than silently substituting a different or costlier model -- the
// user can still explicitly choose another currently-eligible model via
// the existing eligible-model catalog UI (Issue #32 Sec 9). This
// constant is the only place that choice is configured; never hardcoded
// inline in a component.
export const JON_SNOW_DEFAULT_MODEL_ID = "anthropic/claude-sonnet-5";
