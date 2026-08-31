// Post-M9 Result UX follow-up (originally recorded under the M14 UI
// Polish & Accessibility note, pulled forward): JudgeVoteGroup must
// visually/semantically distinguish GUILTY from NOT_GUILTY while always
// retaining the literal verdict text -- color is an addition, never a
// replacement.

import { CssBaseline, ThemeProvider } from "@mui/material";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { MockJudgeVote } from "../mocks/tribunalMockData";
import { theme } from "../theme/theme";
import { JudgeVoteGroup } from "./JudgeVoteGroup";

const VOTES: MockJudgeVote[] = [
  {
    judge: "Judge I",
    verdict: "GUILTY",
    model: "openai/gpt-5-nano",
    personality: "Neutral.",
    reasoning: "Guilty reasoning."
  },
  {
    judge: "Judge II",
    verdict: "NOT_GUILTY",
    model: "openai/gpt-5-nano",
    personality: "Neutral.",
    reasoning: "Not guilty reasoning."
  },
  {
    judge: "Judge III",
    verdict: "GUILTY",
    model: "openai/gpt-5-nano",
    personality: "Neutral.",
    reasoning: "Guilty reasoning."
  }
];

function renderGroup() {
  return render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <JudgeVoteGroup votes={VOTES} />
    </ThemeProvider>
  );
}

describe("JudgeVoteGroup verdict presentation (post-M9 Result UX follow-up)", () => {
  it("retains the literal GUILTY/NOT_GUILTY text for every card", () => {
    renderGroup();

    expect(screen.getAllByText("GUILTY")).toHaveLength(2);
    expect(screen.getAllByText("NOT_GUILTY")).toHaveLength(1);
  });

  it("gives GUILTY cards the theme's error color, not the same treatment as NOT_GUILTY", () => {
    renderGroup();

    const [guiltyOne] = screen.getAllByText("GUILTY");
    const notGuilty = screen.getByText("NOT_GUILTY");

    expect(getComputedStyle(guiltyOne).color).toBe(hexToRgb(theme.palette.error.main));
    expect(getComputedStyle(notGuilty).color).toBe(hexToRgb(theme.palette.success.main));
    expect(getComputedStyle(guiltyOne).color).not.toBe(getComputedStyle(notGuilty).color);
  });
});

function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);

  return `rgb(${r}, ${g}, ${b})`;
}
