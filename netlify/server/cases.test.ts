import { describe, expect, it } from "vitest";
import { sortCasesDeterministically, type PersistedCase } from "./cases";

function persistedCase(overrides: Partial<PersistedCase> = {}): PersistedCase {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    defendant: "Alex Rowan",
    act: "Entered the restricted lab.",
    exactQuestion: "Did Alex knowingly violate the lab protocol?",
    sourceType: "MANUAL",
    sourceFilename: null,
    createdAt: "2026-08-25T10:00:00.000Z",
    ...overrides
  };
}

// Milestone 11 (Issue #27) -- the in-memory defense-in-depth tie-break
// applied alongside the equivalent ORDER BY list() also requests from
// Postgres. cases.created_at is NOT NULL but not UNIQUE, so this proves
// the deterministic total order directly, without mocking Supabase.
describe("sortCasesDeterministically (Milestone 11, Issue #27)", () => {
  it("orders by createdAt DESC", () => {
    const older = persistedCase({
      id: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-25T10:00:00.000Z"
    });
    const newer = persistedCase({
      id: "00000000-0000-4000-8000-000000000002",
      createdAt: "2026-08-26T10:00:00.000Z"
    });

    expect(sortCasesDeterministically([older, newer])).toEqual([newer, older]);
  });

  it("uses id DESC as a stable tie-break when createdAt is identical", () => {
    const a = persistedCase({ id: "00000000-0000-4000-8000-000000000001" });
    const b = persistedCase({ id: "00000000-0000-4000-8000-000000000002" });

    expect(sortCasesDeterministically([a, b])).toEqual([b, a]);
    // Order-of-input independence: the same tie-break wins regardless of
    // the order Postgres/the fake happened to hand the rows back in.
    expect(sortCasesDeterministically([b, a])).toEqual([b, a]);
  });
});
