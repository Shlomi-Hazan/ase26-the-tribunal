import { describe, expect, it } from "vitest";
import { FakeAdmissionControl } from "./admissionControl";

// Milestone 13 (Issue #36 G3) -- the shared, domain-generic admission-
// control fake both /api/runs and the Jon Snow demo endpoint's own tests
// use. Mirrors the real check_and_record_admission RPC's semantics.
describe("FakeAdmissionControl", () => {
  it("admits up to maxRequests within the window, then rejects", async () => {
    const control = new FakeAdmissionControl(() => 0);

    expect(await control.checkAndRecordAdmission("b", "1", 180, 3)).toBe(true);
    expect(await control.checkAndRecordAdmission("b", "2", 180, 3)).toBe(true);
    expect(await control.checkAndRecordAdmission("b", "3", 180, 3)).toBe(true);
    expect(await control.checkAndRecordAdmission("b", "4", 180, 3)).toBe(false);
  });

  it("the same non-null requestId never consumes a second slot", async () => {
    const control = new FakeAdmissionControl(() => 0);

    expect(await control.checkAndRecordAdmission("b", "same", 180, 1)).toBe(true);
    expect(await control.checkAndRecordAdmission("b", "same", 180, 1)).toBe(true);
    // A genuinely different id still hits the now-exhausted window.
    expect(await control.checkAndRecordAdmission("b", "different", 180, 1)).toBe(false);
  });

  it("distinct buckets are independent", async () => {
    const control = new FakeAdmissionControl(() => 0);

    expect(await control.checkAndRecordAdmission("run-start", "1", 180, 1)).toBe(true);
    expect(await control.checkAndRecordAdmission("run-start", "2", 180, 1)).toBe(false);
    expect(await control.checkAndRecordAdmission("jon-snow-demo-start", "3", 180, 1)).toBe(true);
  });

  it("a request outside the sliding window is evicted and no longer counts", async () => {
    let now = 0;
    const control = new FakeAdmissionControl(() => now);

    expect(await control.checkAndRecordAdmission("b", "1", 1, 1)).toBe(true);
    now = 2000; // 2s later, window is 1s -- the first event has expired.
    expect(await control.checkAndRecordAdmission("b", "2", 1, 1)).toBe(true);
  });

  // Corrected (independent review, PR #37): the real check_and_record_
  // admission RPC prunes with `created_at < now() - window` -- a strict
  // less-than. An event whose timestamp lands EXACTLY at the boundary
  // (`now - window`) does NOT satisfy that strict inequality, so the
  // real RPC does NOT prune it -- it still counts. The fake must match
  // this exactly, not evict on the boundary itself.
  it("an event exactly at the window boundary (now - window) still counts, matching the real SQL's strict `<` pruning", async () => {
    let now = 0;
    const control = new FakeAdmissionControl(() => now);

    expect(await control.checkAndRecordAdmission("b", "1", 1, 1)).toBe(true); // timestamp = 0
    now = 1000; // exactly one window (1s) later -- windowStart = now - 1000 = 0, same as the event's own timestamp.
    // The window is still "full" (the boundary event still counts), so
    // a second, distinct request is rejected.
    expect(await control.checkAndRecordAdmission("b", "2", 1, 1)).toBe(false);
    now = 1001; // one ms past the boundary -- now the event is genuinely pruned.
    expect(await control.checkAndRecordAdmission("b", "3", 1, 1)).toBe(true);
  });

  it("a null requestId (e.g. a caller with no logical-request identity) never dedups against itself -- each call is independently counted", async () => {
    const control = new FakeAdmissionControl(() => 0);

    expect(await control.checkAndRecordAdmission("b", null, 180, 2)).toBe(true);
    expect(await control.checkAndRecordAdmission("b", null, 180, 2)).toBe(true);
    expect(await control.checkAndRecordAdmission("b", null, 180, 2)).toBe(false);
  });
});
