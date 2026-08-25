import { Box, Card, CardContent, Stack, Typography } from "@mui/material";
import { mockJudgeVotes } from "../mocks/tribunalMockData";

export function JudgeVoteGroup() {
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
          {mockJudgeVotes.map((vote) => (
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
              <Typography sx={{ fontWeight: 800 }}>{vote.judge}</Typography>
              <Typography color="primary" sx={{ fontWeight: 900 }}>
                {vote.verdict}
              </Typography>
            </Stack>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}
