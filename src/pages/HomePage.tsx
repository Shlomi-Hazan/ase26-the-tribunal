// Milestone 12 -- Home surface (Issue #32 Sec 5). `/` previously
// redirected straight into `/new/charge-sheet` -- there was no Home page.
// This is the smallest generic surface exposing exactly three actions:
// Create/New Tribunal, Past Cases, and the Featured Jon Snow Demo. Only
// the Jon Snow card below carries GoT-themed presentation (Issue #32
// Sec 10); everything else on this page, and the rest of the site,
// stays Tribunal-generic.
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { JonSnowHomeCard } from "../components/JonSnowHomeCard";
import { PageHeader } from "../components/PageHeader";

export function HomePage() {
  return (
    <Stack spacing={4}>
      <PageHeader
        // Human product override (PR #34 Sec 23): Agent Mode is
        // cancelled -- ordinary Tribunal participant calls must not be
        // marketed as agents.
        description="An educational AI deliberation exercise with seven fixed participants."
        eyebrow="The Tribunal"
        title="Home"
      />
      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }
        }}
      >
        <Card component="section">
          <CardContent>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Create a Tribunal
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Enter your own Charge Sheet, configure seven participants, and convene a real
                deliberation.
              </Typography>
              <Button component={RouterLink} to="/new/charge-sheet" variant="contained">
                New Tribunal
              </Button>
            </Stack>
          </CardContent>
        </Card>
        <Card component="section">
          <CardContent>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Past Cases
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Reopen a stored case and inspect any Tribunal runs associated with it --
                read-only, no model calls.
              </Typography>
              <Button component={RouterLink} to="/history" variant="outlined">
                View Past Cases
              </Button>
            </Stack>
          </CardContent>
        </Card>
        <JonSnowHomeCard />
      </Box>
    </Stack>
  );
}
