import { Box, Card, CardContent, Divider, Stack, Typography } from "@mui/material";
import { ScaleIcon } from "./icons/LineIcons";
import type { MockJudgeVote } from "../mocks/tribunalMockData";
import { monoFontStack } from "../theme/theme";
import { verdictColor } from "./verdictColor";

// Human product decision (PR #34, product-wide participant-identity
// correction): a structurally wider shape than MockJudgeVote -- adds an
// OPTIONAL displayName so a real run can supply a persisted profileName
// as the primary identity while `judge` stays the seat label (secondary
// context, or the sole identity when displayName is absent). Every
// existing MockJudgeVote value (ResultPage's mock fixtures) already
// satisfies this type unchanged -- displayName is simply never present
// for mock data, so mock rendering is byte-for-byte unaffected. Never
// coupled to Jon Snow or any other specific case.
export type JudgeVoteDisplay = Pick<MockJudgeVote, "judge" | "verdict"> & {
  displayName?: string;
};

// Milestone 14 (COMPLETED-result judge-vote premium redesign) -- a
// purely deterministic panel-level summary derived ONLY from the counts
// already present in `votes`. Never infers anything beyond the count
// split, never re-derives/overrides the real `majorityVerdict` (that
// value stays authoritative and comes from the server), and never makes
// a model call. Generic over any vote count, though this product always
// supplies exactly three.
function summarizePanelVotes(votes: JudgeVoteDisplay[]): string {
  const guiltyCount = votes.filter((vote) => vote.verdict === "GUILTY").length;
  const notGuiltyCount = votes.length - guiltyCount;
  const majorityCount = Math.max(guiltyCount, notGuiltyCount);
  const minorityCount = Math.min(guiltyCount, notGuiltyCount);

  return minorityCount === 0 ? `Unanimous · ${majorityCount}–0` : `Majority · ${majorityCount}–${minorityCount}`;
}

// The same restrained, muted judicial tones the theme already assigns
// to error/success (Ivory & Iron, theme.ts: error #A23B2E, success
// #3F6E4E -- neither is MUI's default bright red/green), reused here
// only for the verdict zone's own low-opacity tint. Never a new color
// scale, never used as the sole signal (the verdict's own text is
// always present alongside it).
const VERDICT_TINT: Record<JudgeVoteDisplay["verdict"], string> = {
  GUILTY: "rgba(162,59,46,0.07)",
  NOT_GUILTY: "rgba(63,110,78,0.07)"
};

export function JudgeVoteGroup({
  votes,
  verdictLabel,
  presentation
}: {
  votes: JudgeVoteDisplay[];
  // Milestone 14 (RunPage COMPLETED-state display correction): an
  // OPTIONAL display-only formatter for the verdict text -- omitted
  // (every existing caller, ResultPage's mock fixtures, and this
  // component's own test suite), the literal "GUILTY"/"NOT_GUILTY" is
  // rendered exactly as before, byte-for-byte unchanged. RunPage's real
  // COMPLETED result is the only caller that supplies one, to render
  // "NOT GUILTY" without the underscore for human-facing copy. Never
  // alters `vote.verdict` itself or any color/semantic logic below.
  verdictLabel?: (verdict: JudgeVoteDisplay["verdict"]) => string;
  // Milestone 14 (COMPLETED-result judge-vote premium redesign) --
  // additive/opt-in, same pattern as ExecutionModeControl's `compact`
  // and ParticipantCard's `presentation`: omitted (every existing
  // caller, ResultPage included), this renders the ORIGINAL, unchanged
  // "Three judge votes" card exactly as before -- a wholly separate
  // return branch below, not a conditional style merge, for maximum
  // safety. Only RunPage's real COMPLETED result opts in.
  presentation?: "premium";
}) {
  if (presentation === "premium") {
    return (
      <Box
        component="section"
        data-testid="judge-vote-group"
        sx={{
          background: "linear-gradient(160deg, #FFFFFF 0%, #FBF6E9 100%)",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: "14px",
          borderTop: "3px solid #B8892B",
          overflow: "hidden",
          p: { xs: 2.5, md: 3 },
          position: "relative"
        }}
      >
        <Box
          aria-hidden="true"
          sx={{ color: "#8C6423", opacity: 0.05, pointerEvents: "none", position: "absolute", right: -24, top: -24 }}
        >
          <ScaleIcon size={140} />
        </Box>
        <Stack spacing={0.5} sx={{ position: "relative" }}>
          <Typography
            color="#8C6423"
            sx={{ fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}
            variant="caption"
          >
            The Panel&rsquo;s Decision
          </Typography>
          <Typography component="h2" sx={{ fontFamily: '"Fraunces", Georgia, serif' }} variant="h4">
            Three Judge Votes
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Typography color="text.secondary">
              These three independent rulings determine the final majority verdict.
            </Typography>
            <Typography
              color="text.secondary"
              sx={{
                bgcolor: "rgba(184,137,43,0.1)",
                borderRadius: "999px",
                fontWeight: 700,
                letterSpacing: "0.04em",
                px: 1.25,
                py: 0.25,
                whiteSpace: "nowrap"
              }}
              variant="caption"
            >
              {summarizePanelVotes(votes)}
            </Typography>
          </Stack>
        </Stack>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
            mt: 2.5,
            position: "relative"
          }}
        >
          {votes.map((vote) => (
            <Stack
              key={vote.judge}
              spacing={1}
              sx={{
                bgcolor: "#FFFFFF",
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "12px",
                p: 2
              }}
            >
              {vote.displayName ? (
                <Typography
                  color="text.secondary"
                  sx={{ fontFamily: monoFontStack, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
                  variant="caption"
                >
                  {vote.judge}
                </Typography>
              ) : null}
              <Typography component="h3" sx={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 600 }} variant="h5">
                {vote.displayName ?? vote.judge}
              </Typography>
              <Divider sx={{ borderColor: "divider" }} />
              <Box sx={{ bgcolor: VERDICT_TINT[vote.verdict], borderRadius: "8px", py: 1.5, textAlign: "center" }}>
                <Typography
                  color={verdictColor(vote.verdict)}
                  component="p"
                  sx={{ fontFamily: '"Fraunces", Georgia, serif', fontWeight: 700 }}
                  variant="h5"
                >
                  {verdictLabel ? verdictLabel(vote.verdict) : vote.verdict}
                </Typography>
                <Typography
                  color="text.secondary"
                  sx={{ fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
                  variant="caption"
                >
                  Individual vote
                </Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      </Box>
    );
  }

  return (
    <Card component="section" data-testid="judge-vote-group">
      <CardContent>
        <Typography component="h2" variant="h5">
          Three judge votes
        </Typography>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" },
            mt: 2
          }}
        >
          {votes.map((vote) => (
            <Stack
              key={vote.judge}
              spacing={0.5}
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                p: 2
              }}
            >
              <Typography sx={{ fontWeight: 800 }}>{vote.displayName ?? vote.judge}</Typography>
              {vote.displayName ? (
                <Typography color="text.secondary" variant="body2">
                  {vote.judge}
                </Typography>
              ) : null}
              <Typography color={verdictColor(vote.verdict)} sx={{ fontWeight: 900 }}>
                {verdictLabel ? verdictLabel(vote.verdict) : vote.verdict}
              </Typography>
            </Stack>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
