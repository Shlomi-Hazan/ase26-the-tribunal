// Milestone 12 (human product override, PR #34) -- the lecturer's demo
// access capability. NOT the OpenRouter provider credential -- that
// stays server-side only (SECURITY.md Sec 3.1.1). This is a revocable
// capability the operator hands the lecturer via a prepared presentation
// link, carried in the URL FRAGMENT (never sent to any server
// automatically, unlike a query string), captured once at app startup,
// held only in this tab's sessionStorage, and immediately stripped from
// the visible URL/history.
//
// Mirrors src/services/openRouterCredential.ts's exact storage/header
// style (sessionStorage only, never localStorage, never logged, never
// echoed) -- deliberately a SEPARATE storage key and a SEPARATE header
// name, so this capability can never be confused with, or substituted
// for, the user's own OpenRouter credential on any other request.

export const JON_SNOW_DEMO_ACCESS_HEADER = "x-jon-snow-demo-access";

const STORAGE_KEY = "tribunal.jonSnowDemoAccess";
const FRAGMENT_PARAM = "demo";

// Called once at app startup (src/app/App.tsx). Detects
// `#demo=<token>` in the current URL, stores it, and removes it from
// the visible address bar/history -- a plain non-empty-string presence/
// format check only; the real token is validated authoritatively
// server-side on every request that carries it.
export function captureJonSnowDemoAccessFromLocation(): void {
  const hash = window.location.hash;

  if (!hash || hash.length < 2) {
    return;
  }

  let token: string | null;

  try {
    token = new URLSearchParams(hash.slice(1)).get(FRAGMENT_PARAM);
  } catch {
    return;
  }

  const trimmed = token?.trim();

  if (!trimmed) {
    return;
  }

  try {
    sessionStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    // sessionStorage can throw (private browsing, storage disabled) --
    // the capability simply won't survive this tab; never a crash.
  }

  // Strip the token from the visible URL/history immediately -- a
  // fragment never reaches the server on its own, but it does remain
  // visible in the address bar and browser history otherwise.
  try {
    const url = new URL(window.location.href);

    url.hash = "";
    window.history.replaceState(null, "", url.toString());
  } catch {
    // Non-fatal -- the capability is already stored above regardless.
  }
}

export function getJonSnowDemoAccessToken(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function hasJonSnowDemoAccess(): boolean {
  return getJonSnowDemoAccessToken() !== null;
}

// Attaches the stored capability to a fetch() headers object for the
// dedicated demo endpoint only -- returns the headers unchanged when
// nothing is stored, in which case the server's own access check
// rejects the request (zero case/run creation, zero provider execution).
export function withJonSnowDemoAccessHeader(
  headers: Record<string, string>
): Record<string, string> {
  const token = getJonSnowDemoAccessToken();

  if (!token) {
    return headers;
  }

  return { ...headers, [JON_SNOW_DEMO_ACCESS_HEADER]: token };
}
