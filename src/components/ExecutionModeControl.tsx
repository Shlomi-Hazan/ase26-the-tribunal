import {
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography
} from "@mui/material";
import { useSetup } from "../features/case-setup/useSetup";
import type { ExecutionMode } from "../mocks/tribunalMockData";
import { ModelSelect } from "./ModelSelect";

export function ExecutionModeControl() {
  const { state, dispatch } = useSetup();

  function setMode(mode: ExecutionMode) {
    dispatch({ type: "setExecutionMode", mode });
  }

  return (
    <Stack spacing={2}>
      <FormControl>
        <Typography component="legend" sx={{ fontWeight: 800 }}>
          Execution mode
        </Typography>
        <RadioGroup
          name="execution-mode"
          onChange={(event) => setMode(event.target.value as ExecutionMode)}
          value={state.executionMode}
        >
          <FormControlLabel
            control={<Radio />}
            label="Shared Model"
            value="shared"
          />
          <Typography color="text.secondary" sx={{ ml: 4 }} variant="body2">
            One model, seven distinct roles and personalities.
          </Typography>
          <FormControlLabel
            control={<Radio />}
            label="Separate Models"
            value="separate"
          />
          <Typography color="text.secondary" sx={{ ml: 4 }} variant="body2">
            Each participant can use a different eligible model.
          </Typography>
        </RadioGroup>
      </FormControl>
      {state.executionMode === "shared" ? (
        <ModelSelect
          id="shared-model"
          label="Shared mock model"
          onChange={(modelId) =>
            dispatch({ type: "setSharedModel", modelId })
          }
          value={state.sharedModelId}
        />
      ) : null}
    </Stack>
  );
}
