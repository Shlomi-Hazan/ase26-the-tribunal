// Milestone 7 -- ONE authoritative complete-Tribunal route-tier cost
// helper (independent review, pre-live gate; ADR Decision 12, Sections
// 8-11 of the correction task). Both GET /api/models (modelDiscovery.ts)
// and preflight's per-participant `priceTier` (preflight.ts) must derive
// FREE/BUDGET/PREMIUM/ABOVE_PREMIUM/HARD_BLOCK from the SAME formula for
// the same resolved route/pricing -- this module is that single source
// of truth, so the two can never silently drift apart again.
//
// Corrects two prior approximations:
//   - modelDiscovery.ts classified the tier from a single advocate
//     attempt's cost (no retry reserve, no judges at all).
//   - preflight.ts classified a participant's tier by multiplying THAT
//     participant's own retry-reserved cost by 7 -- which is wrong
//     whenever the participant is a judge (judge economics differ
//     materially from advocate economics: 1200 vs 1000 output cap, plus
//     the 4x1000-token advocate-speech input reservation no advocate
//     carries) and conflates "this run's real contribution" with
//     "this route's reusable discovery category" even for an advocate.
//
// The tier is a ROUTE DISCOVERY category: "if this exact resolved
// route/pricing were used for the complete fixed Tribunal shape, what
// would it conservatively cost." It is NOT this run's real combined
// cost (preflight.ts's conservativeMaxCostUsd, computed from the actual
// frozen participants) and NOT one participant's real contribution
// (conservativeParticipantCostUsd) -- both of those remain distinct,
// unchanged, and still authoritative for THIS run.

import Decimal from "decimal.js";
import {
  BUDGET_SAFETY_FACTOR,
  MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL,
  TOTAL_ADVOCATES,
  TOTAL_JUDGES
} from "./economicsConstants";
import type { PricingSnapshot } from "./pricing";
import { computeCandidateAttemptCostUsd, type RouteRole } from "./routeResolution";
import {
  ADVOCATE_OUTPUT_CAP_TOKENS,
  JUDGE_OUTPUT_CAP_TOKENS,
  worstCaseAdvocateInputTokens,
  worstCaseJudgeInputTokens
} from "./tokenEstimation";

// Computed once per module load -- these are canonical, run-independent
// worst-case token counts (tokenEstimation.ts), not derived from any
// specific frozen run's real Charge Sheet/personality text.
const ADVOCATE_TIER_INPUT_TOKENS = worstCaseAdvocateInputTokens();
const JUDGE_TIER_INPUT_TOKENS = worstCaseJudgeInputTokens();

// M9 (Separate-Model Tribunal, Issue #20): ONE participant's own
// conservative discovery estimate for the given role at this exact
// resolved route's pricing -- the same per-attempt cost + retry reserve
// + safety-factor treatment computeConservativeFullTribunalCostForRoute
// already applies, just scoped to a single seat instead of the whole
// fixed Tribunal shape. This is deliberately NOT the same figure as
// "this route's full-Tribunal discovery estimate" (a route eligible for
// only one role is never described as capable of serving the complete
// Tribunal) and NOT the same figure as a frozen run's real
// conservativeParticipantCostUsd (preflight.ts, computed from THIS run's
// actual claimed pricing snapshot) -- this is route-discovery-only,
// exactly like computeConservativeFullTribunalCostForRoute already is.
//
// Mathematically additive by construction: because Decimal multiplication
// is associative/commutative (no float drift, no intermediate rounding),
// `4 * computeConservativeParticipantEstimateForRoute(pricing, "ADVOCATE")
// + 3 * computeConservativeParticipantEstimateForRoute(pricing, "JUDGE")`
// is EXACTLY computeConservativeFullTribunalCostForRoute(pricing) for the
// same pricing snapshot -- verified by both this refactor (the full-
// Tribunal function below is now derived from this one, not a parallel
// formula) and a dedicated equivalence test
// (routeTierEconomics.test.ts).
export function computeConservativeParticipantEstimateForRoute(
  pricing: PricingSnapshot,
  role: RouteRole
): Decimal {
  const inputTokens = role === "ADVOCATE" ? ADVOCATE_TIER_INPUT_TOKENS : JUDGE_TIER_INPUT_TOKENS;
  const outputCapTokens = role === "ADVOCATE" ? ADVOCATE_OUTPUT_CAP_TOKENS : JUDGE_OUTPUT_CAP_TOKENS;
  const attemptCostUsd = computeCandidateAttemptCostUsd(pricing, inputTokens, outputCapTokens);

  return attemptCostUsd.times(MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL).times(BUDGET_SAFETY_FACTOR);
}

// 4 x conservative advocate attempt cost x retry reserve
// + 3 x conservative judge attempt cost x retry reserve
// then the approved safety factor applied ONCE to that sum -- now derived
// from computeConservativeParticipantEstimateForRoute (see its own
// comment above for the exact equivalence this preserves) rather than a
// second, independently-written formula.
export function computeConservativeFullTribunalCostForRoute(
  pricing: PricingSnapshot
): Decimal {
  const advocateEstimateUsd = computeConservativeParticipantEstimateForRoute(pricing, "ADVOCATE");
  const judgeEstimateUsd = computeConservativeParticipantEstimateForRoute(pricing, "JUDGE");

  return advocateEstimateUsd.times(TOTAL_ADVOCATES).plus(judgeEstimateUsd.times(TOTAL_JUDGES));
}
