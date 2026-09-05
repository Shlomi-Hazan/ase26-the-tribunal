import { describe, expect, it } from "vitest";
import { isJonSnowThemedPath } from "./jonSnowThemeRoute";

// Milestone 14 (Ivory & Iron, Issue #39 Phase 4, required test 5 of 5):
// theme selection is a PURE FUNCTION of location.pathname -- no hook,
// no component state, no sessionStorage/localStorage read, nothing
// persisted on the run/case record, and nothing derived from
// defendant/case content. This directly exercises that function in
// isolation, independent of React/Router/rendering.
describe("isJonSnowThemedPath (Milestone 14, Issue #39 Phase 4)", () => {
  it("is true for the two dedicated Jon Snow demo routes", () => {
    expect(isJonSnowThemedPath("/demo/jon-snow")).toBe(true);
    expect(
      isJonSnowThemedPath("/demo/jon-snow/runs/99999999-9999-4999-8999-999999999999")
    ).toBe(true);
  });

  it("is false for the generic run route and every other route, even for the exact same run id", () => {
    expect(isJonSnowThemedPath("/runs/99999999-9999-4999-8999-999999999999")).toBe(false);
    expect(isJonSnowThemedPath("/")).toBe(false);
    expect(isJonSnowThemedPath("/history")).toBe(false);
    expect(isJonSnowThemedPath("/cases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(false);
    expect(isJonSnowThemedPath("/new/charge-sheet")).toBe(false);
  });
});
