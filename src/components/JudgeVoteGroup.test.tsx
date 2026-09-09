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

// Human product decision (PR #34, product-wide participant-identity
// correction): an OPTIONAL displayName -- every existing MockJudgeVote
// value above (no displayName field at all) continues to render
// unchanged, proving this component stays generic/mock-compatible and
// is never coupled to any specific case.
describe("JudgeVoteGroup optional displayName (product-wide, PR #34)", () => {
  it("shows the seat label alone when no displayName is supplied -- unchanged mock behavior", () => {
    renderGroup();

    expect(screen.getByText("Judge I")).toBeVisible();
  });

  it("shows a supplied displayName as primary with the seat label as secondary context", () => {
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <JudgeVoteGroup
          votes={[{ judge: "Judge I", displayName: "Justice Green", verdict: "GUILTY" }]}
        />
      </ThemeProvider>
    );

    expect(screen.getByText("Justice Green")).toBeVisible();
    expect(screen.getByText("Judge I")).toBeVisible();
  });
});

// Milestone 14 (COMPLETED-result judge-vote premium redesign) --
// `presentation="premium"` is additive/opt-in: every test above (no
// `presentation` prop supplied) proves the ORIGINAL branch is
// byte-for-byte unchanged. These tests cover the new, separate branch
// only -- never coupled to any specific case, using the same generic
// mock fixtures as the rest of this file.
describe("JudgeVoteGroup premium presentation (Milestone 14, opt-in)", () => {
  it("keeps the same data-testid and renders all three judge identities", () => {
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <JudgeVoteGroup presentation="premium" votes={VOTES} />
      </ThemeProvider>
    );

    expect(screen.getByTestId("judge-vote-group")).toBeInTheDocument();
    expect(screen.getByText("Judge I")).toBeVisible();
    expect(screen.getByText("Judge II")).toBeVisible();
    expect(screen.getByText("Judge III")).toBeVisible();
  });

  it("renders human-facing 'NOT GUILTY' (no underscore) when a verdictLabel formatter is supplied", () => {
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <JudgeVoteGroup
          presentation="premium"
          verdictLabel={(verdict) => (verdict === "NOT_GUILTY" ? "NOT GUILTY" : "GUILTY")}
          votes={VOTES}
        />
      </ThemeProvider>
    );

    expect(screen.getAllByText("GUILTY")).toHaveLength(2);
    expect(screen.getByText("NOT GUILTY")).toBeVisible();
    expect(screen.queryByText("NOT_GUILTY")).not.toBeInTheDocument();
  });

  it("still retains the literal enum text when no verdictLabel is supplied, even in premium presentation", () => {
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <JudgeVoteGroup presentation="premium" votes={VOTES} />
      </ThemeProvider>
    );

    expect(screen.getAllByText("GUILTY")).toHaveLength(2);
    expect(screen.getByText("NOT_GUILTY")).toBeVisible();
  });

  it("shows a supplied displayName as primary with the seat label as secondary context, same as the default branch", () => {
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <JudgeVoteGroup
          presentation="premium"
          votes={[{ judge: "Judge I", displayName: "Justice Green", verdict: "GUILTY" }]}
        />
      </ThemeProvider>
    );

    expect(screen.getByText("Justice Green")).toBeVisible();
    expect(screen.getByText("Judge I")).toBeVisible();
  });

  describe("deterministic panel summary (derived only from the persisted votes)", () => {
    it("shows 'Unanimous · 3–0' when all three votes match", () => {
      render(
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <JudgeVoteGroup
            presentation="premium"
            votes={[
              { judge: "Judge I", verdict: "GUILTY" },
              { judge: "Judge II", verdict: "GUILTY" },
              { judge: "Judge III", verdict: "GUILTY" }
            ]}
          />
        </ThemeProvider>
      );

      expect(screen.getByText("Unanimous · 3–0")).toBeVisible();
    });

    it("shows 'Majority · 2–1' for a split panel", () => {
      render(
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <JudgeVoteGroup presentation="premium" votes={VOTES} />
        </ThemeProvider>
      );

      // VOTES above is 2 GUILTY / 1 NOT_GUILTY.
      expect(screen.getByText("Majority · 2–1")).toBeVisible();
    });
  });
});

function hexToRgb(hex: string): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);

  return `rgb(${r}, ${g}, ${b})`;
}
