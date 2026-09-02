import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { ExecutionModeControl } from "../components/ExecutionModeControl";
import { PageHeader } from "../components/PageHeader";
import { ParticipantCard } from "../components/ParticipantCard";
import { SetupStepper } from "../components/SetupStepper";
import {
  areAdvocatePersonalitiesValid,
  SETUP_STEP_INDEX
} from "../features/case-setup/setupState";
import { useRoleEligibleModels } from "../features/case-setup/useRoleEligibleModels";
import { useSetup } from "../features/case-setup/useSetup";
import { advocateParticipants } from "../mocks/tribunalMockData";

export function AdvocatesPage() {
  const { state, dispatch } = useSetup();
  const canContinue = areAdvocatePersonalitiesValid(state);
  // M9 (Separate-Model Tribunal, Issue #20): one shared ADVOCATE role
  // catalog fetch, reused by all four advocate cards below -- never one
  // fetch per card.
  const {
    models: advocateModels,
    loading: advocateModelsLoading,
    error: advocateModelsError
  } = useRoleEligibleModels("ADVOCATE");

  return (
    <Stack spacing={4}>
      <SetupStepper />
      <PageHeader
        eyebrow="Participants"
        title="Advocates"
        description="Exactly four advocates are configured for review: two PRO (Defense, arguing NOT_GUILTY) and two CON (Opposition, arguing GUILTY). Sides and counts are fixed."
      />
      <Paper sx={{ p: { xs: 2, md: 3 } }}>
        <ExecutionModeControl />
      </Paper>
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }
        }}
      >
        {advocateParticipants.map((participant) => (
          <ParticipantCard
            key={participant.id}
            participant={participant}
            roleModels={advocateModels}
            roleModelsError={advocateModelsError}
            roleModelsLoading={advocateModelsLoading}
          />
        ))}
      </Box>
      <Stack direction="row" spacing={2}>
        <Button component={RouterLink} to="/new/charge-sheet" variant="outlined">
          Back
        </Button>
        {canContinue ? (
          <Button
            component={RouterLink}
            onClick={() =>
              dispatch({
                type: "advanceFurthestStep",
                index: SETUP_STEP_INDEX.JUDGES
              })
            }
            to="/new/judges"
            variant="contained"
          >
            Continue to Judges
          </Button>
        ) : (
          <Button disabled variant="contained">
            Continue to Judges
          </Button>
        )}
      </Stack>
      {!canContinue ? (
        <Typography color="text.secondary" variant="body2">
          Complete all four advocate personalities before continuing.
        </Typography>
      ) : null}
    </Stack>
  );
}
