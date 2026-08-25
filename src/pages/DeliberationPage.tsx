import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  Typography
} from "@mui/material";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { StatusBadge } from "../components/StatusBadge";
import {
  advocateParticipants,
  judgeParticipants,
  type ParticipantStatus
} from "../mocks/tribunalMockData";

type Scenario =
  | "running"
  | "retry"
  | "judge"
  | "advocate-failure"
  | "judge-failure"
  | "budget-blocked"
  | "completed";

const scenarioLabels: Record<Scenario, string> = {
  running: "Advocates running",
  retry: "Advocate retrying",
  judge: "Judge phase",
  "advocate-failure": "Advocate failure",
  "judge-failure": "Judge failure",
  "budget-blocked": "Budget blocked",
  completed: "Completed transition"
};

const advocateStatusByScenario: Record<Scenario, ParticipantStatus[]> = {
  running: ["Running", "Complete", "Retrying", "Waiting"],
  retry: ["Complete", "Running", "Retrying", "Waiting"],
  judge: ["Complete", "Complete", "Complete", "Complete"],
  "advocate-failure": ["Complete", "Complete", "Failed", "Complete"],
  "judge-failure": ["Complete", "Complete", "Complete", "Complete"],
  "budget-blocked": ["Waiting", "Waiting", "Waiting", "Waiting"],
  completed: ["Complete", "Complete", "Complete", "Complete"]
};

const judgeStatusByScenario: Record<Scenario, ParticipantStatus[]> = {
  running: ["Waiting", "Waiting", "Waiting"],
  retry: ["Waiting", "Waiting", "Waiting"],
  judge: ["Running", "Complete", "Running"],
  "advocate-failure": ["Waiting", "Waiting", "Waiting"],
  "judge-failure": ["Complete", "Failed", "Complete"],
  "budget-blocked": ["Waiting", "Waiting", "Waiting"],
  completed: ["Complete", "Complete", "Complete"]
};

export function DeliberationPage() {
  const [searchParams] = useSearchParams();
  const scenario = parseScenario(searchParams.get("scenario"));

  if (scenario === "budget-blocked") {
    return <BudgetBlockedState />;
  }

  if (scenario === "advocate-failure") {
    return (
      <FailureState
        detail="CON I did not return a valid argument after the permitted retry. The judges were not started."
        partialSpend="$0.03 mock partial spend"
      />
    );
  }

  if (scenario === "judge-failure") {
    return (
      <FailureState
        detail="Judge II failed after the permitted retry. No majority verdict was calculated."
        partialSpend="$0.11 mock partial spend"
      />
    );
  }

  return (
    <Stack spacing={4}>
      <PageHeader
        eyebrow="Mock Deliberation"
        title="The Tribunal is in session"
        description={`${scenarioLabels[scenario]} — deterministic mock state for UI review.`}
      />
      <ParticipantStatusGrid
        participants={advocateParticipants}
        statuses={advocateStatusByScenario[scenario]}
        title="Preparing arguments"
      />
      {["judge", "completed"].includes(scenario) ? (
        <Alert severity="info">
          All arguments received. The judges are now deliberating.
        </Alert>
      ) : null}
      <ParticipantStatusGrid
        participants={judgeParticipants}
        statuses={judgeStatusByScenario[scenario]}
        title="Judges"
      />
      {scenario === "completed" ? (
        <Button component={RouterLink} to="/demo/result" variant="contained">
          View Mock Result
        </Button>
      ) : null}
    </Stack>
  );
}

function parseScenario(value: string | null): Scenario {
  const scenarios: Scenario[] = [
    "running",
    "retry",
    "judge",
    "advocate-failure",
    "judge-failure",
    "budget-blocked",
    "completed"
  ];

  return scenarios.includes(value as Scenario) ? (value as Scenario) : "running";
}

function ParticipantStatusGrid({
  participants,
  statuses,
  title
}: {
  participants: Array<{ id: string; label: string; side?: string }>;
  statuses: ParticipantStatus[];
  title: string;
}) {
  return (
    <Card component="section">
      <CardContent>
        <Typography component="h2" variant="h5">
          {title}
        </Typography>
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
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                p: 2
              }}
            >
              <Typography sx={{ fontWeight: 800 }}>
                {participant.label}
              </Typography>
              {participant.side ? (
                <Typography color="text.secondary" variant="body2">
                  Side: {participant.side}
                </Typography>
              ) : null}
              <StatusBadge status={statuses[index]} />
            </Stack>
          ))}
        </Box>
      </CardContent>
    </Card>
  );
}

function FailureState({
  detail,
  partialSpend
}: {
  detail: string;
  partialSpend: string;
}) {
  return (
    <Stack spacing={4}>
      <PageHeader
        eyebrow="Mock Failure"
        title="Tribunal could not complete"
        description={detail}
      />
      <Alert severity="error">{partialSpend}</Alert>
      <Stack direction="row" spacing={2}>
        <Button component={RouterLink} to="/new/charge-sheet" variant="contained">
          Start a New Case
        </Button>
        <Button component={RouterLink} to="/new/review" variant="outlined">
          Review Run Details
        </Button>
      </Stack>
    </Stack>
  );
}

function BudgetBlockedState() {
  return (
    <Stack spacing={4}>
      <PageHeader
        eyebrow="Mock Budget Gate"
        title="This configuration cannot be convened"
        description="Budget blocking happens before model execution and is not a participant failure."
      />
      <Card>
        <CardContent>
          <Typography>Mock conservative maximum: $6.24</Typography>
          <Typography>Policy limit: $5.00</Typography>
          <Typography color="text.secondary" sx={{ mt: 1 }}>
            Choose cheaper mock models before continuing.
          </Typography>
        </CardContent>
      </Card>
      <Button component={RouterLink} to="/new/review" variant="contained">
        Return to Review
      </Button>
    </Stack>
  );
}
