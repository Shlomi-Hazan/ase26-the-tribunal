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

const SHARED_MODE_DESCRIPTION = "One model, seven distinct roles and personalities.";
const SEPARATE_MODE_DESCRIPTION =
  "Each participant can use a different eligible model, chosen per seat on the Advocates and Judges pages.";

export function ExecutionModeControl({
  compact
}: {
  // Milestone 14 (Advocates refinement pass, corrected): a purely
  // additive, opt-in compact LAYOUT. Omitted (the default), this
  // renders EXACTLY the prior markup/spacing -- JudgesPage never
  // passes this, so Judges is byte-for-byte unaffected. Passed only by
  // AdvocatesPage. No dispatch, model-selection, or execution-mode
  // logic differs between the two presentations -- only composition.
  //
  // First attempt at this shrunk font sizes, which hurt readability
  // without truly reducing bulk. This version instead: (a) lays the
  // two radio options out side by side (`row`) instead of stacked, and
  // (b) shows only the CURRENTLY selected mode's own description
  // instead of both descriptions always stacked below each option --
  // both are pure layout/composition choices, at full, comfortable
  // reading size throughout.
  compact?: boolean;
} = {}) {
  const { state, dispatch } = useSetup();
  const handleAutoSelect = useCallback(
    (modelId: string) => dispatch({ type: "setSharedModel", modelId }),
    [dispatch]
  );
  const { models, loading, error } = useEligibleModels(state.sharedModelId, handleAutoSelect);

  function setMode(mode: ExecutionMode) {
    dispatch({ type: "setExecutionMode", mode });
  }

  if (!compact) {
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
            <FormControlLabel control={<Radio />} label="Shared Model" value="shared" />
            <Typography color="text.secondary" sx={{ ml: 4 }} variant="body2">
              {SHARED_MODE_DESCRIPTION}
            </Typography>
            <FormControlLabel control={<Radio />} label="Separate Models" value="separate" />
            <Typography color="text.secondary" sx={{ ml: 4 }} variant="body2">
              {SEPARATE_MODE_DESCRIPTION}
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

  return (
    <Stack spacing={1.5}>
      <FormControl>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={{ xs: 1, sm: 3 }} sx={{ alignItems: { sm: "center" } }}>
          <Typography component="legend" sx={{ flexShrink: 0, fontWeight: 800 }}>
            Execution mode
          </Typography>
          <RadioGroup
            name="execution-mode"
            onChange={(event) => setMode(event.target.value as ExecutionMode)}
            row
            value={state.executionMode}
          >
            <FormControlLabel control={<Radio />} label="Shared Model" value="shared" />
            <FormControlLabel control={<Radio />} label="Separate Models" value="separate" />
          </RadioGroup>
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 0.5 }} variant="body2">
          {state.executionMode === "shared" ? SHARED_MODE_DESCRIPTION : SEPARATE_MODE_DESCRIPTION}
        </Typography>
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
