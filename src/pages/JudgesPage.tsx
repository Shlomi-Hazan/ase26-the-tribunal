import { Box, Button, Paper, Stack } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { ExecutionModeControl } from "../components/ExecutionModeControl";
import { PageHeader } from "../components/PageHeader";
import { ParticipantCard } from "../components/ParticipantCard";
import { SetupStepper } from "../components/SetupStepper";
import { judgeParticipants } from "../mocks/tribunalMockData";

export function JudgesPage() {
  return (
    <Stack spacing={4}>
      <SetupStepper />
      <PageHeader
        eyebrow="Participants"
        title="Judges"
        description="Three independent judges will later evaluate all four advocate speeches. This milestone shows only mock configuration."
      />
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <ExecutionModeControl />
      </Paper>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", lg: "repeat(3, 1fr)" }
        }}
      >
        {judgeParticipants.map((participant) => (
          <ParticipantCard key={participant.id} participant={participant} />
        ))}
      </Box>
      <Stack direction="row" spacing={2}>
        <Button component={RouterLink} to="/new/advocates" variant="outlined">
          Back
        </Button>
        <Button component={RouterLink} to="/new/review" variant="contained">
          Review Tribunal
        </Button>
      </Stack>
    </Stack>
  );
}
