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
      {/* Milestone 14 visual-correction pass (PR #40): a purely
          decorative connecting line behind the steps, echoing Home's
          "How it works" numbered-step motif. Presentational only -- it
          carries no text and is not part of any step's accessible
          name. */}
      <Box
        aria-hidden="true"
        sx={{
          bgcolor: "divider",
          display: { xs: "none", sm: "block" },
          height: "1px",
          left: 24,
          position: "absolute",
          right: 24,
          top: 24,
          zIndex: 0
        }}
      />
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ position: "relative", zIndex: 1 }}>
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
              color={active ? "primary" : "inherit"}
              component={RouterLink}
              key={step.path}
              sx={{
                bgcolor: active ? undefined : "background.paper",
                borderColor: complete ? "#8C6423" : undefined
              }}
              to={step.path}
              variant={active ? "contained" : "outlined"}
            >
              <Typography
                component="span"
                sx={{
                  alignItems: "center",
                  bgcolor: active ? "rgba(255,255,255,0.25)" : complete ? "rgba(140,100,35,0.12)" : "action.hover",
                  borderRadius: "50%",
                  color: complete && !active ? "#8C6423" : undefined,
                  display: "inline-flex",
                  fontWeight: 800,
                  height: 22,
                  justifyContent: "center",
                  mr: 1,
                  width: 22
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
