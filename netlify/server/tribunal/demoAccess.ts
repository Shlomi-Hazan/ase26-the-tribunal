// Milestone 12 (human product override, PR #34) -- public-spend
// protection for the operator-funded Jon Snow demo (SECURITY.md
// Sec 3.1.1). This is NOT an OpenRouter credential: it is a revocable
// capability that gates who may invoke POST /api/demo/jon-snow/runs at
// all. Mirrors internalSecret.ts's exact header-contract style
// (case-insensitive read, constant header name, never echoed back) and
// reuses its constant-time secretsMatch -- never a second comparison
// implementation.

import type { HandlerEvent } from "@netlify/functions";
import { secretsMatch } from "./internalSecret";

export const JON_SNOW_DEMO_ACCESS_HEADER = "x-jon-snow-demo-access";

export function readJonSnowDemoAccessHeader(event: HandlerEvent): string | null {
  const headers = event.headers ?? {};
  let raw: string | undefined;

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === JON_SNOW_DEMO_ACCESS_HEADER) {
      raw = value;
      break;
    }
  }

  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  return raw;
}

// Missing/invalid capability must produce IDENTICAL behavior: zero case/
// run creation, zero provider execution -- never distinguished in a way
// that would help an attacker probe for a near-miss token.
export function isValidJonSnowDemoAccess(provided: string | null, configured: string): boolean {
  if (!provided) {
    return false;
  }

  return secretsMatch(provided, configured);
}
