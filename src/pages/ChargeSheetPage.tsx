import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { SetupStepper } from "../components/SetupStepper";
import {
  chargeSheetLimits,
  validateChargeSheet
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";

type ChargeField = keyof typeof chargeSheetLimits;

const fields: Array<{
  name: ChargeField;
  label: string;
  helper: string;
  multiline?: boolean;
  minRows?: number;
}> = [
  {
    name: "defendant",
    label: "Defendant",
    helper: "Who or what is the case about?"
  },
  {
    name: "act",
    label: "Act",
    helper: "Describe the disputed act or situation.",
    multiline: true,
    minRows: 5
  },
  {
    name: "exactQuestion",
    label: "Exact Question",
    helper: "Write the binary question the judges should answer.",
    multiline: true,
    minRows: 3
  }
];

export function ChargeSheetPage() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const [attempted, setAttempted] = useState(false);
  const fieldRefs = {
    defendant: useRef<HTMLInputElement>(null),
    act: useRef<HTMLInputElement>(null),
    exactQuestion: useRef<HTMLInputElement>(null)
  };
  const errors = validateChargeSheet(state.chargeSheet);
  const hasErrors = Object.values(errors).some(Boolean);

  function handleContinue() {
    setAttempted(true);

    if (hasErrors) {
      const firstInvalid = fields.find((field) => errors[field.name]);
      fieldRefs[firstInvalid?.name ?? "defendant"].current?.focus();
      return;
    }

    navigate("/new/advocates");
  }

  return (
    <Stack spacing={4}>
      <SetupStepper />
      <PageHeader
        eyebrow="New Case"
        title="Charge Sheet"
        description="Define the case in three deterministic fields before any mock deliberation can be reviewed."
      />
      <Paper component="form" noValidate sx={{ p: { xs: 2, md: 4 } }}>
        <Stack spacing={3}>
          {fields.map((field) => {
            const value = state.chargeSheet[field.name];
            const showError = attempted && Boolean(errors[field.name]);

            return (
              <TextField
                error={showError}
                fullWidth
                helperText={
                  showError
                    ? errors[field.name]
                    : `${field.helper} ${value.length}/${chargeSheetLimits[field.name]} characters.`
                }
                inputRef={fieldRefs[field.name]}
                key={field.name}
                label={field.label}
                minRows={field.minRows}
                multiline={field.multiline}
                onChange={(event) =>
                  dispatch({
                    type: "setChargeField",
                    field: field.name,
                    value: event.target.value
                  })
                }
                required
                slotProps={{
                  htmlInput: {
                    maxLength: chargeSheetLimits[field.name]
                  }
                }}
                value={value}
              />
            );
          })}
          <Alert severity="info">
            .txt / .md import appears here for review, but real deterministic
            parsing starts in Milestone 5.
          </Alert>
          <Button disabled variant="outlined">
            Import Charge Sheet in Milestone 5
          </Button>
          <Box>
            <Button onClick={handleContinue} variant="contained">
              Continue to Advocates
            </Button>
          </Box>
          {hasErrors ? (
            <Typography color="text.secondary" variant="body2">
              Required fields must be valid before proceeding.
            </Typography>
          ) : null}
        </Stack>
      </Paper>
    </Stack>
  );
}
