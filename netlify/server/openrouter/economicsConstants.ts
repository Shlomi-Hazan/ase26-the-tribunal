// Milestone 7 -- shared, locked economics constants (docs/economics.md,
// ADR 0003 Decisions 12/21/22, SPEC.md Sec 10/16). Extracted to their own
// module (independent review, pre-live gate) so preflight.ts,
// modelDiscovery.ts, and routeTierEconomics.ts all reference the exact
// same values without a circular import between the preflight service
// and the route-tier helper it now shares with model discovery.

import Decimal from "decimal.js";

export const MAX_RUN_COST_USD = new Decimal("5.00");
export const BUDGET_SAFETY_FACTOR = new Decimal("1.10");

// Initial attempt + one permitted retry (SPEC.md Sec 10.1). No cache hit,
// warm cache, or provider discount may ever reduce this reserve
// (ADR Decision 7B).
export const MAX_PROVIDER_ATTEMPTS_PER_LOGICAL_CALL = 2;

// Fixed Tribunal shape.
export const TOTAL_ADVOCATES = 4;
export const TOTAL_JUDGES = 3;
export const TOTAL_LOGICAL_CALLS = TOTAL_ADVOCATES + TOTAL_JUDGES;
