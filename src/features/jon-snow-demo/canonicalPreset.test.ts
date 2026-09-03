import { describe, expect, it } from "vitest";
import {
  chargeSheetLimits,
  participantIds,
  personalityLimit,
  profileNameLimit
} from "../../schemas/tribunalSetup";
import {
  JON_SNOW_CASE_SOURCE_TYPE,
  JON_SNOW_CHARGE_SHEET,
  JON_SNOW_DOSSIER_DISCLAIMER,
  JON_SNOW_PARTICIPANTS,
  JON_SNOW_PRESET_VERSION
} from "./canonicalPreset";

// Milestone 12 (Issue #32 Sec 2/3/17) -- canonical-data drift prevention.
// Every assertion below pins content drawn verbatim from the lecturer's
// case-design dossier; a change here should only ever happen as a
// deliberate correction to the preset, never silently.

describe("Jon Snow canonical preset -- version identity", () => {
  it("has an explicit, stable content version", () => {
    expect(JON_SNOW_PRESET_VERSION).toBe("jon-snow-v1");
  });
});

describe("Jon Snow canonical preset -- Charge Sheet", () => {
  it("has the exact locked Defendant", () => {
    expect(JON_SNOW_CHARGE_SHEET.defendant).toBe("Jon Snow");
  });

  it("has the exact dossier Exact Question, including its typographic apostrophe", () => {
    expect(JON_SNOW_CHARGE_SHEET.exactQuestion).toBe(
      "Was Jon Snow’s intentional killing of Daenerys Targaryen justified as the necessary defense of others and of the realm, given what he knew, the scale of the threatened harm, the absence or presence of safer alternatives, and his lack of formal authority?"
    );
    // ’ is the dossier's actual right single quotation mark -- never
    // silently normalized to a plain ASCII apostrophe (Issue #32 Sec 2).
    expect(JON_SNOW_CHARGE_SHEET.exactQuestion).toContain("Snow’s");
    expect(JON_SNOW_CHARGE_SHEET.exactQuestion).not.toContain("Snow's");
  });

  it("normalizes the complete Act without dropping any agreed fact", () => {
    expect(JON_SNOW_CHARGE_SHEET.act).toContain(
      "Jon intentionally killed Daenerys by stabbing her during a private meeting"
    );
    expect(JON_SNOW_CHARGE_SHEET.act).toContain(
      "Westeros, a continent where powerful families compete for the Iron Throne"
    );
    // Dossier-fidelity correction (PR #34 independent source review):
    // the dossier's actual heading has NO colon -- an earlier revision
    // added one, which is now removed.
    expect(JON_SNOW_CHARGE_SHEET.act).toContain("Agreed factual record\n");
    expect(JON_SNOW_CHARGE_SHEET.act).not.toContain("Agreed factual record:");
    // All five agreed-fact bullets, verbatim -- none dropped for length.
    expect(JON_SNOW_CHARGE_SHEET.act).toContain("King’s Landing had surrendered");
    expect(JON_SNOW_CHARGE_SHEET.act).toContain(
      "the campaign of “liberation” would continue"
    );
    expect(JON_SNOW_CHARGE_SHEET.act).toContain("Tyrion Lannister renounced his office as Hand");
    expect(JON_SNOW_CHARGE_SHEET.act).toContain("Jon asked Daenerys to forgive Tyrion");
    expect(JON_SNOW_CHARGE_SHEET.act).toContain("Daenerys was unarmed and was not attacking Jon");
    // Exact source apostrophes, not ASCII-normalized substitutes.
    expect(JON_SNOW_CHARGE_SHEET.act).toContain("Jon’s hidden parentage");
    expect(JON_SNOW_CHARGE_SHEET.act).toContain("Jon’s sisters");
    expect(JON_SNOW_CHARGE_SHEET.act).not.toMatch(/Jon's|King's|Daenerys'/);
  });

  it("fits comfortably inside the existing Charge Sheet schema limits, with no truncation", () => {
    expect(JON_SNOW_CHARGE_SHEET.defendant.length).toBeLessThanOrEqual(chargeSheetLimits.defendant);
    expect(JON_SNOW_CHARGE_SHEET.exactQuestion.length).toBeLessThanOrEqual(
      chargeSheetLimits.exactQuestion
    );
    expect(JON_SNOW_CHARGE_SHEET.act.length).toBeLessThanOrEqual(chargeSheetLimits.act);
    expect(JON_SNOW_CHARGE_SHEET.act.length).toBeGreaterThan(2000);
  });

  it("uses the least-misleading existing sourceType, MANUAL, with no fabricated filename", () => {
    expect(JON_SNOW_CASE_SOURCE_TYPE).toBe("MANUAL");
  });
});

describe("Jon Snow canonical preset -- seat mapping", () => {
  it("maps the dossier's defense seat to PRO -- Jon Snow and Tyrion Lannister", () => {
    expect(JON_SNOW_PARTICIPANTS["advocate-pro-1"].profileName).toBe("Jon Snow");
    expect(JON_SNOW_PARTICIPANTS["advocate-pro-2"].profileName).toBe("Tyrion Lannister");
  });

  it("maps the dossier's prosecution seat to CON -- Daenerys Targaryen and Grey Worm", () => {
    expect(JON_SNOW_PARTICIPANTS["advocate-con-1"].profileName).toBe("Daenerys Targaryen");
    expect(JON_SNOW_PARTICIPANTS["advocate-con-2"].profileName).toBe("Grey Worm");
  });

  it("never maps Daenerys or Grey Worm to a PRO seat", () => {
    expect(JON_SNOW_PARTICIPANTS["advocate-pro-1"].profileName).not.toBe("Daenerys Targaryen");
    expect(JON_SNOW_PARTICIPANTS["advocate-pro-2"].profileName).not.toBe("Grey Worm");
  });

  it("maps the three judicial-method profiles to the three fixed Judge seats", () => {
    expect(JON_SNOW_PARTICIPANTS["judge-1"].profileName).toBe("Aharon Barak");
    expect(JON_SNOW_PARTICIPANTS["judge-2"].profileName).toBe("Menachem Elon");
    expect(JON_SNOW_PARTICIPANTS["judge-3"].profileName).toBe("Meir Shamgar");
  });

  it("defines exactly the seven fixed participant ids and no others", () => {
    expect(Object.keys(JON_SNOW_PARTICIPANTS).sort()).toEqual([...participantIds].sort());
  });
});

describe("Jon Snow canonical preset -- judicial-profile fidelity", () => {
  // Dossier-fidelity correction (PR #34 independent source review): an
  // earlier revision appended an invented sentence to every Judge
  // personality that does not appear anywhere in the dossier. It must
  // never reappear in a personality string; the dossier's real, single
  // global disclaimer is a separate exported constant instead, asserted
  // below.
  it("never appends the invented non-impersonation sentence to a Judge personality", () => {
    for (const judgeId of ["judge-1", "judge-2", "judge-3"] as const) {
      expect(JON_SNOW_PARTICIPANTS[judgeId].personality).not.toContain(
        "research-based simulations"
      );
      expect(JON_SNOW_PARTICIPANTS[judgeId].personality).not.toContain("impersonate");
    }
  });

  it("exposes the dossier's actual global disclaimer verbatim, once, as its own constant", () => {
    expect(JON_SNOW_DOSSIER_DISCLAIMER).toBe(
      "Fictional proceeding. The profiles adapt judicial methods; they do not impersonate the judges or predict a real court."
    );
  });
});

describe("Jon Snow canonical preset -- personality/schema validation", () => {
  it("keeps every profile name and personality within the existing limits, with no silent truncation", () => {
    for (const preset of Object.values(JON_SNOW_PARTICIPANTS)) {
      expect(preset.profileName!.length).toBeGreaterThan(0);
      expect(preset.profileName!.length).toBeLessThanOrEqual(profileNameLimit);
      expect(preset.personality.length).toBeGreaterThan(0);
      expect(preset.personality.length).toBeLessThanOrEqual(personalityLimit);
    }
  });

  it("marks every participant's personality source as manual, with no fabricated filename", () => {
    for (const preset of Object.values(JON_SNOW_PARTICIPANTS)) {
      expect(preset.personalitySource).toBe("manual");
    }
  });

  // Importing the module already runs chargeSheetSchema.parse/
  // participantDraftSchema.parse at module load (canonicalPreset.ts) --
  // this test simply proves that succeeded (an import failure would have
  // already failed every test in this file with a thrown module error).
  it("validates against the existing Tribunal setup schemas without throwing", () => {
    expect(JON_SNOW_CHARGE_SHEET).toBeDefined();
    expect(Object.keys(JON_SNOW_PARTICIPANTS)).toHaveLength(7);
  });
});
