// Milestone 12 (human product override, PR #34 Sec 13-15) -- Home's
// Jon Snow card. Two explicit actions: PRIMARY "Run Jon Snow Demo" (true
// one-click when a demo access capability is present and the default
// model is currently eligible and within the operator-funded demo's
// cost policy -- calls the dedicated canonical demo endpoint directly,
// no intermediate navigation, no OpenRouterConnect, no confirmation
// page); SECONDARY "Modify settings / models" (links to /demo/jon-snow).
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import Decimal from "decimal.js";
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useEligibleModels } from "../features/case-setup/useEligibleModels";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";
import { JON_SNOW_DEMO_MAX_ESTIMATE_USD } from "../features/jon-snow-demo/jonSnowDemoEconomics";
import { useJonSnowDemoStart } from "../features/tribunal-run/useJonSnowDemoStart";
import { hasJonSnowDemoAccess } from "../services/jonSnowDemoAccess";

export function JonSnowHomeCard() {
  const navigate = useNavigate();
  // Read once at mount -- src/main.tsx already captured any `#demo=...`
  // fragment into sessionStorage before this component (or any other
  // React component) ever rendered, so there is no capture-vs-render
  // race to handle here.
  const [hasAccess] = useState(() => hasJonSnowDemoAccess());
  // Metadata-only catalog fetch (GET /api/models, zero cost) -- no
  // pricing is computed in browser code; every figure below is read
  // directly from this response.
  const { models, loading: modelsLoading, error: modelsError } = useEligibleModels();
  const { isSubmitting, error: runStartError, start } = useJonSnowDemoStart();

  const catalogReady = !modelsLoading && !modelsError;
  const defaultModel = models.find((model) => model.id === JON_SNOW_DEFAULT_MODEL_ID);
  const defaultInPolicy =
    defaultModel !== undefined &&
    new Decimal(defaultModel.conservativeFullTribunalEstimateUsd).lte(
      new Decimal(JON_SNOW_DEMO_MAX_ESTIMATE_USD)
    );
  // No silent fallback (Issue #32 Sec 8, reaffirmed by the human
  // override): Run is enabled only when the catalog has loaded, the
  // configured default is currently eligible AND within the demo's own
  // cost ceiling, a demo access capability is present, and no submission
  // is already in flight.
  const canRun = hasAccess && catalogReady && defaultInPolicy && !isSubmitting;

  async function handleRun() {
    if (!canRun) {
      return;
    }

    const result = await start(JON_SNOW_DEFAULT_MODEL_ID);

    if (!result) {
      return;
    }

    const { run, executionTriggered } = result;

    // Direct to the themed run route -- no intermediate `/demo/jon-snow`
    // navigation, no confirmation page, no second button press.
    if (executionTriggered || run.status === "BLOCKED_BUDGET") {
      navigate(`/demo/jon-snow/runs/${run.id}`);
    }
  }

  return (
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
            sx={{ color: "#c9a35a", fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}
            variant="caption"
          >
            Featured demo
          </Typography>
          <Typography component="h2" sx={{ color: "#f2e9d8" }} variant="h6">
            The Realm v. Jon Snow
          </Typography>
          <Typography sx={{ color: "#cbbfa8" }} variant="body2">
            A canonical, one-click case: Jon Snow and Tyrion Lannister for the defense, Daenerys
            Targaryen and Grey Worm for the prosecution, judged by three research-based
            judicial-method profiles. Real Tribunal engine, operator-funded.
          </Typography>

          <Box sx={{ borderTop: "1px solid rgba(255,255,255,0.12)", pt: 1.5 }}>
            {modelsLoading ? (
              <Typography sx={{ color: "#cbbfa8" }} variant="body2">
                Checking demo availability...
              </Typography>
            ) : modelsError ? (
              <Alert severity="error">{modelsError}</Alert>
            ) : (
              <Typography sx={{ color: "#cbbfa8" }} variant="body2">
                Default model: {defaultModel?.name ?? JON_SNOW_DEFAULT_MODEL_ID} · 7 expected
                logical calls · conservative estimate{" "}
                {defaultModel ? `$${defaultModel.conservativeFullTribunalEstimateUsd}` : "unavailable"}{" "}
                · operator-funded demo, maximum ${JON_SNOW_DEMO_MAX_ESTIMATE_USD}
              </Typography>
            )}
            {catalogReady && !defaultInPolicy ? (
              <Alert severity="warning" sx={{ mt: 1 }}>
                The configured default model is not currently eligible within the operator-funded
                demo's ${JON_SNOW_DEMO_MAX_ESTIMATE_USD} maximum. Use Modify settings / models to
                choose another eligible model.
              </Alert>
            ) : null}
            {!hasAccess ? (
              <Alert severity="info" sx={{ mt: 1 }}>
                One-click Run requires a lecturer presentation link. Open Modify settings / models
                to review the canonical case.
              </Alert>
            ) : null}
            {runStartError ? (
              <Alert severity="error" sx={{ mt: 1 }}>
                {runStartError}
              </Alert>
            ) : null}
          </Box>

          <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
            <Button
              disabled={!canRun}
              onClick={handleRun}
              sx={{
                bgcolor: "#c9a35a",
                color: "#1c2530",
                "&:hover": { bgcolor: "#dab876" }
              }}
              variant="contained"
            >
              {isSubmitting ? "Starting..." : "Run Jon Snow Demo"}
            </Button>
            <Button
              component={RouterLink}
              sx={{ borderColor: "rgba(242,233,216,0.5)", color: "#f2e9d8" }}
              to="/demo/jon-snow"
              variant="outlined"
            >
              Modify settings / models
            </Button>
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}
