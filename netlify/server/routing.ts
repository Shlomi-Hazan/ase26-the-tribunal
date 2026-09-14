// Milestone 15 (M15 production routing correction) -- Netlify's own
// documented redirect/rewrite contract states a path placeholder "either
// matches a path segment from one `/` to the next `/`... but excluding a
// query string" (https://docs.netlify.com/manage/routing/redirects/
// redirect-options/). A placeholder is therefore never substituted into a
// rewrite target's QUERY STRING. netlify.toml previously relied on
// exactly that unsupported pattern (`to = ".../foo?id=:id"`) for four
// dynamic API routes -- it happened to work when a Function was invoked
// directly with a real `?id=<value>` query parameter (an ordinary query
// string Netlify parses normally), but never through the friendly public
// route, where the literal, un-substituted target text reached the
// Function instead of the real path segment (confirmed live in
// production: GET /api/cases/<real-uuid> returned 400 "must be a valid
// UUID", while GET /.netlify/functions/case-by-id?id=<real-uuid> returned
// the correct case).
//
// The fix: extract the dynamic identifier from the ORIGINAL incoming
// request path (`event.path`) instead of the target's query string. Every
// affected rule in netlify.toml is a `status = 200` rewrite/proxy (never
// a 301/302 redirect), and Netlify's documented rewrite contract keeps
// the original client-visible path -- `HandlerEvent.path` is the
// Function-side reflection of that same original path, distinct from the
// internal `/.netlify/functions/<name>` target.
//
// Independent-review correction: the FRIENDLY PUBLIC PATH is
// authoritative, not merely a fallback -- when `event.path` matches a
// route's expected shape, its own dynamic segment always wins, even if a
// caller also supplies a conflicting `?id=<other-value>` alongside it
// (e.g. `/api/setup-extractions/A/retry?id=B` always resolves `A`; this
// matters most for that endpoint since it is billable-capable). Direct
// Function invocation with an explicit `?id=<value>` query parameter
// remains supported for diagnostics, but only applies when the incoming
// path does NOT match any supported friendly route shape at all (e.g. a
// bare `/.netlify/functions/<name>?id=<value>` call). A literal
// un-substituted placeholder (e.g. a stray ":id") is never treated as a
// meaningful query value either way. The existing UUID/domain validation
// layer in each caller remains the sole authority over whether the
// resolved value is actually a well-formed identifier -- this module
// only ever resolves a string or null, never validates one.

/** Sentinel marking the single dynamic segment in a `RouteShape`. */
export const DYNAMIC_SEGMENT: unique symbol = Symbol("dynamic-path-segment");

export type RouteShape = ReadonlyArray<string | typeof DYNAMIC_SEGMENT>;

export const CASE_BY_ID_ROUTE_SHAPE: RouteShape = ["api", "cases", DYNAMIC_SEGMENT];
export const CASE_RUNS_ROUTE_SHAPE: RouteShape = ["api", "cases", DYNAMIC_SEGMENT, "runs"];
export const RUN_BY_ID_ROUTE_SHAPE: RouteShape = ["api", "runs", DYNAMIC_SEGMENT];
export const SETUP_EXTRACTION_RETRY_ROUTE_SHAPE: RouteShape = [
  "api",
  "setup-extractions",
  DYNAMIC_SEGMENT,
  "retry"
];

// Splits a path into segments and percent-decodes each one individually,
// so a reserved character encoded inside one segment (e.g. a literal "/"
// sent as %2F) is treated as content of that single segment, never
// re-interpreted as an extra path separator.
//
// Independent-review correction: only ONE leading "/" (every real path
// has exactly one) and ONE optional trailing "/" are tolerated here --
// this does NOT unconditionally filter out every empty segment. A
// doubled/interior "/" (e.g. "/api/cases//runs", "/api/cases/<id>//runs")
// now produces a real empty segment that fails this route's exact
// non-empty-segment match, rather than being silently discarded. A
// looser "filter out every empty segment" implementation would have let
// a malformed doubled-slash path like "/api/cases///runs" (no id at all)
// collapse into the WRONG route shape and be misread as
// "/api/cases/runs" with id "runs" -- confirmed reachable, not merely
// theoretical: Netlify's own redirect engine does not reject a
// doubled-slash path before it reaches the Function (verified live
// against production: GET /api/cases//test reached the Function exactly
// like GET /api/cases/test, both producing the same handler-level
// response).
function splitPathSegments(path: string): string[] {
  let working = path;

  if (working.startsWith("/")) {
    working = working.slice(1);
  }

  if (working.endsWith("/")) {
    working = working.slice(0, -1);
  }

  if (working.length === 0) {
    return [];
  }

  return working.split("/").map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
}

// Matches `path` against `shape` exactly -- identical segment count,
// every fixed segment equal -- and returns the single dynamic segment's
// decoded value, or null if the path does not match the shape at all
// (wrong segment count, a fixed-segment mismatch, or an empty dynamic
// segment). `shape` must declare exactly one dynamic segment; a caller
// passing a different count is a programmer error, never a
// request-dependent outcome, so it throws rather than returning null.
export function extractDynamicPathSegment(
  path: string | null | undefined,
  shape: RouteShape
): string | null {
  const dynamicCount = shape.filter((part) => part === DYNAMIC_SEGMENT).length;

  if (dynamicCount !== 1) {
    throw new Error("Route shape must declare exactly one dynamic segment.");
  }

  if (typeof path !== "string" || path.length === 0) {
    return null;
  }

  const segments = splitPathSegments(path);

  if (segments.length !== shape.length) {
    return null;
  }

  let dynamicValue: string | null = null;

  for (let index = 0; index < shape.length; index += 1) {
    const expected = shape[index];
    const actual = segments[index];

    if (expected === DYNAMIC_SEGMENT) {
      dynamicValue = actual;
      continue;
    }

    if (actual !== expected) {
      return null;
    }
  }

  return dynamicValue !== null && dynamicValue.length > 0 ? dynamicValue : null;
}

// A literal, un-substituted redirect placeholder token (e.g. a stray
// ":id") is never a meaningful identifier, even if it somehow arrives as
// a query parameter value. Path-segment extraction needs no equivalent
// special case: a request whose real path segment literally IS ":id"
// still flows through unchanged and is then rejected by the existing
// UUID/domain validation layer downstream, exactly like any other
// malformed identifier.
function isLiteralPlaceholder(value: string): boolean {
  return value.startsWith(":");
}

export type RouteIdEvent = {
  path?: string | null;
  queryStringParameters?: Record<string, string | undefined> | null;
};

// Resolves the single dynamic route identifier for a Function reachable
// both through its friendly public rewrite and, for direct diagnostic
// invocation, through an explicit `?id=<value>` query parameter.
//
// The FRIENDLY PUBLIC PATH is authoritative: when `event.path` matches
// `shape`, its own dynamic segment is returned unconditionally -- a
// caller-supplied `?id=<other-value>` can never override it. This
// matters most for the billable-capable POST /api/setup-extractions/:id/
// retry: the identifier a client sees named in the public URL is always
// the one this resolves, never a query parameter smuggled alongside it
// (e.g. `/api/setup-extractions/A/retry?id=B` always resolves `A`).
//
// Only when the incoming path does NOT match any supported friendly
// route shape (e.g. a direct `/.netlify/functions/<name>?id=<value>`
// diagnostic call) does an explicit, real, non-placeholder query `id`
// apply. A literal un-substituted placeholder value (e.g. a stray
// ":id") is never treated as meaningful in either case.
export function resolveRouteId(event: RouteIdEvent, shape: RouteShape): string | null {
  const pathId = extractDynamicPathSegment(event.path, shape);

  if (pathId !== null) {
    return pathId;
  }

  const rawQueryId = event.queryStringParameters?.id;

  if (typeof rawQueryId === "string" && rawQueryId.length > 0 && !isLiteralPlaceholder(rawQueryId)) {
    return rawQueryId;
  }

  return null;
}
