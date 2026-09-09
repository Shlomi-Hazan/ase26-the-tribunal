import { Box, Button, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useLocation } from "react-router-dom";
import {
  areAdvocatePersonalitiesValid,
  areJudgePersonalitiesValid,
  isChargeSheetValid,
  SETUP_STEP_INDEX
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";

const steps = [
  { label: "Charge Sheet", path: "/new/charge-sheet" },
  { label: "Advocates", path: "/new/advocates" },
  { label: "Judges", path: "/new/judges" },
  { label: "Review", path: "/new/review" }
];

export function SetupStepper() {
  const { state } = useSetup();
  const location = useLocation();
  const activeIndex = Math.max(
    steps.findIndex((step) => step.path === location.pathname),
    0
  );
  // Current data validity per step, indexed by SETUP_STEP_INDEX. Review has
  // no standalone "valid" concept of its own (it never shows Complete --
  // there is nothing past it to have "moved on" from).
  const validByIndex: boolean[] = [];
  validByIndex[SETUP_STEP_INDEX.CHARGE_SHEET] = isChargeSheetValid(state.chargeSheet);
  validByIndex[SETUP_STEP_INDEX.ADVOCATES] = areAdvocatePersonalitiesValid(state);
  validByIndex[SETUP_STEP_INDEX.JUDGES] = areJudgePersonalitiesValid(state);
  validByIndex[SETUP_STEP_INDEX.REVIEW] = false;

  return (
    <Box aria-label="Case setup progress" component="nav" sx={{ position: "relative" }}>
      {/* Milestone 14 (Charge Sheet high-fidelity redesign): an
          institutional, less "four rounded buttons" treatment -- plain
          text steps with a small numbered marker, a restrained gold
          underline on the active step, and a thin connecting rule
          behind the whole row (echoing Home's "How it works" motif).
          Every step remains the SAME interactive element (a real
          RouterLink Button) with the SAME accessible name, aria-current,
          and "Complete" text as before -- no step is made interactive
          or non-interactive beyond what it already was. */}
      <Box
        aria-hidden="true"
        sx={{
          bgcolor: "divider",
          display: { xs: "none", sm: "block" },
          height: "1px",
          left: 4,
          position: "absolute",
          right: 4,
          top: 20,
          zIndex: 0
        }}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 0.5, sm: 3 }} sx={{ position: "relative", zIndex: 1 }}>
        {steps.map((step, index) => {
          const active = index === activeIndex;
          // A step shows Complete only once it has genuinely been LEFT --
          // strictly less than furthestReachedStepIndex, not <=. That
          // field records the furthest step REACHED, not the furthest step
          // COMPLETED: Continue to Advocates sets it to ADVOCATES the
          // instant Advocates becomes the active step, before its own data
          // has ever been confirmed. Using <= would let a step it read as
          // Complete the moment it's merely reached (e.g. pressing Back
          // immediately, without ever clicking that step's own Continue),
          // even though the user never left it forward. Combined with the
          // "not active" and "still currently valid" checks: validity and
          // completion are deliberately not conflated -- default advocate/
          // judge data is valid from the start, but that alone must never
          // read as "reached," let alone "completed."
          const complete =
            !active &&
            index < state.furthestReachedStepIndex &&
            validByIndex[index];

          return (
            <Button
              aria-current={active ? "step" : undefined}
              component={RouterLink}
              disableRipple
              key={step.path}
              sx={{
                alignItems: "center",
                // Refinement pass: a soft gold-tinted wash behind the
                // active step, connecting visually to its underline
                // (same element, same bottom border) so the current
                // step reads clearly at a glance -- still a flat tint,
                // never a filled "button" pill.
                bgcolor: active ? "rgba(184,137,43,0.1)" : "transparent",
                borderBottom: "2px solid",
                borderBottomColor: active ? "#B8892B" : "transparent",
                borderRadius: "8px",
                color: active ? "text.primary" : "text.secondary",
                display: "inline-flex",
                fontWeight: active ? 700 : 600,
                justifyContent: "flex-start",
                minWidth: 0,
                px: active ? 1.25 : 1,
                py: 0.75,
                "&:hover": {
                  bgcolor: active ? "rgba(184,137,43,0.16)" : "action.hover",
                  color: "text.primary"
                }
              }}
              to={step.path}
              variant="text"
            >
              <Typography
                component="span"
                sx={{
                  alignItems: "center",
                  border: "1px solid",
                  borderColor: active ? "#8C6423" : complete ? "#B8892B" : "divider",
                  borderRadius: "50%",
                  color: active ? "#8C6423" : complete ? "#8C6423" : "text.secondary",
                  display: "inline-flex",
                  flexShrink: 0,
                  fontWeight: 800,
                  height: 20,
                  justifyContent: "center",
                  mr: 1,
                  width: 20
                }}
                variant="caption"
              >
                {index + 1}
              </Typography>
              {step.label}
              {complete ? (
                <Typography component="span" sx={{ color: "#8C6423", fontWeight: 700, ml: 1 }} variant="caption">
                  Complete
                </Typography>
              ) : null}
            </Button>
          );
        })}
      </Stack>
    </Box>
  );
}
