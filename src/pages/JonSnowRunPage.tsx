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
import { Box, Stack, Typography } from "@mui/material";
import { RunPage } from "./RunPage";

export function JonSnowRunPage() {
  return (
    <Stack spacing={3}>
      <Box
        sx={{
          background: "linear-gradient(160deg, #1c2530 0%, #33261a 100%)",
          border: "1px solid rgba(255, 255, 255, 0.12)",
          borderRadius: 2,
          color: "#f2e9d8",
          p: { xs: 2, md: 3 }
        }}
      >
        <Typography
          sx={{ color: "#c9a35a", fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}
          variant="caption"
        >
          Featured demo
        </Typography>
        <Typography component="h2" sx={{ color: "#f2e9d8" }} variant="h5">
          The Realm v. Jon Snow
        </Typography>
        <Typography sx={{ color: "#cbbfa8", mt: 0.5 }} variant="body2">
          This is the real Tribunal engine -- the result below is authoritative, not staged.
        </Typography>
      </Box>
      <RunPage />
    </Stack>
  );
}
