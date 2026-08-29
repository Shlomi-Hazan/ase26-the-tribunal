// Milestone 8 -- Background Function invocation authorization
// (ARCHITECTURE.md Sec 4.1). The worker is not a public user API: every
// invocation must carry this header, matching the exact server-only
// INTERNAL_FUNCTION_SECRET value. The browser never receives this
// secret -- it is set only by POST /api/runs (server-to-server) when
// forwarding a run to the worker. Mirrors userOpenRouterKey.ts's exact
// header-contract style (case-insensitive read, constant header name,
// never echoed back).

import type { HandlerEvent } from "@netlify/functions";

export const INTERNAL_FUNCTION_SECRET_HEADER = "x-internal-function-secret";

export function readInternalFunctionSecretHeader(event: HandlerEvent): string | null {
  const headers = event.headers ?? {};
  let raw: string | undefined;

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === INTERNAL_FUNCTION_SECRET_HEADER) {
      raw = value;
      break;
    }
  }

  if (typeof raw !== "string" || raw.length === 0) {
    return null;
  }

  return raw;
}

// Constant-time comparison -- an invocation-authorization secret must not
// be checked with a short-circuiting `===`, which leaks timing
// information about how many leading characters matched.
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return mismatch === 0;
}
