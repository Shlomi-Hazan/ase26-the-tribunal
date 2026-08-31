import type { Verdict } from "../mocks/tribunalMockData";

// Post-M9 Result UX follow-up (originally recorded under the M14 UI
// Polish & Accessibility note, pulled forward): the single source of
// truth for the locked GUILTY -> error / NOT_GUILTY -> success semantic
// mapping. Shared by RunPage.tsx and JudgeVoteGroup.tsx so the large
// verdict, the vote-group cards, and each Judge Accordion summary never
// drift from one another. A plain function, not a component, in its own
// file -- kept out of JudgeVoteGroup.tsx to preserve that file's
// component-only Fast Refresh boundary. Color is always an addition to
// the literal verdict text, never a replacement for it.
export function verdictColor(verdict: Verdict): "error" | "success" {
  return verdict === "GUILTY" ? "error" : "success";
}
