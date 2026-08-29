// Milestone 8 -- independent audit correction (Issue #17 blocker 1): the
// real Shared-Model setup path never uses mock/tribunalMockData model
// IDs. This component is now purely presentational -- it renders
// whatever real `models` (GET /api/models, M7) its caller fetched and
// passed in, with explicit loading/error/empty states, and never falls
// back to a mock catalog silently.

import {
  Alert,
  Chip,
  CircularProgress,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
  type SelectChangeEvent
} from "@mui/material";
import type { EligibleModel } from "../services/modelsApi";

export function ModelSelect({
  id,
  label,
  value,
  onChange,
  models,
  loading,
  error
}: {
  id: string;
  label: string;
  value: string;
  onChange: (modelId: string) => void;
  models: EligibleModel[];
  loading: boolean;
  error: string;
}) {
  const labelId = `${id}-label`;

  function handleChange(event: SelectChangeEvent) {
    onChange(event.target.value);
  }

  if (loading) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <CircularProgress size={20} />
        <Typography color="text.secondary" variant="body2">
          Loading eligible models...
        </Typography>
      </Stack>
    );
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>;
  }

  if (models.length === 0) {
    return (
      <Alert severity="warning">
        No eligible OpenRouter models are currently available. Try again shortly.
      </Alert>
    );
  }

  return (
    <FormControl fullWidth size="small">
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        id={id}
        label={label}
        labelId={labelId}
        onChange={handleChange}
        value={models.some((model) => model.id === value) ? value : ""}
      >
        {models.map((model) => (
          <MenuItem key={model.id} value={model.id}>
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography component="span">{model.name}</Typography>
                <Chip
                  label={model.priceTier}
                  size="small"
                  variant={model.isFree ? "filled" : "outlined"}
                />
              </Stack>
              <Typography color="text.secondary" variant="caption">
                {model.id} · {model.providerName} · conservative full-Tribunal estimate: $
                {model.conservativeFullTribunalEstimateUsd}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
