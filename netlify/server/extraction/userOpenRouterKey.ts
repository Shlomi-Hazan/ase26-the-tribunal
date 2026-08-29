// Milestone 7A -- user-funded OpenRouter BYOK correction (product/
// economics decision, independent of the ADR 0004 planning pass). The
// developer/operator's own OPENROUTER_API_KEY must never fund a
// user-triggered completion (docs/economics.md Sec 22.1, SECURITY.md
// Sec 3.1). Every endpoint capable of calling `createChatCompletion`
// requires this exact header, carrying the USER's own OpenRouter API
// key for that one request only -- never persisted, never logged, and
// the two paid Netlify Functions (setup-extractions.ts,
// setup-extractions-retry.ts) never construct a provider from
// `process.env.OPENROUTER_API_KEY`/`readOpenRouterServerConfig()` at
// all anymore, so there is no fallback code path to accidentally take.
// Metadata-only endpoints (setup-extractions-preflight.ts) are
// explicitly exempt -- they make zero completion calls, so the
// server's own operator credential remains acceptable for them in this
// pass (a documented, deliberate interim choice, not an oversight).
//
// The exact header name is mirrored client-side in
// src/services/openRouterCredential.ts; smartImport.test.tsx asserts
// the two stay byte-for-byte in sync by importing this server module
// directly -- safe because vitest test files are never part of the
// Vite client bundle scripts/verify-client-bundle.mjs scans.

import type { HandlerEvent } from "@netlify/functions";
import { RealOpenRouterProvider, type OpenRouterProvider } from "../openrouter/provider";

export const USER_OPENROUTER_KEY_HEADER = "x-user-openrouter-key";

// A stable, permanent-looking error code that is deliberately NOT part
// of errors.ts's EXTRACTION_HARD_FAILURE_CODES: that array mirrors
// exactly what the M7A migration's CHECK constraints accept for
// setup_extractions.final_status/setup_extraction_attempts.status, and
// this code must NEVER reach either column -- the check below always
// runs before any claim or persistence is attempted (zero claim, zero
// completion, zero spend), so it has no reason to exist in that
// migration-defined, persistable taxonomy at all.
export const OPENROUTER_NOT_CONNECTED = "OPENROUTER_NOT_CONNECTED" as const;

const MIN_KEY_LENGTH = 10;
const MAX_KEY_LENGTH = 512;

// Deliberately does not validate the key's exact format -- OpenRouter's
// own key shape is not this application's concern to pin down, and
// could change. An actually-invalid key still fails safely: the real
// OpenRouter API rejects it on the metadata/completion call itself,
// surfaced through the existing ProviderError/PROVIDER_UNAVAILABLE
// handling, never a silent fallback to anyone else's credential.
// `event.headers` keys are case-normalized by the Netlify runtime in
// practice, but this scans case-insensitively anyway rather than
// assuming a specific casing.
export function readUserOpenRouterKey(event: HandlerEvent): string | null {
  const headers = event.headers ?? {};
  let raw: string | undefined;

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === USER_OPENROUTER_KEY_HEADER) {
      raw = value;
      break;
    }
  }

  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();

  if (trimmed.length < MIN_KEY_LENGTH || trimmed.length > MAX_KEY_LENGTH) {
    return null;
  }

  return trimmed;
}

// A provider that throws on every method -- constructed only when no
// user credential was supplied. In normal operation this is never
// actually invoked: the caller's own header check (readUserOpenRouterKey
// above, checked before submitInitialExtraction/submitExtractionRetry
// is ever reached) already short-circuits with OPENROUTER_NOT_CONNECTED.
// It exists purely as a belt-and-suspenders guarantee -- if a future
// refactor ever removed that early check, this fails loud and immediate
// rather than silently falling back to any other credential (mirrors
// setup-extractions-preflight.ts's throwingRepository, the same
// defense-in-depth idiom applied to a different resource).
function createNotConnectedProvider(callerLabel: string): OpenRouterProvider {
  // A REJECTED PROMISE, not a synchronous throw -- every OpenRouterProvider
  // method is typed `(): Promise<T>`, and a synchronous throw from a
  // function callers expect to always return a Promise is a surprising,
  // easy-to-mishandle shape (e.g. `.catch()`/`expect(...).rejects` would
  // never see it). A synchronous throw would still be caught by any
  // surrounding try/catch in practice, but this is the more correct,
  // predictable interface conformance.
  const fail = (): Promise<never> =>
    Promise.reject(
      new Error(
        `OPENROUTER_NOT_CONNECTED: this provider must never be invoked -- ${callerLabel}'s own ` +
          "header check should already have short-circuited before any deps depending on it were used."
      )
    );

  return { listModels: fail, listEndpoints: fail, createChatCompletion: fail };
}

export type UserScopedProviders = {
  provider: OpenRouterProvider;
  createTimedProvider?: (timeoutMs: number) => OpenRouterProvider;
  createTimedMetadataProvider?: (timeoutMs: number) => OpenRouterProvider;
};

// Builds the provider-related ExtractionSourceDeps fields from a
// per-request user OpenRouter credential -- the ONE shared
// implementation both paid endpoints (setup-extractions.ts,
// setup-extractions-retry.ts) call, so "every provider is built from
// the user's key, never the operator's" has exactly one place to audit
// rather than two independently-maintained copies that could drift.
// `callerLabel` is purely for the not-connected provider's own error
// message (e.g. "handleSetupExtractionsRequest").
export function buildUserScopedProviders(
  userOpenRouterKey: string | null,
  callerLabel: string
): UserScopedProviders {
  if (!userOpenRouterKey) {
    return { provider: createNotConnectedProvider(callerLabel) };
  }

  return {
    provider: new RealOpenRouterProvider({ OPENROUTER_API_KEY: userOpenRouterKey }),
    createTimedProvider: (timeoutMs) =>
      new RealOpenRouterProvider({ OPENROUTER_API_KEY: userOpenRouterKey }, undefined, timeoutMs),
    createTimedMetadataProvider: (timeoutMs) =>
      new RealOpenRouterProvider({ OPENROUTER_API_KEY: userOpenRouterKey }, undefined, timeoutMs)
  };
}
