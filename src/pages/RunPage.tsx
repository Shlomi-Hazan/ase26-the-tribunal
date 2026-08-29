// Milestone 8 -- the real run page (ARCHITECTURE.md Sec 12's
// `/runs/:runId` route). Replaces the mock `?scenario=` query-param
// state the M4-era DeliberationPage/ResultPage still use (left
// unmodified -- they remain a valid UI-shell demonstration independent
// of real execution) with GET /api/runs/:id polling against a real run.

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography
} from "@mui/material";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { JudgeVoteGroup } from "../components/JudgeVoteGroup";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import {
  advocateParticipants,
  judgeParticipants,
  type ParticipantStatus
} from "../mocks/tribunalMockData";
import {
  getRun,
  type ParticipantAttemptStatus,
  type StoredRun
} from "../services/runApi";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "BLOCKED_BUDGET"]);

const STATUS_MAP: Record<ParticipantAttemptStatus, ParticipantStatus> = {
  PENDING: "Waiting",
  RUNNING: "Running",
  RETRYING: "Retrying",
  SUCCESS: "Complete",
  FAILED: "Failed"
};

export function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<StoredRun | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!runId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const fetched = await getRun(runId!);

        if (cancelled) {
          return;
        }

        if (!fetched) {
          setError("This run could not be found.");

          return;
        }

        setRun(fetched);

        if (!TERMINAL_STATUSES.has(fetched.status)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) {
          setError("This run's status could not be loaded.");
        }
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [runId]);

  if (error) {
    return (
      <Stack spacing={4}>
        <Alert severity="error">{error}</Alert>
      </Stack>
    );
  }

  if (!run) {
    return (
      <Stack spacing={2} sx={{ alignItems: "center", py: 8 }}>
        <CircularProgress />
        <Typography color="text.secondary">Loading run...</Typography>
      </Stack>
    );
  }

  if (run.status === "BLOCKED_BUDGET") {
    return (
      <Stack spacing={4}>
        <PageHeader
          description="Budget blocking happens before model execution and is not a participant failure."
          eyebrow="Budget Gate"
          title="This run cannot be executed"
        />
        <Card>
          <CardContent>
            <Typography>{run.failureMessage ?? "Conservative preflight exceeded the $5.00 policy limit."}</Typography>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  if (run.status === "FAILED") {
    return (
      <Stack spacing={4}>
        <PageHeader
          description={run.failureMessage ?? "The run could not complete."}
          eyebrow="Run Failed"
          title="The Tribunal could not complete"
        />
        <Alert severity="error">
          Failure is never a verdict. {run.failureCode ? `Code: ${run.failureCode}` : ""}
        </Alert>
        <ParticipantGrid run={run} />
      </Stack>
    );
  }

  if (run.status === "COMPLETED") {
    return <CompletedResult run={run} />;
  }

  return (
    <Stack spacing={4}>
      <PageHeader
        description={`Status: ${run.status}`}
        eyebrow="The Tribunal is in session"
        title="Deliberation in progress"
      />
      <ParticipantGrid run={run} />
    </Stack>
  );
}

function ParticipantGrid({ run }: { run: StoredRun }) {
  const statusById = new Map(run.participants.map((participant) => [participant.participantId, participant.attemptStatus]));
  const judgesActive = run.status === "JUDGES_RUNNING" || run.status === "COMPLETED" || run.status === "FAILED";

  return (
    <Stack spacing={3}>
      <Card component="section">
        <CardContent>
          <Typography component="h2" variant="h5">
            Advocates
          </Typography>
          <ParticipantRow
            participants={advocateParticipants}
            statuses={advocateParticipants.map((p) => STATUS_MAP[statusById.get(p.id) ?? "PENDING"])}
          />
        </CardContent>
      </Card>
      {judgesActive ? (
        <Card component="section">
          <CardContent>
            <Typography component="h2" variant="h5">
              Judges
            </Typography>
            <ParticipantRow
              participants={judgeParticipants}
              statuses={judgeParticipants.map((p) => STATUS_MAP[statusById.get(p.id) ?? "PENDING"])}
            />
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info">Judges begin only after all four advocate speeches validate.</Alert>
      )}
    </Stack>
  );
}

function ParticipantRow({
  participants,
  statuses
}: {
  participants: Array<{ id: string; label: string; side?: string }>;
  statuses: ParticipantStatus[];
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" },
        mt: 2
      }}
    >
      {participants.map((participant, index) => (
        <Stack
          key={participant.id}
          spacing={1}
          sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}
        >
          <Typography sx={{ fontWeight: 800 }}>{participant.label}</Typography>
          {participant.side ? (
            <Typography color="text.secondary" variant="body2">
              Side: {participant.side}
            </Typography>
          ) : null}
          <StatusBadge status={statuses[index]} />
        </Stack>
      ))}
    </Box>
  );
}

// Independent audit correction (Issue #17 blocker 6): a run marked
// COMPLETED must actually carry a complete, valid result before any of
// it is rendered -- a non-null majority verdict, exactly four non-empty
// advocate speeches, and exactly three valid judge verdicts with
// non-empty reasoning. This never trusts `run.status === "COMPLETED"`
// alone; it independently re-verifies the data that status claims to
// describe, exactly the way a failed integrity check must never fall
// back to a fabricated default (never `?? "NOT_GUILTY"`, never `?? ""`).
type ResultIntegrityCheck =
  | { valid: true }
  | { valid: false; reason: string };

function checkResultIntegrity(run: StoredRun): ResultIntegrityCheck {
  if (run.majorityVerdict !== "GUILTY" && run.majorityVerdict !== "NOT_GUILTY") {
    return { valid: false, reason: "The stored majority verdict is missing or invalid." };
  }

  const speeches = advocateParticipants.map((advocate) =>
    run.participants.find((entry) => entry.participantId === advocate.id)
  );

  if (speeches.some((participant) => !participant?.speech || participant.speech.trim().length === 0)) {
    return { valid: false, reason: "One or more advocate speeches are missing." };
  }

  const verdicts = judgeParticipants.map((judge) =>
    run.participants.find((entry) => entry.participantId === judge.id)
  );

  if (
    verdicts.some(
      (participant) =>
        (participant?.verdict !== "GUILTY" && participant?.verdict !== "NOT_GUILTY") ||
        !participant?.reasoning ||
        participant.reasoning.trim().length === 0
    )
  ) {
    return { valid: false, reason: "One or more judge verdicts or reasonings are missing." };
  }

  return { valid: true };
}

function CompletedResult({ run }: { run: StoredRun }) {
  const integrity = checkResultIntegrity(run);

  if (!integrity.valid) {
    return (
      <Stack spacing={4}>
        <PageHeader
          description="This completed run's stored result is incomplete or corrupted -- it is not displayed as a verdict."
          eyebrow="Result Data Integrity Error"
          title="This result cannot be safely displayed"
        />
        <Alert severity="error">{integrity.reason}</Alert>
      </Stack>
    );
  }

  const votes = judgeParticipants.map((judge) => {
    // Safe: checkResultIntegrity already proved every judge has a valid
    // verdict/non-empty reasoning above.
    const participant = run.participants.find((entry) => entry.participantId === judge.id)!;

    return {
      judge: judge.label,
      verdict: participant.verdict as "GUILTY" | "NOT_GUILTY",
      model: participant.modelId,
      personality: participant.personality,
      reasoning: participant.reasoning as string
    };
  });
  const speeches = advocateParticipants.map((advocate) => {
    // Safe: checkResultIntegrity already proved every advocate has a
    // non-empty speech above.
    const participant = run.participants.find((entry) => entry.participantId === advocate.id)!;

    return {
      participant: advocate.label,
      side: advocate.side ?? "PRO",
      model: participant.modelId,
      personality: participant.personality,
      speech: participant.speech as string
    };
  });

  return (
    <Stack spacing={4}>
      <Card component="section">
        <CardContent>
          <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
            TRIBUNAL VERDICT
          </Typography>
          <Typography component="h1" sx={{ mt: 1 }} variant="h2">
            {run.majorityVerdict}
          </Typography>
          <Typography color="text.secondary">
            Deterministic majority of the three judge votes -- real execution, user-funded.
          </Typography>
          {run.totalCostUsd ? (
            <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
              Total model cost: ${run.totalCostUsd}
            </Typography>
          ) : null}
        </CardContent>
      </Card>
      <JudgeVoteGroup votes={votes} />
      {votes.map((vote) => (
        <Accordion key={vote.judge}>
          <AccordionSummary>
            <Typography sx={{ fontWeight: 800 }}>
              {vote.judge} -- {vote.verdict}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography>{vote.reasoning}</Typography>
          </AccordionDetails>
        </Accordion>
      ))}
      {speeches.map((speech) => (
        <Accordion key={speech.participant}>
          <AccordionSummary>
            <Typography sx={{ fontWeight: 800 }}>
              {speech.participant} -- {speech.side}
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Typography>{speech.speech}</Typography>
          </AccordionDetails>
        </Accordion>
      ))}
    </Stack>
  );
}
