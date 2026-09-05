// Milestone 12 -- Home surface (Issue #32 Sec 5). `/` previously
// redirected straight into `/new/charge-sheet` -- there was no Home page.
// This is the smallest generic surface exposing exactly three actions:
// Create/New Tribunal, Past Cases, and the Featured Jon Snow Demo. Only
// the Jon Snow card below carries GoT-themed presentation (Issue #32
// Sec 10); everything else on this page, and the rest of the site,
// stays Tribunal-generic.
//
// Milestone 14 (Ivory & Iron, Issue #39 Phase 2) -- adds a hero section
// above the existing 3-card grid. Purely presentational: no new action,
// no new route. The hero's two buttons link to the SAME two routes the
// cards below already expose (/new/charge-sheet, /demo/jon-snow) -- the
// cards are not removed, they remain the secondary, detailed reinforcement
// of the same three actions the hero elevates.
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { HomeHeroArt } from "../components/HomeHeroArt";
import { JonSnowHomeCard } from "../components/JonSnowHomeCard";

export function HomePage() {
  return (
    <Stack spacing={5}>
      <Box
        component="section"
        sx={{
          alignItems: "center",
          borderRadius: 4,
          display: "grid",
          gap: { xs: 3, md: 5 },
          gridTemplateColumns: { xs: "1fr", md: "1.1fr 0.9fr" },
          overflow: "hidden",
          position: "relative"
        }}
      >
        <Stack spacing={2.5} sx={{ position: "relative", zIndex: 1 }}>
          <Typography
            color="text.secondary"
            sx={{ fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}
            variant="caption"
          >
            The Tribunal
          </Typography>
          <Typography component="h1" sx={{ textWrap: "balance" }} variant="h2">
            Deliberation,
            <br />
            <Box component="span" sx={{ color: "#8C6423" }}>
              reimagined.
            </Box>
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: "48ch" }} variant="body1">
            An educational AI deliberation exercise with seven fixed participants: four advocates,
            three judges, one deterministic majority verdict -- every run fully auditable.
          </Typography>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button component={RouterLink} to="/new/charge-sheet" size="large" variant="contained">
              New Tribunal
            </Button>
            <Button component={RouterLink} to="/demo/jon-snow" size="large" variant="outlined">
              Open Jon Snow Demo
            </Button>
          </Stack>
        </Stack>
        <Box
          sx={{
            aspectRatio: "4 / 3",
            borderRadius: 3,
            display: { xs: "none", sm: "block" },
            overflow: "hidden"
          }}
        >
          <HomeHeroArt />
        </Box>
      </Box>
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
