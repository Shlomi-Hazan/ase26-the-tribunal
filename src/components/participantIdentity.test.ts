import { describe, expect, it } from "vitest";
import { resolveParticipantIdentity } from "./participantIdentity";

// Human product decision (PR #34, product-wide participant-identity
// correction): the single centralized rule every real-run participant
// display site relies on. Generic names throughout -- this rule is not
// Jon-Snow-specific.
describe("resolveParticipantIdentity", () => {
  it("uses a meaningful profileName as primary and the seat label as secondary", () => {
    expect(resolveParticipantIdentity("David Cohen", "PRO I")).toEqual({
      primary: "David Cohen",
      secondarySeatLabel: "PRO I"
    });
  });

  it("trims a profileName with surrounding whitespace", () => {
    expect(resolveParticipantIdentity("  Sarah Levi  ", "CON I")).toEqual({
      primary: "Sarah Levi",
      secondarySeatLabel: "CON I"
    });
  });

  it("falls back to the seat label alone, with no secondary, when profileName is null", () => {
    expect(resolveParticipantIdentity(null, "Judge I")).toEqual({
      primary: "Judge I",
      secondarySeatLabel: null
    });
  });

  it("falls back to the seat label alone when profileName is undefined", () => {
    expect(resolveParticipantIdentity(undefined, "Judge I")).toEqual({
      primary: "Judge I",
      secondarySeatLabel: null
    });
  });

  it("falls back to the seat label alone when profileName is an empty string", () => {
    expect(resolveParticipantIdentity("", "Judge I")).toEqual({
      primary: "Judge I",
      secondarySeatLabel: null
    });
  });

  it("falls back to the seat label alone when profileName is whitespace-only", () => {
    expect(resolveParticipantIdentity("   ", "Judge I")).toEqual({
      primary: "Judge I",
      secondarySeatLabel: null
    });
  });

  it("never returns a duplicated primary/secondary pair in the fallback case", () => {
    const result = resolveParticipantIdentity(null, "PRO I");

    expect(result.primary).toBe("PRO I");
    expect(result.secondarySeatLabel).toBeNull();
  });
});
