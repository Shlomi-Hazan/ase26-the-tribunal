import { Chip } from "@mui/material";
import type { ParticipantStatus } from "../mocks/tribunalMockData";

const statusColor: Record<
  ParticipantStatus,
  "default" | "info" | "warning" | "success" | "error"
> = {
  Waiting: "default",
  Running: "info",
  Retrying: "warning",
  Complete: "success",
  Failed: "error"
};

export function StatusBadge({ status }: { status: ParticipantStatus }) {
  return (
    <Chip
      aria-label={`Status: ${status}`}
      color={statusColor[status]}
      label={status}
      size="small"
      variant={status === "Waiting" ? "outlined" : "filled"}
    />
  );
}
