import { Box, Button, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useLocation } from "react-router-dom";

const steps = [
  { label: "Charge Sheet", path: "/new/charge-sheet" },
  { label: "Advocates", path: "/new/advocates" },
  { label: "Judges", path: "/new/judges" },
  { label: "Review", path: "/new/review" }
];

export function SetupStepper() {
  const location = useLocation();
  const activeIndex = Math.max(
    steps.findIndex((step) => step.path === location.pathname),
    0
  );

  return (
    <Box aria-label="Case setup progress" component="nav">
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {steps.map((step, index) => {
          const active = index === activeIndex;
          const complete = index < activeIndex;

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
