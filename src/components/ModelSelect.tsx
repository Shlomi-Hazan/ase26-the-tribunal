import {
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
  type SelectChangeEvent
} from "@mui/material";
import { mockModels } from "../mocks/tribunalMockData";

export function ModelSelect({
  id,
  label,
  value,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  onChange: (modelId: string) => void;
}) {
  const labelId = `${id}-label`;

  function handleChange(event: SelectChangeEvent) {
    onChange(event.target.value);
  }

  return (
    <FormControl fullWidth size="small">
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        id={id}
        label={label}
        labelId={labelId}
        onChange={handleChange}
        value={value}
      >
        {mockModels.map((model) => (
          <MenuItem disabled={!model.eligible} key={model.id} value={model.id}>
            <Stack spacing={0.5}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Typography component="span">{model.displayName}</Typography>
                <Chip
                  label={model.classification}
                  size="small"
                  variant={model.classification === "Free" ? "filled" : "outlined"}
                />
              </Stack>
              <Typography color="text.secondary" variant="caption">
                {model.id} · {model.priceLabel} · Mock model data
              </Typography>
            </Stack>
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}
