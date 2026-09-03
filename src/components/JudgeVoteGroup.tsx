import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import type { MockJudgeVote } from "../mocks/tribunalMockData";
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

export function JudgeVoteGroup({ votes }: { votes: JudgeVoteDisplay[] }) {
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
                {vote.verdict}
              </Typography>
            </Stack>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
