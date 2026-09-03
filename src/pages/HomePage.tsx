// Milestone 12 -- Home surface (Issue #32 Sec 5). `/` previously
// redirected straight into `/new/charge-sheet` -- there was no Home page.
// This is the smallest generic surface exposing exactly three actions:
// Create/New Tribunal, Past Cases, and the Featured Jon Snow Demo. Only
// the Jon Snow card below carries GoT-themed presentation (Issue #32
// Sec 10); everything else on this page, and the rest of the site,
// stays Tribunal-generic.
import { Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";

export function HomePage() {
  return (
    <Stack spacing={4}>
      <PageHeader
        description="An educational multi-agent deliberation exercise: seven fixed participants argue and judge a case you provide."
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
        <Card
          component="section"
          sx={{
            background: "linear-gradient(160deg, #1c2530 0%, #33261a 100%)",
            border: "1px solid rgba(255, 255, 255, 0.12)",
            color: "#f2e9d8"
          }}
        >
          <CardContent>
            <Stack spacing={1.5}>
              <Typography
                sx={{
                  color: "#c9a35a",
                  fontWeight: 800,
                  letterSpacing: 1,
                  textTransform: "uppercase"
                }}
                variant="caption"
              >
                Featured demo
              </Typography>
              <Typography component="h2" sx={{ color: "#f2e9d8" }} variant="h6">
                The Realm v. Jon Snow
              </Typography>
              <Typography sx={{ color: "#cbbfa8" }} variant="body2">
                A canonical, one-click case: Jon Snow and Tyrion Lannister for the defense,
                Daenerys Targaryen and Grey Worm for the prosecution, judged by three
                research-based judicial-method profiles. Real Tribunal engine, your own
                OpenRouter credential.
              </Typography>
              <Button
                component={RouterLink}
                sx={{
                  bgcolor: "#c9a35a",
                  color: "#1c2530",
                  "&:hover": { bgcolor: "#dab876" }
                }}
                to="/demo/jon-snow"
                variant="contained"
              >
                Enter the Jon Snow Demo
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Box>
    </Stack>
  );
}
