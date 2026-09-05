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

// Milestone 14 (Ivory & Iron, Issue #39 Phase 3) -- the product's one
// loading motif: a slow, low-contrast opacity pulse on the currently
// active seat's own status chip, never a generic spinner. Honors
// prefers-reduced-motion via the theme's existing global override
// (MuiCssBaseline, theme.ts) -- that rule forces every animation's
// duration to ~0 for reduced-motion users, so no separate media query
// is needed here.
const pulseKeyframes = {
  "@keyframes tribunal-status-pulse": {
    "0%, 100%": { opacity: 1 },
    "50%": { opacity: 0.55 }
  }
};

export function StatusBadge({ status }: { status: ParticipantStatus }) {
  return (
    <Chip
      aria-label={`Status: ${status}`}
      color={statusColor[status]}
      label={status}
      size="small"
      sx={
        status === "Running"
          ? { ...pulseKeyframes, animation: "tribunal-status-pulse 1.8s ease-in-out infinite" }
          : undefined
      }
      variant={status === "Waiting" ? "outlined" : "filled"}
    />
  );
}
