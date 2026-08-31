import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { ExecutionModeControl } from "../components/ExecutionModeControl";
import { PageHeader } from "../components/PageHeader";
import { ParticipantCard } from "../components/ParticipantCard";
import { SetupStepper } from "../components/SetupStepper";
import {
  areJudgePersonalitiesValid,
  SETUP_STEP_INDEX
} from "../features/case-setup/setupState";
import { useRoleEligibleModels } from "../features/case-setup/useRoleEligibleModels";
import { useSetup } from "../features/case-setup/useSetup";
import { judgeParticipants } from "../mocks/tribunalMockData";

export function JudgesPage() {
  const { state, dispatch } = useSetup();
  const canContinue = areJudgePersonalitiesValid(state);
  // M9 (Separate-Model Tribunal, Issue #20): one shared JUDGE role
  // catalog fetch, reused by all three judge cards below -- never one
  // fetch per card.
  const {
    models: judgeModels,
    loading: judgeModelsLoading,
    error: judgeModelsError
  } = useRoleEligibleModels("JUDGE");

  return (
    <Stack spacing={4}>
      <SetupStepper />
      <PageHeader
        eyebrow="Participants"
        title="Judges"
        description="Three independent judges are configured and frozen here. Model execution, speeches, and verdicts are not yet performed — they arrive in a later milestone."
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
          <ParticipantCard
            key={participant.id}
            participant={participant}
            roleModels={judgeModels}
            roleModelsError={judgeModelsError}
            roleModelsLoading={judgeModelsLoading}
          />
        ))}
      </Box>
      <Stack direction="row" spacing={2}>
        <Button component={RouterLink} to="/new/advocates" variant="outlined">
          Back
        </Button>
        {canContinue ? (
          <Button
            component={RouterLink}
            onClick={() =>
              dispatch({
                type: "advanceFurthestStep",
                index: SETUP_STEP_INDEX.REVIEW
              })
            }
            to="/new/review"
            variant="contained"
          >
            Review Tribunal
          </Button>
        ) : (
          <Button disabled variant="contained">
            Review Tribunal
          </Button>
        )}
      </Stack>
      {!canContinue ? (
        <Typography color="text.secondary" variant="body2">
          Complete all three judge personalities before review.
        </Typography>
      ) : null}
    </Stack>
  );
}
