// M9 (Separate-Model Tribunal, Issue #20) -- the Separate-Mode
// per-participant counterpart to ModelSelect.tsx's Shared-Mode selector.
// Deliberately a SEPARATE, small component rather than a risky refactor
// of the already-audited Shared selector: a role-only catalog entry is
// never described with Shared's "conservative full-Tribunal estimate"
// copy or its priceTier chip (a role-only route is never claimed capable
// of serving the complete Tribunal -- see modelsApi.ts's RoleEligibleModel
// comment). Purely presentational, same as ModelSelect -- it renders
// whatever real GET /api/models?role=... catalog its caller fetched and
// passed in, with the same explicit loading/error/empty states, and
// never falls back to a mock catalog silently.

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
import type { RoleEligibleModel } from "../services/modelsApi";

export function RoleModelSelect({
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
  models: RoleEligibleModel[];
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
                {model.isFree ? <Chip label="FREE" size="small" variant="filled" /> : null}
              </Stack>
              <Typography color="text.secondary" variant="caption">
                {model.id} · {model.providerName} · conservative estimate for this
                participant: ${model.conservativeParticipantEstimateUsd}
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
