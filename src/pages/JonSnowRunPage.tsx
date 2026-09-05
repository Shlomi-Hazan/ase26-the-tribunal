// Milestone 12 -- themed Jon Snow run route (Issue #32 Sec 10,
// `/demo/jon-snow/runs/:runId`). A PRESENTATION wrapper only: it reuses
// RunPage's own data-fetching (GET /api/runs/:id polling) and result/
// audit/protocol rendering completely unmodified -- no second copy of
// the run is fetched, no duplicate execution/majority/economics/
// protocol logic exists here. `RunPage` reads `:runId` from
// `useParams()`, which resolves the same way regardless of which
// registered route matched, so rendering the identical component here
// costs nothing extra.
//
// Theme is a pure function of which route was used to reach this run
// (Issue #32 Sec 10-11): the Jon Snow launcher always navigates here on
// success; History/Case Detail always link to the generic `/runs/:runId`
// (unchanged) regardless of a run's origin. Reloading or deep-linking
// either URL reproduces the correct presentation statelessly -- no DB
// scenario marker, no content sniffing (defendant name or otherwise).
//
// Milestone 14 (Ivory & Iron, Issue #39 Phase 4): the banner below now
// uses the real, locked jonSnowTheme tokens (previously ad-hoc hex not
// drawn from any design system) and the shared crest motif. The
// surrounding shell -- AppBar included -- and `<RunPage/>` itself are
// now themed dark automatically via AppThemeProvider (App.tsx), which
// selects jonSnowTheme for every /demo/jon-snow* route; this banner is
// only the one extra "featured demo" accent layered on top, exactly as
// before. RunPage's own logic remains completely unmodified.
import { Box, Stack, Typography } from "@mui/material";
import { JonSnowCrest } from "../components/JonSnowCrest";
import { RunPage } from "./RunPage";

const iron = "#161B22";
const night = "#0B0F14";
const ironBorder = "#2A323D";
const frost = "#D8DEE6";
const steel = "#7C8695";
const direBronze = "#A98548";

export function JonSnowRunPage() {
  return (
    <Stack spacing={3}>
      <Box
        sx={{
          alignItems: "center",
          background: `linear-gradient(160deg, ${iron} 0%, ${night} 100%)`,
          border: `1px solid ${ironBorder}`,
          borderRadius: 2,
          display: "flex",
          justifyContent: "space-between",
          p: { xs: 2, md: 3 }
        }}
      >
        <Box>
          <Typography
            sx={{ color: direBronze, fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}
            variant="caption"
          >
            Featured demo
          </Typography>
          <Typography component="h2" sx={{ color: frost, fontFamily: '"Fraunces", Georgia, serif' }} variant="h5">
            The Realm v. Jon Snow
          </Typography>
          <Typography sx={{ color: steel, mt: 0.5 }} variant="body2">
            This is the real Tribunal engine -- the result below is authoritative, not staged.
          </Typography>
        </Box>
        <JonSnowCrest size={40} />
      </Box>
      <RunPage />
    </Stack>
  );
}
