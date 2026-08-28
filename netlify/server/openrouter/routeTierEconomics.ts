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
import { computeCandidateAttemptCostUsd } from "./routeResolution";
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

// 4 x conservative advocate attempt cost x retry reserve
// + 3 x conservative judge attempt cost x retry reserve
// then the approved safety factor applied ONCE to that sum.
export function computeConservativeFullTribunalCostForRoute(
  pricing: PricingSnapshot
): Decimal {
  const advocateAttemptCostUsd = computeCandidateAttemptCostUsd(
    pricing,
    ADVOCATE_TIER_INPUT_TOKENS,
    ADVOCATE_OUTPUT_CAP_TOKENS
  );
  const judgeAttemptCostUsd = computeCandidateAttemptCostUsd(
    pricing,
    JUDGE_TIER_INPUT_TOKENS,
    JUDGE_OUTPUT_CAP_TOKENS
  );

  const advocatesTotalUsd = advocateAttemptCostUsd
    .times(MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL)
    .times(TOTAL_ADVOCATES);
  const judgesTotalUsd = judgeAttemptCostUsd
    .times(MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL)
    .times(TOTAL_JUDGES);

  return advocatesTotalUsd.plus(judgesTotalUsd).times(BUDGET_SAFETY_FACTOR);
}
