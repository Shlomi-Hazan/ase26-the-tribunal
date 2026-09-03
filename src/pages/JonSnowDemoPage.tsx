// Milestone 12 -- Jon Snow demo launcher (Issue #32 Sec 6, `/demo/jon-snow`).
//
// Builds the SAME RunCaseRequest/RunParticipantRequest[] shape ReviewPage
// already builds, from the static canonical preset instead of SetupState,
// and submits through the SAME shared useRunStart hook and the SAME
// normal run API (POST /api/runs) -- no Smart Extraction, no eighth
// model call, no duplicate engine. Preferred execution mode is SHARED
// (Issue #32 requirement); the lecturer never walks through the normal
// Charge Sheet/Advocates/Judges wizard.
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { OpenRouterConnect } from "../components/OpenRouterConnect";
import { PageHeader } from "../components/PageHeader";
import { useEligibleModels } from "../features/case-setup/useEligibleModels";
import {
  JON_SNOW_CASE_SOURCE_TYPE,
  JON_SNOW_CHARGE_SHEET,
  JON_SNOW_PARTICIPANTS,
  JON_SNOW_PRESET_VERSION
} from "../features/jon-snow-demo/canonicalPreset";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";
import { useRunStart } from "../features/tribunal-run/useRunStart";
import { hasUserOpenRouterKey } from "../services/openRouterCredential";
import { participantIds, type ParticipantId } from "../schemas/tribunalSetup";
import type { RunCaseRequest, RunParticipantRequest, StoredRun } from "../services/runApi";

const SEAT_ORDER: Array<{ id: ParticipantId; label: string }> = [
  { id: "advocate-pro-1", label: "PRO I -- Defense" },
  { id: "advocate-pro-2", label: "PRO II -- Defense" },
  { id: "advocate-con-1", label: "CON I -- Opposition/Prosecution" },
  { id: "advocate-con-2", label: "CON II -- Opposition/Prosecution" },
  { id: "judge-1", label: "Judge I" },
  { id: "judge-2", label: "Judge II" },
  { id: "judge-3", label: "Judge III" }
];

function buildJonSnowCaseRequest(): RunCaseRequest {
  return {
    kind: "new",
    case: {
      ...JON_SNOW_CHARGE_SHEET,
      sourceType: JON_SNOW_CASE_SOURCE_TYPE
    }
  };
}

function buildJonSnowParticipantsRequest(modelId: string): RunParticipantRequest[] {
  return participantIds.map((participantId) => {
    const preset = JON_SNOW_PARTICIPANTS[participantId];

    return {
      participantId,
      profileName: preset.profileName,
      personality: preset.personality,
      personalitySource: preset.personalitySource,
      modelId
    };
  });
}

export function JonSnowDemoPage() {
  const navigate = useNavigate();
  const [openRouterConnected, setOpenRouterConnected] = useState(() => hasUserOpenRouterKey());
  const [selectedModelId, setSelectedModelId] = useState<string>(JON_SNOW_DEFAULT_MODEL_ID);
  const [showModelChooser, setShowModelChooser] = useState(false);
  const [conveneResult, setConveneResult] = useState<StoredRun | null>(null);
  // Metadata-only catalog fetch (GET /api/models, zero cost) -- the same
  // existing hook AdvocatesPage/JudgesPage/ReviewPage already use. No
  // onAutoSelect callback is passed: unlike the normal setup flow, this
  // page must never silently substitute a different model for an
  // ineligible default (Issue #32 Sec 8) -- any change to
  // `selectedModelId` here is only ever an explicit user action below.
  const { models, loading: modelsLoading, error: modelsError } = useEligibleModels();
  const { isSubmitting, error: runStartError, start } = useRunStart();

  const defaultModelEligible = models.some((model) => model.id === JON_SNOW_DEFAULT_MODEL_ID);
  const selectedModel = models.find((model) => model.id === selectedModelId);
  const catalogReady = !modelsLoading && !modelsError;
  const hasEligibleSelection = catalogReady && selectedModel !== undefined;
  const modelChooserOpen = showModelChooser || (catalogReady && !defaultModelEligible);
  const canRun = hasEligibleSelection && openRouterConnected && !isSubmitting && !conveneResult;

  async function handleRun() {
    if (!canRun) {
      return;
    }

    const caseRequest = buildJonSnowCaseRequest();
    const participants = buildJonSnowParticipantsRequest(selectedModelId);

    const result = await start(caseRequest, "shared", participants);

    if (!result) {
      return;
    }

    const { run, executionTriggered } = result;

    setConveneResult(run);

    // Themed run route (Issue #32 Sec 10) -- reuses RunPage's own
    // data/logic unmodified; only the presentational wrapper differs
    // from the generic /runs/:runId that History/Case Detail use.
    if (executionTriggered || run.status === "BLOCKED_BUDGET") {
      navigate(`/demo/jon-snow/runs/${run.id}`);
    }
  }

  return (
    <Stack spacing={4}>
      <PageHeader
        description="Case T-001: The Realm v. Jon Snow -- a canonical, deterministic case run through the real Tribunal engine."
        eyebrow="Featured Demo"
        title="The Jon Snow Demo"
      />
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
            <Typography color="text.secondary" variant="caption">
              The three Judge profiles are research-based simulations of documented judicial
              method and writing characteristics -- not an impersonation, and not a prediction
              of how the real jurist would decide this fictional case.
            </Typography>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography component="h2" sx={{ mb: 1 }} variant="h5">
            Connect OpenRouter
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
            Runtime model inference is user-funded: any charges from running this demo go to
            your own connected OpenRouter account, never the developer's.
          </Typography>
          <OpenRouterConnect connected={openRouterConnected} onConnectedChange={setOpenRouterConnected} />
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack spacing={1.5}>
            <Typography component="h2" variant="h5">
              Model
            </Typography>
            {modelsLoading ? (
              <Typography color="text.secondary" variant="body2">
                Checking the current eligible model catalog...
              </Typography>
            ) : modelsError ? (
              <Alert severity="error">{modelsError}</Alert>
            ) : defaultModelEligible ? (
              <Typography color="text.secondary" variant="body2">
                Default: {models.find((model) => model.id === JON_SNOW_DEFAULT_MODEL_ID)?.name}{" "}
                ({JON_SNOW_DEFAULT_MODEL_ID}).
              </Typography>
            ) : (
              <Alert severity="warning">
                The configured default model ({JON_SNOW_DEFAULT_MODEL_ID}) is not currently
                eligible. Choose another eligible model below to continue -- the demo never
                silently substitutes a different model.
              </Alert>
            )}
            {!modelChooserOpen ? (
              <Button onClick={() => setShowModelChooser(true)} size="small" variant="text">
                Choose a different model
              </Button>
            ) : catalogReady && models.length > 0 ? (
              <TextField
                label="Model"
                onChange={(event) => setSelectedModelId(event.target.value)}
                select
                size="small"
                value={models.some((model) => model.id === selectedModelId) ? selectedModelId : ""}
                sx={{ maxWidth: 420 }}
              >
                {models.map((model) => (
                  <MenuItem key={model.id} value={model.id}>
                    {model.name} ({model.priceTier})
                  </MenuItem>
                ))}
              </TextField>
            ) : catalogReady ? (
              <Alert severity="error">No eligible model is currently available.</Alert>
            ) : null}
          </Stack>
        </CardContent>
      </Card>
      {runStartError ? <Alert severity="error">{runStartError}</Alert> : null}
      {conveneResult ? (
        <Alert severity="success">
          Tribunal configuration frozen. Run ID: {conveneResult.id}
        </Alert>
      ) : null}
      {canRun ? null : (
        <Typography color="text.secondary" variant="body2">
          {!openRouterConnected
            ? "Connect OpenRouter above before running the demo."
            : !hasEligibleSelection
              ? "Select a currently eligible model above before running the demo."
              : ""}
        </Typography>
      )}
      <Stack direction="row" spacing={2}>
        <Button disabled={!canRun} onClick={handleRun} size="large" variant="contained">
          {isSubmitting ? "Starting..." : conveneResult ? "Configuration frozen" : "Run Jon Snow Demo"}
        </Button>
      </Stack>
    </Stack>
  );
}
