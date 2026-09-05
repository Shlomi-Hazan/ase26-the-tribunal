// Milestone 12 (human product override, PR #34 Sec 16-18) -- `/demo/
// jon-snow` is redefined from a BYOK-gated launcher into the "Modify
// settings / models" detail page. The demo is operator-funded
// (SECURITY.md Sec 3.1.1): there is no OpenRouter credential field or
// OpenRouterConnect on this page at all. Only the SHARED model may be
// customized, restricted to models that are both currently eligible AND
// within the operator-funded demo's own cost ceiling
// (JON_SNOW_DEMO_MAX_ESTIMATE_USD) -- an expensive model is omitted from
// the list entirely rather than shown disabled.
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from "@mui/material";
import Decimal from "decimal.js";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { JonSnowCrest } from "../components/JonSnowCrest";
import { PageHeader } from "../components/PageHeader";
import { useEligibleModels } from "../features/case-setup/useEligibleModels";
import {
  JON_SNOW_CHARGE_SHEET,
  JON_SNOW_DOSSIER_DISCLAIMER,
  JON_SNOW_PARTICIPANTS,
  JON_SNOW_PRESET_VERSION
} from "../features/jon-snow-demo/canonicalPreset";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";
import { JON_SNOW_DEMO_MAX_ESTIMATE_USD } from "../features/jon-snow-demo/jonSnowDemoEconomics";
import { useJonSnowDemoStart } from "../features/tribunal-run/useJonSnowDemoStart";
import type { ParticipantId } from "../schemas/tribunalSetup";
import type { EligibleModel } from "../services/modelsApi";

const SEAT_ORDER: Array<{ id: ParticipantId; label: string }> = [
  { id: "advocate-pro-1", label: "PRO I -- Defense" },
  { id: "advocate-pro-2", label: "PRO II -- Defense" },
  { id: "advocate-con-1", label: "CON I -- Opposition/Prosecution" },
  { id: "advocate-con-2", label: "CON II -- Opposition/Prosecution" },
  { id: "judge-1", label: "Judge I" },
  { id: "judge-2", label: "Judge II" },
  { id: "judge-3", label: "Judge III" }
];

const DEMO_MAX_ESTIMATE = new Decimal(JON_SNOW_DEMO_MAX_ESTIMATE_USD);

function isWithinDemoPolicy(model: EligibleModel): boolean {
  return new Decimal(model.conservativeFullTribunalEstimateUsd).lte(DEMO_MAX_ESTIMATE);
}

export function JonSnowSettingsPage() {
  const navigate = useNavigate();
  const [selectedModelId, setSelectedModelId] = useState<string>(JON_SNOW_DEFAULT_MODEL_ID);
  // Metadata-only catalog fetch (GET /api/models, zero cost) -- the same
  // existing hook used elsewhere. No onAutoSelect callback: this page
  // must never silently substitute a model for an ineligible/over-policy
  // default -- any change to `selectedModelId` here is an explicit user
  // action against the pre-filtered, in-policy list below.
  const { models, loading: modelsLoading, error: modelsError } = useEligibleModels();
  const { isSubmitting, error: runStartError, start } = useJonSnowDemoStart();

  const catalogReady = !modelsLoading && !modelsError;
  // Sec 17: currently eligible AND within the demo's own cost ceiling --
  // an over-policy model is omitted from this list entirely, never shown
  // disabled.
  const allowedModels = models.filter(isWithinDemoPolicy);
  const selectedModel = allowedModels.find((model) => model.id === selectedModelId);
  const canRun = catalogReady && selectedModel !== undefined && !isSubmitting;

  async function handleRun() {
    if (!canRun) {
      return;
    }

    const result = await start(selectedModelId);

    if (!result) {
      return;
    }

    const { run, executionTriggered } = result;

    if (executionTriggered || run.status === "BLOCKED_BUDGET") {
      navigate(`/demo/jon-snow/runs/${run.id}`);
    }
  }

  return (
    <Stack spacing={4}>
      {/* Milestone 14 (Ivory & Iron, Issue #39 Phase 4): the crest is the
          one added thematic touch here -- PageHeader itself is the same
          shared, generic component every other page uses (now rendering
          in the full dark chamber automatically via AppThemeProvider,
          since this page has no ad-hoc colors of its own). */}
      <Stack direction="row" sx={{ alignItems: "flex-start", justifyContent: "space-between" }}>
        <PageHeader
          description="Case T-001: The Realm v. Jon Snow -- a canonical, deterministic case run through the real Tribunal engine, operator-funded."
          eyebrow="Modify settings / models"
          title="Jon Snow Demo Settings"
        />
        <JonSnowCrest size={44} />
      </Stack>
      <Alert severity="info">{JON_SNOW_DOSSIER_DISCLAIMER}</Alert>
      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography component="h2" variant="h5">
              Canonical case
            </Typography>
            <Typography>
              <strong>Defendant:</strong> {JON_SNOW_CHARGE_SHEET.defendant}
            </Typography>
            <Typography>
              <strong>Exact Question:</strong> {JON_SNOW_CHARGE_SHEET.exactQuestion}
            </Typography>
            <Box
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: 2,
                maxHeight: 260,
                overflowY: "auto",
                p: 2,
                whiteSpace: "pre-wrap"
              }}
            >
              <Typography variant="body2">{JON_SNOW_CHARGE_SHEET.act}</Typography>
            </Box>
            <Typography color="text.secondary" variant="caption">
              Canonical preset {JON_SNOW_PRESET_VERSION}, drawn verbatim from the lecturer's
              case-design dossier.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography component="h2" variant="h5">
              Seven-participant configuration
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Shared model -- one model, seven fixed roles and personalities. The assigned seat
              fixes only each participant's procedural role and directional stance (PRO argues
              toward NOT_GUILTY, CON argues toward GUILTY); it does not fix any specific
              reasoning, evidence weighting, or argument, and no Judge's verdict is
              predetermined.
            </Typography>
            <Box
              sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }
              }}
            >
              {SEAT_ORDER.map((seat) => (
                <Box
                  key={seat.id}
                  sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}
                >
                  <Typography sx={{ fontWeight: 800 }}>{seat.label}</Typography>
                  <Typography color="text.secondary" variant="body2">
                    {JON_SNOW_PARTICIPANTS[seat.id].profileName}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography component="h2" variant="h5">
              Model &amp; economics
            </Typography>
            {modelsLoading ? (
              <Typography color="text.secondary" variant="body2">
                Checking the current eligible model catalog...
              </Typography>
            ) : modelsError ? (
              <Alert severity="error">{modelsError}</Alert>
            ) : allowedModels.length === 0 ? (
              <Alert severity="error">
                No currently eligible model is within the operator-funded demo's $
                {JON_SNOW_DEMO_MAX_ESTIMATE_USD} maximum.
              </Alert>
            ) : (
              <TextField
                label="Model"
                onChange={(event) => setSelectedModelId(event.target.value)}
                select
                size="small"
                sx={{ maxWidth: 420 }}
                value={selectedModel ? selectedModelId : ""}
              >
                {allowedModels.map((model) => (
                  <MenuItem key={model.id} value={model.id}>
                    {model.name} ({model.priceTier})
                  </MenuItem>
                ))}
              </TextField>
            )}
            {selectedModel ? (
              <Stack spacing={0.5}>
                <Typography variant="body2">Selected model: {selectedModel.name}</Typography>
                <Typography variant="body2">Price tier: {selectedModel.priceTier}</Typography>
                <Typography variant="body2">Expected logical calls: 7</Typography>
                <Typography variant="body2">Retry policy: max one retry per participant</Typography>
                <Typography variant="body2">
                  Conservative discovery estimate: ${selectedModel.conservativeFullTribunalEstimateUsd}
                </Typography>
                <Typography variant="body2">
                  Operator-funded demo maximum: ${JON_SNOW_DEMO_MAX_ESTIMATE_USD}
                </Typography>
                <Typography variant="body2">Generic product hard ceiling: $5.00 (unchanged)</Typography>
                <Typography color="text.secondary" variant="caption">
                  Discovery estimate only -- the authoritative server preflight runs again, using
                  the operator's own credential, when you Run.
                </Typography>
              </Stack>
            ) : null}
          </Stack>
        </CardContent>
      </Card>
      {runStartError ? <Alert severity="error">{runStartError}</Alert> : null}
      <Stack direction="row" spacing={2}>
        <Button disabled={!canRun} onClick={handleRun} size="large" variant="contained">
          {isSubmitting ? "Starting..." : "Run Jon Snow Demo"}
        </Button>
      </Stack>
    </Stack>
  );
}
