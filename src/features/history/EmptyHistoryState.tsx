import { Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

// Milestone 14 (Ivory & Iron, Issue #39 Phase 2) -- a simple, original
// line-drawn scale illustration, replacing plain text-only emptiness.
// Single-color linework only, no stock icon pack.
function EmptyScaleIllustration() {
  return (
    <svg aria-hidden="true" focusable="false" height="72" viewBox="0 0 96 72" width="96">
      <g fill="none" stroke="#B8892B" strokeLinecap="round" strokeLinejoin="round" strokeOpacity="0.55" strokeWidth="2.5">
        <line x1="48" x2="48" y1="8" y2="52" />
        <line x1="20" x2="76" y1="16" y2="16" />
        <path d="M20 16 L10 38 A18 18 0 0 0 30 38 Z" />
        <path d="M76 16 L66 38 A18 18 0 0 0 86 38 Z" />
        <line x1="34" x2="62" y1="60" y2="60" />
        <line x1="48" x2="48" y1="52" y2="60" />
      </g>
    </svg>
  );
}

export function EmptyHistoryState() {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2} sx={{ alignItems: "flex-start" }}>
          <EmptyScaleIllustration />
          <Typography component="h2" variant="h5">
            No cases yet
          </Typography>
          <Typography color="text.secondary">
            Convene your first Tribunal to create a history entry.
          </Typography>
          <Button component={RouterLink} to="/new/charge-sheet" variant="contained">
            Bring a Case
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
