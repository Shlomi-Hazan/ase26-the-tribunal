// PRO/CON semantic correction (Issue #30) -- these M4-era UI-shell demo
// fixtures previously encoded the reversed assumption (PRO -> GUILTY,
// CON -> NOT_GUILTY-leaning). They are never real historical Tribunal
// output, so correcting them directly carries no historical-integrity
// risk. This test proves the reversed framing is gone and the corrected
// PRO = Defense / CON = Opposition-Prosecution framing is present.

import { describe, expect, it } from "vitest";
import { mockAdvocateSpeeches, mockJudgeVotes } from "./tribunalMockData";

describe("mock fixtures no longer encode PRO -> GUILTY / CON -> NOT_GUILTY", () => {
  it("PRO speeches read as Defense arguments, not prosecution-style guilt claims", () => {
    const proSpeeches = mockAdvocateSpeeches.filter((speech) => speech.side === "PRO");

    expect(proSpeeches).toHaveLength(2);
    for (const speech of proSpeeches) {
      expect(speech.speech).toMatch(/Defense|innocent/i);
    }
  });

  it("CON speeches read as Opposition/Prosecution arguments, not reasonable-doubt claims", () => {
    const conSpeeches = mockAdvocateSpeeches.filter((speech) => speech.side === "CON");

    expect(conSpeeches).toHaveLength(2);
    for (const speech of conSpeeches) {
      expect(speech.speech).toMatch(/Prosecution|responsibility/i);
    }
  });

  it("judge reasoning no longer frames PRO as the guilt-supporting side or CON as the doubt-raising side", () => {
    const reasoningText = mockJudgeVotes.map((vote) => vote.reasoning).join(" ");

    expect(reasoningText).not.toMatch(/PRO arguments more internally consistent/);
    expect(reasoningText).not.toMatch(/uncertainty in the CON explanation/);
  });
});
