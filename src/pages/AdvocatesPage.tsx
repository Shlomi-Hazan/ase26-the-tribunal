// Milestone 14 (Advocates high-fidelity redesign, Ivory & Iron):
// restyle only. Every participant field, dispatch, validation rule,
// import handler, model-selection behavior, and the Back/Continue
// navigation below is unchanged in logic -- only the surrounding
// composition/styling changed, to make the two opposing sides of the
// Tribunal immediately legible. ParticipantCard's shared code is
// reused unmodified in behavior; only its opt-in `presentation`
// prop is set here (JudgesPage never sets it, so Judges is
// byte-for-byte unaffected -- see ParticipantCard.tsx).
import { Box, Button, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import {
  CURRENT_ADVOCATE_SIDE_HEADING,
  type AdvocateSide
} from "../components/advocateSideCopy";
import { ChevronRightIcon } from "../components/icons/LineIcons";
import { ExecutionModeControl } from "../components/ExecutionModeControl";
import { ParticipantCard } from "../components/ParticipantCard";
import { SetupStepper } from "../components/SetupStepper";
import {
  areAdvocatePersonalitiesValid,
  SETUP_STEP_INDEX
} from "../features/case-setup/setupState";
import { useRoleEligibleModels } from "../features/case-setup/useRoleEligibleModels";
import { useSetup } from "../features/case-setup/useSetup";
import { advocateParticipants, type Participant } from "../mocks/tribunalMockData";

// Presentation-only grouping of the fixed, ordered advocateParticipants
// array (PRO I, PRO II, CON I, CON II) by side -- no new data, no
// reordering of the underlying participants, no change to which four
// slots exist.
function participantsForSide(side: AdvocateSide): Participant[] {
  return advocateParticipants.filter((participant) => participant.side === side);
}

// Divider fix, corrected (Advocates follow-up pass): an earlier attempt
// scoped the divider to only the heading row to stop it overlapping
// taller Separate-Models cards -- that under-shot the approved design,
// which wants the divider to visibly span the whole PRO/CON section,
// through the card area, not just the headings. This version uses a
// structurally safe layout instead of any absolute-positioned line over
// content: the divider gets its OWN grid column
// (`minmax(0, 1fr) 2px minmax(0, 1fr)`), sitting entirely in the gutter
// between the PRO and CON columns. A grid row's items stretch to the
// row's own height by default, so the divider naturally spans however
// tall the PRO/CON content is -- in Shared OR Separate Models mode --
// without ever sitting on top of, or depending on measuring, a card.
function SideGroup({
  side,
  description,
  roleModels,
  roleModelsLoading,
  roleModelsError
}: {
  side: AdvocateSide;
  description: string;
  roleModels: ReturnType<typeof useRoleEligibleModels>["models"];
  roleModelsLoading: boolean;
  roleModelsError: string;
}) {
  return (
    <Stack spacing={2}>
      <Stack spacing={0.25}>
        <Typography
          sx={{
            color: side === "PRO" ? "#8C6423" : "text.secondary",
            fontWeight: 800,
            letterSpacing: "0.06em",
            textTransform: "uppercase"
          }}
          variant="subtitle2"
        >
          {CURRENT_ADVOCATE_SIDE_HEADING[side]}
        </Typography>
        <Typography color="text.secondary" variant="body2">
          {description}
        </Typography>
      </Stack>
      <Stack spacing={2}>
        {participantsForSide(side).map((participant) => (
          <ParticipantCard
            key={participant.id}
            participant={participant}
            presentation="advocateDossier"
            roleModels={roleModels}
            roleModelsError={roleModelsError}
            roleModelsLoading={roleModelsLoading}
          />
        ))}
      </Stack>
    </Stack>
  );
}

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
            Advocates
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: "60ch" }}>
            Four advocate personas argue the case before the judges: two PRO (Defense, arguing
            Not Guilty) and two CON (Opposition, arguing Guilty). Sides and counts are fixed.
          </Typography>
        </Stack>

        {/* Refinement pass: compacted and pulled up tight against the
            intro, so it reads as a secondary setting rather than a
            second hero block competing with the advocate cards below.
            `compact` is opt-in on ExecutionModeControl -- Judges keeps
            the original, uncompacted panel. */}
        <Paper sx={{ borderRadius: "10px", p: { xs: 1.5, md: 2 } }}>
          <ExecutionModeControl compact />
        </Paper>
      </Stack>

      {/* One grid, three columns: PRO | divider gutter | CON. The
          divider is its own grid item in its own narrow column --
          never absolutely positioned over content -- so it can only
          ever occupy the gutter between the two sides, and (grid items
          stretch to their row's height by default) it naturally spans
          however tall the PRO/CON content is, in either execution
          mode, without measuring or depending on card height. Hidden
          entirely on mobile, where the two sides stack instead of
          sitting side by side. */}
      <Box
        sx={{
          display: "grid",
          gap: { xs: 4, md: 5 },
          gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) 2px minmax(0, 1fr)" }
        }}
      >
        <SideGroup
          description="Two advocates arguing in support of the defendant."
          roleModels={advocateModels}
          roleModelsError={advocateModelsError}
          roleModelsLoading={advocateModelsLoading}
          side="PRO"
        />
        {/* Decorative divider between the two sides -- desktop only,
            purely presentational. A warm gold/umber gradient, soft at
            both ends, clearly visible without being harsh. Reinforces
            the opposition without any color-only signal (the PRO/CON
            text labels beside it already carry the real meaning). */}
        <Box
          aria-hidden="true"
          sx={{
            background:
              "linear-gradient(180deg, transparent 0%, rgba(140,100,53,0.55) 6%, rgba(140,100,53,0.55) 94%, transparent 100%)",
            display: { xs: "none", md: "block" }
          }}
        />
        <SideGroup
          description="Two advocates challenging the defendant."
          roleModels={advocateModels}
          roleModelsError={advocateModelsError}
          roleModelsLoading={advocateModelsLoading}
          side="CON"
        />
      </Box>

      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 3 }}>
        <Stack direction="row" spacing={2}>
          <Button component={RouterLink} sx={{ borderRadius: "8px" }} to="/new/charge-sheet" variant="outlined">
            Back
          </Button>
          {canContinue ? (
            <Button
              component={RouterLink}
              endIcon={<ChevronRightIcon size={18} />}
              onClick={() =>
                dispatch({
                  type: "advanceFurthestStep",
                  index: SETUP_STEP_INDEX.JUDGES
                })
              }
              sx={{ borderRadius: "10px" }}
              to="/new/judges"
              variant="contained"
            >
              Continue to Judges
            </Button>
          ) : (
            <Button disabled sx={{ borderRadius: "10px" }} variant="contained">
              Continue to Judges
            </Button>
          )}
        </Stack>
        {!canContinue ? (
          <Typography color="text.secondary" sx={{ mt: 1.5 }} variant="body2">
            Complete all four advocate personalities before continuing.
          </Typography>
        ) : null}
      </Box>
    </Stack>
  );
}
