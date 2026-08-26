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
    <Box aria-label="Case setup progress" component="nav">
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {steps.map((step, index) => {
          const active = index === activeIndex;
          // A step shows Complete only when it has genuinely been reached
          // (SETUP_STEP_INDEX/furthestReachedStepIndex -- never route
          // position alone), its data is still currently valid, and it
          // isn't the step the user is presently on. Validity and
          // completion are deliberately not conflated: default advocate/
          // judge data is valid from the start, but that alone must never
          // read as "reached."
          const complete =
            !active &&
            index <= state.furthestReachedStepIndex &&
            validByIndex[index];

          return (
            <Button
              aria-current={active ? "step" : undefined}
              color={active ? "primary" : "inherit"}
              component={RouterLink}
              key={step.path}
              to={step.path}
              variant={active ? "contained" : "outlined"}
            >
              <Typography component="span" sx={{ fontWeight: 800, mr: 1 }}>
                {index + 1}
              </Typography>
              {step.label}
              {complete ? (
                <Typography component="span" sx={{ ml: 1 }} variant="caption">
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
