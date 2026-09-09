import { describe, expect, it } from "vitest";
import { isJonSnowThemedPath } from "./jonSnowThemeRoute";

// Milestone 14 (Ivory & Iron, Issue #39 Phase 4, required test 5 of 5):
// theme selection is a PURE FUNCTION of location.pathname -- no hook,
// no component state, no sessionStorage/localStorage read, nothing
// persisted on the run/case record, and nothing derived from
// defendant/case content. This directly exercises that function in
// isolation, independent of React/Router/rendering.
//
// M14 presentation-routing correction (PR #40): narrowed from a
// `startsWith` prefix match to an exact match on the settings page
// itself -- the dark chamber is the Jon Snow demo/settings experience's
// own identity, never the run/result screen's. The legacy
// `/demo/jon-snow/runs/:runId` URL now redirects to the generic
// `/runs/:runId` (App.tsx's LegacyJonSnowRunRedirect) rather than
// rendering its own themed presentation, so it must be false here too.
describe("isJonSnowThemedPath (Milestone 14, Issue #39 Phase 4 + presentation-routing correction)", () => {
  it("is true only for the exact Jon Snow settings route", () => {
    expect(isJonSnowThemedPath("/demo/jon-snow")).toBe(true);
    expect(isJonSnowThemedPath("/demo/jon-snow/")).toBe(true);
  });

  it("is false for the (now-redirecting) legacy Jon Snow run route, the generic run route, and every other route, even for the exact same run id", () => {
    expect(
      isJonSnowThemedPath("/demo/jon-snow/runs/99999999-9999-4999-8999-999999999999")
    ).toBe(false);
    expect(isJonSnowThemedPath("/runs/99999999-9999-4999-8999-999999999999")).toBe(false);
    expect(isJonSnowThemedPath("/")).toBe(false);
    expect(isJonSnowThemedPath("/history")).toBe(false);
    expect(isJonSnowThemedPath("/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(false);
    expect(isJonSnowThemedPath("/new/charge-sheet")).toBe(false);
  });
});
