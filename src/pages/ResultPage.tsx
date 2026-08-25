import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Card,
  CardContent,
  Stack,
  Typography
} from "@mui/material";
import { useSearchParams } from "react-router-dom";
import { EconomicsSummary } from "../components/EconomicsSummary";
import { JudgeVoteGroup } from "../components/JudgeVoteGroup";
import { PageHeader } from "../components/PageHeader";
import { mockAdvocateSpeeches, mockJudgeVotes } from "../mocks/tribunalMockData";

export function ResultPage() {
  const [searchParams] = useSearchParams();
  const historical = searchParams.get("source") === "history";

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
            GUILTY
          </Typography>
          <Typography color="text.secondary">
            Deterministic majority of the three judge votes, not a fourth AI
            opinion.
          </Typography>
        </CardContent>
      </Card>
      <JudgeVoteGroup />
      <PageHeader
        title="Judge reasoning"
        description="Mock reasoning follows the majority and grouped judge votes."
      />
      {mockJudgeVotes.map((vote) => (
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
      <PageHeader
        title="Advocate speeches"
        description="Four mock speeches are grouped after judge reasoning."
      />
      {mockAdvocateSpeeches.map((speech) => (
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
