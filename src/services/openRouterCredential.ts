// Milestone 7A -- user-funded OpenRouter BYOK correction (product/
// economics decision). The user's own OpenRouter API key, held ONLY in
// this tab's sessionStorage -- NEVER localStorage, NEVER sent to
// Supabase, NEVER logged. Extraction inference is charged to the
// user's own OpenRouter account, never the operator's
// (SECURITY.md Sec 3.1, docs/economics.md Sec 22.1). This is a
// deliberately minimal "paste your key" slice for submission -- the
// upgradeable-later path is OpenRouter's own OAuth + PKCE flow
// (openrouter.ai/docs/use-cases/oauth-pkce), out of scope for this
// pass; nothing here needs to change for that later upgrade beyond
// swapping how a key first arrives.

// Mirrors netlify/server/extraction/userOpenRouterKey.ts's
// USER_OPENROUTER_KEY_HEADER exactly -- server code cannot be imported
// into the client bundle (see npm run verify:client-bundle), so this is
// a second copy kept in sync by smartImport.test.tsx's anti-drift test,
// which imports the server module directly (safe: test files are never
// part of the Vite client bundle that script scans).
export const USER_OPENROUTER_KEY_HEADER = "x-user-openrouter-key";

const STORAGE_KEY = "tribunal.userOpenRouterKey";

export function getUserOpenRouterKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // sessionStorage can throw (private browsing, storage disabled) --
    // treated the same as "not connected," never a crash.
    return null;
  }
}

export function hasUserOpenRouterKey(): boolean {
  return getUserOpenRouterKey() !== null;
}

export function setUserOpenRouterKey(key: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // See getUserOpenRouterKey -- the key simply won't survive a
    // reload in that case; the caller's own React state still reflects
    // "connected" for the current page lifetime.
  }
}

export function clearUserOpenRouterKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // See getUserOpenRouterKey.
  }
}

// "do not display the full key again after connection" -- only the
// last 4 characters, for the user's own reassurance that the expected
// key is the one connected.
export function maskOpenRouterKey(key: string): string {
  if (key.length <= 4) {
    return "••••";
  }

  return `••••${key.slice(-4)}`;
}

// Attaches the connected credential to a fetch() headers object for a
// completion-capable request (submitExtraction/retryExtraction only --
// never requestExtractionPreflight, which makes zero completion calls
// and stays on the server's own metadata credential). Returns the
// headers unchanged if nothing is connected -- the server-side check
// (userOpenRouterKey.ts's readUserOpenRouterKey) is what actually
// enforces the requirement; this is purely a convenience for callers.
export function withUserOpenRouterKeyHeader(
  headers: Record<string, string>
): Record<string, string> {
  const key = getUserOpenRouterKey();

  if (!key) {
    return headers;
  }

  return { ...headers, [USER_OPENROUTER_KEY_HEADER]: key };
}
