import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  Card,
  CardContent,
  Stack,
  Typography
} from "@mui/material";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { EconomicsSummary } from "../components/EconomicsSummary";
import { JudgeVoteGroup } from "../components/JudgeVoteGroup";
import { mockResultFixtures } from "../mocks/tribunalMockData";

export function ResultPage() {
  const [searchParams] = useSearchParams();
  const historical = searchParams.get("source") === "history";
  const historicalCaseId = searchParams.get("case");
  const resultFixture = historical
    ? historicalCaseId
      ? mockResultFixtures[historicalCaseId]
      : undefined
    : mockResultFixtures.current;

  if (!resultFixture) {
    return (
      <Stack spacing={4}>
        {historical ? (
          <Alert severity="info">
            Historical run — model calls are not being repeated.
          </Alert>
        ) : null}
        <Alert severity="warning">
          This mock historical result could not be found.
        </Alert>
        <Button component={RouterLink} to="/history" variant="contained">
          Return to Past Cases
        </Button>
      </Stack>
    );
  }

  return (
    <Stack spacing={4}>
      {historical ? (
        <Alert severity="info">
          Historical run — model calls are not being repeated.
        </Alert>
      ) : null}
      <Card component="section">
        <CardContent>
          <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
            TRIBUNAL VERDICT
          </Typography>
          <Typography component="h1" sx={{ mt: 1 }} variant="h2">
            {resultFixture.majorityVerdict}
          </Typography>
          <Typography color="text.secondary">
            Deterministic majority of the three judge votes, not a fourth AI
            opinion.
          </Typography>
        </CardContent>
      </Card>
      <JudgeVoteGroup votes={resultFixture.judgeVotes} />
      <Stack spacing={1}>
        <Typography component="h2" variant="h4">
          Judge reasoning
        </Typography>
        <Typography color="text.secondary">
          Mock reasoning follows the majority and grouped judge votes.
        </Typography>
      </Stack>
      {resultFixture.judgeVotes.map((vote) => (
        <Accordion key={vote.judge}>
          <AccordionSummary>
            <Typography sx={{ fontWeight: 800 }}>
              {vote.judge} — {vote.verdict}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              <Typography>Personality: {vote.personality}</Typography>
              <Typography>Model: {vote.model}</Typography>
              <Typography>{vote.reasoning}</Typography>
            </Stack>
          </AccordionDetails>
        </Accordion>
      ))}
      <Stack spacing={1}>
        <Typography component="h2" variant="h4">
          Advocate speeches
        </Typography>
        <Typography color="text.secondary">
          Four mock speeches are grouped after judge reasoning.
        </Typography>
      </Stack>
      {resultFixture.advocateSpeeches.map((speech) => (
        <Accordion key={speech.participant}>
          <AccordionSummary>
            <Typography sx={{ fontWeight: 800 }}>
              {speech.participant} — {speech.side}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={1}>
              <Typography>Model: {speech.model}</Typography>
              <Typography>Personality: {speech.personality}</Typography>
              <Typography>{speech.speech}</Typography>
            </Stack>
          </AccordionDetails>
        </Accordion>
      ))}
      <EconomicsSummary detailed />
    </Stack>
  );
}
