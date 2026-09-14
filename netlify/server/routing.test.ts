// Milestone 15 (M15 production routing correction) -- unit coverage for
// the shared dynamic-route-id resolution helper. See routing.ts's own
// module comment for the full production root-cause: a Netlify path
// placeholder is documented to never substitute into a rewrite target's
// query string, so `resolveRouteId` extracts the dynamic identifier from
// the original incoming request path instead.

import { describe, expect, it } from "vitest";
import {
  CASE_BY_ID_ROUTE_SHAPE,
  CASE_RUNS_ROUTE_SHAPE,
  DYNAMIC_SEGMENT,
  RUN_BY_ID_ROUTE_SHAPE,
  SETUP_EXTRACTION_RETRY_ROUTE_SHAPE,
  extractDynamicPathSegment,
  resolveRouteId,
  type RouteShape
} from "./routing";

const CASE_ID = "f13a74a5-1c7e-46a6-b35e-4d622e171cbe";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const EXTRACTION_ID = "22222222-2222-4222-8222-222222222222";

describe("extractDynamicPathSegment", () => {
  it("A: extracts the id from a friendly /api/cases/:id path", () => {
    expect(extractDynamicPathSegment(`/api/cases/${CASE_ID}`, CASE_BY_ID_ROUTE_SHAPE)).toBe(CASE_ID);
  });

  it("B: extracts the id from a friendly /api/cases/:id/runs path", () => {
    expect(
      extractDynamicPathSegment(`/api/cases/${CASE_ID}/runs`, CASE_RUNS_ROUTE_SHAPE)
    ).toBe(CASE_ID);
  });

  it("C: extracts the id from a friendly /api/runs/:id path", () => {
    expect(extractDynamicPathSegment(`/api/runs/${RUN_ID}`, RUN_BY_ID_ROUTE_SHAPE)).toBe(RUN_ID);
  });

  it("D: extracts the id from a friendly /api/setup-extractions/:id/retry path", () => {
    expect(
      extractDynamicPathSegment(
        `/api/setup-extractions/${EXTRACTION_ID}/retry`,
        SETUP_EXTRACTION_RETRY_ROUTE_SHAPE
      )
    ).toBe(EXTRACTION_ID);
  });

  it("tolerates a leading/trailing slash and percent-decodes the dynamic segment", () => {
    expect(extractDynamicPathSegment(`/api/cases/${CASE_ID}/`, CASE_BY_ID_ROUTE_SHAPE)).toBe(CASE_ID);
    expect(extractDynamicPathSegment(`/api/cases/not%2Fa-uuid`, CASE_BY_ID_ROUTE_SHAPE)).toBe(
      "not/a-uuid"
    );
  });

  it("returns null for a missing trailing segment (/api/cases/)", () => {
    expect(extractDynamicPathSegment("/api/cases/", CASE_BY_ID_ROUTE_SHAPE)).toBeNull();
  });

  it("returns null for an unexpected extra trailing segment (/api/cases/:id/unexpected)", () => {
    expect(
      extractDynamicPathSegment(`/api/cases/${CASE_ID}/unexpected`, CASE_BY_ID_ROUTE_SHAPE)
    ).toBeNull();
  });

  it("returns null for a malformed shape with an extra segment (/api/cases/not-a-uuid/extra)", () => {
    expect(
      extractDynamicPathSegment("/api/cases/not-a-uuid/extra", CASE_BY_ID_ROUTE_SHAPE)
    ).toBeNull();
  });

  it("returns null for an unexpected trailing segment on the runs collection (/api/cases/:id/runs/extra)", () => {
    expect(
      extractDynamicPathSegment(`/api/cases/${CASE_ID}/runs/extra`, CASE_RUNS_ROUTE_SHAPE)
    ).toBeNull();
  });

  it("returns null for a missing trailing segment (/api/runs/)", () => {
    expect(extractDynamicPathSegment("/api/runs/", RUN_BY_ID_ROUTE_SHAPE)).toBeNull();
  });

  it("returns null for an unexpected extra trailing segment (/api/runs/:id/extra)", () => {
    expect(extractDynamicPathSegment(`/api/runs/${RUN_ID}/extra`, RUN_BY_ID_ROUTE_SHAPE)).toBeNull();
  });

  it("returns null for an empty dynamic segment produced by a doubled slash (/api/setup-extractions//retry)", () => {
    expect(
      extractDynamicPathSegment("/api/setup-extractions//retry", SETUP_EXTRACTION_RETRY_ROUTE_SHAPE)
    ).toBeNull();
  });

  it("returns null for an unexpected trailing segment (/api/setup-extractions/:id/retry/extra)", () => {
    expect(
      extractDynamicPathSegment(
        `/api/setup-extractions/${EXTRACTION_ID}/retry/extra`,
        SETUP_EXTRACTION_RETRY_ROUTE_SHAPE
      )
    ).toBeNull();
  });

  it("returns null for a completely different route shape", () => {
    expect(extractDynamicPathSegment(`/api/runs/${RUN_ID}`, CASE_BY_ID_ROUTE_SHAPE)).toBeNull();
  });

  it("returns null for a missing/empty path", () => {
    expect(extractDynamicPathSegment(undefined, CASE_BY_ID_ROUTE_SHAPE)).toBeNull();
    expect(extractDynamicPathSegment(null, CASE_BY_ID_ROUTE_SHAPE)).toBeNull();
    expect(extractDynamicPathSegment("", CASE_BY_ID_ROUTE_SHAPE)).toBeNull();
  });

  it("a literal, un-substituted placeholder path segment extracts as the literal text (rejected later by validation, not here)", () => {
    expect(extractDynamicPathSegment("/api/cases/:id", CASE_BY_ID_ROUTE_SHAPE)).toBe(":id");
  });

  it("throws for a caller-supplied shape with zero or more than one dynamic segment (programmer error)", () => {
    const noDynamic: RouteShape = ["api", "cases"];
    const twoDynamic: RouteShape = ["api", DYNAMIC_SEGMENT, DYNAMIC_SEGMENT];

    expect(() => extractDynamicPathSegment("/api/cases", noDynamic)).toThrow();
    expect(() => extractDynamicPathSegment("/api/a/b", twoDynamic)).toThrow();
  });
});

describe("resolveRouteId", () => {
  it("extracts from the friendly path when queryStringParameters.id is absent", () => {
    const id = resolveRouteId(
      { path: `/api/cases/${CASE_ID}`, queryStringParameters: null },
      CASE_BY_ID_ROUTE_SHAPE
    );

    expect(id).toBe(CASE_ID);
  });

  it("extracts from the friendly path when queryStringParameters is an empty object", () => {
    const id = resolveRouteId(
      { path: `/api/cases/${CASE_ID}`, queryStringParameters: {} },
      CASE_BY_ID_ROUTE_SHAPE
    );

    expect(id).toBe(CASE_ID);
  });

  it("prefers a real, non-placeholder query id for direct Function invocation compatibility", () => {
    const id = resolveRouteId(
      { path: "/.netlify/functions/case-by-id", queryStringParameters: { id: CASE_ID } },
      CASE_BY_ID_ROUTE_SHAPE
    );

    expect(id).toBe(CASE_ID);
  });

  it("a literal query id of ':id' is never used -- falls through to path extraction instead", () => {
    const id = resolveRouteId(
      { path: `/api/cases/${CASE_ID}`, queryStringParameters: { id: ":id" } },
      CASE_BY_ID_ROUTE_SHAPE
    );

    expect(id).toBe(CASE_ID);
  });

  it("returns null when neither a real query id nor a matching path is present", () => {
    const id = resolveRouteId(
      { path: "/api/cases", queryStringParameters: {} },
      CASE_BY_ID_ROUTE_SHAPE
    );

    expect(id).toBeNull();
  });
});
