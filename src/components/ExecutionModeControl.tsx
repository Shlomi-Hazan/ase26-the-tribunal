import { useCallback } from "react";
import {
  FormControl,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography
} from "@mui/material";
import { useEligibleModels } from "../features/case-setup/useEligibleModels";
import { useSetup } from "../features/case-setup/useSetup";
import type { ExecutionMode } from "../mocks/tribunalMockData";
import { ModelSelect } from "./ModelSelect";

export function ExecutionModeControl() {
  const { state, dispatch } = useSetup();
  const handleAutoSelect = useCallback(
    (modelId: string) => dispatch({ type: "setSharedModel", modelId }),
    [dispatch]
  );
  const { models, loading, error } = useEligibleModels(state.sharedModelId, handleAutoSelect);

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
            disabled
            label="Separate Models"
            value="separate"
          />
          <Typography color="text.secondary" sx={{ ml: 4 }} variant="body2">
            Each participant can use a different eligible model. Available in
            a future milestone (M9) -- Milestone 8 executes Shared-Model
            Tribunal runs only.
          </Typography>
        </RadioGroup>
      </FormControl>
      {state.executionMode === "shared" ? (
        <ModelSelect
          error={error}
          id="shared-model"
          label="Shared model"
          loading={loading}
          models={models}
          onChange={(modelId) => dispatch({ type: "setSharedModel", modelId })}
          value={state.sharedModelId}
        />
      ) : null}
    </Stack>
  );
}
