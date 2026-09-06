// Milestone 14 (Judges high-fidelity redesign, Ivory & Iron): restyle
// only. Every judge field, dispatch, validation rule, import handler,
// model-selection behavior, and the Back/Review Tribunal navigation
// below is unchanged in logic -- only the surrounding composition/
// styling changed, to present the three judges as one coordinated
// bench rather than three unrelated forms. ParticipantCard's shared
// code is reused unmodified in behavior; only its opt-in
// `presentation="judgeDossier"` is set here (mirroring how
// AdvocatesPage sets "advocateDossier" -- see ParticipantCard.tsx).
// Execution Mode reuses the same approved `compact` layout already
// shipped on Advocates -- no new version was invented.
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { ChevronRightIcon } from "../components/icons/LineIcons";
import { ExecutionModeControl } from "../components/ExecutionModeControl";
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

      <Stack spacing={2}>
        <Stack spacing={1}>
          <Typography
            color="#8C6423"
            sx={{ fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}
            variant="caption"
          >
            New Case
          </Typography>
          <Typography component="h1" variant="h3">
            Judges
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: "60ch" }}>
            Configure three independent judges who will later review the completed advocate
            arguments and return individual verdicts. The Tribunal verdict is determined by
            majority.
          </Typography>
        </Stack>

        {/* Same approved compact layout shipped on Advocates -- no
            second version of ExecutionModeControl was created. */}
        <Paper sx={{ borderRadius: "10px", p: { xs: 1.5, md: 2 } }}>
          <ExecutionModeControl compact />
        </Paper>
      </Stack>

      <Stack spacing={2}>
        <Stack spacing={0.25}>
          <Typography
            sx={{ color: "#8C6423", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}
            variant="subtitle2"
          >
            The Bench
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Three independent judicial seats. Each judge evaluates the completed arguments and
            returns an individual verdict.
          </Typography>
        </Stack>
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
              presentation="judgeDossier"
              roleModels={judgeModels}
              roleModelsError={judgeModelsError}
              roleModelsLoading={judgeModelsLoading}
            />
          ))}
        </Box>
      </Stack>

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 3 }}>
        <Stack direction="row" spacing={2}>
          <Button component={RouterLink} sx={{ borderRadius: "8px" }} to="/new/advocates" variant="outlined">
            Back
          </Button>
          {canContinue ? (
            <Button
              component={RouterLink}
              endIcon={<ChevronRightIcon size={18} />}
              onClick={() =>
                dispatch({
                  type: "advanceFurthestStep",
                  index: SETUP_STEP_INDEX.REVIEW
                })
              }
              sx={{ borderRadius: "10px" }}
              to="/new/review"
              variant="contained"
            >
              Review Tribunal
            </Button>
          ) : (
            <Button disabled sx={{ borderRadius: "10px" }} variant="contained">
              Review Tribunal
            </Button>
          )}
        </Stack>
        {!canContinue ? (
          <Typography color="text.secondary" sx={{ mt: 1.5 }} variant="body2">
            Complete all three judge personalities before review.
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}
