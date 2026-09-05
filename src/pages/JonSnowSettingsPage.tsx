// Milestone 12 (human product override, PR #34 Sec 16-18) -- `/demo/
// jon-snow` is redefined from a BYOK-gated launcher into the "Modify
// settings / models" detail page. The demo is operator-funded
// (SECURITY.md Sec 3.1.1): there is no OpenRouter credential field or
// OpenRouterConnect on this page at all. Only the SHARED model may be
// customized, restricted to models that are both currently eligible AND
// within the operator-funded demo's own cost ceiling
// (JON_SNOW_DEMO_MAX_ESTIMATE_USD) -- an expensive model is omitted from
// the list entirely rather than shown disabled.
//
// Milestone 14 visual-correction pass (PR #40) -- a cinematic banner
// replaces the generic PageHeader on this one page: original crest
// artwork, an original tagline (never a quote from the show/books), and
// a frost-dot texture built from layered CSS gradients only -- no
// photographic or franchise imagery anywhere. The seven participant
// seats are regrouped into Advocates/Case Overview/Judges columns (all
// real, existing data -- no fabricated fields like a filing date or
// location were added). Every hook, state value, and the model
// select/Run button's own logic is byte-identical to before; only their
// position and surrounding styling changed.
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from "@mui/material";
import Decimal from "decimal.js";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { JonSnowCrest } from "../components/JonSnowCrest";
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

const ADVOCATE_SEATS: Array<{ id: ParticipantId; label: string }> = [
  { id: "advocate-pro-1", label: "PRO I -- Defense" },
  { id: "advocate-pro-2", label: "PRO II -- Defense" },
  { id: "advocate-con-1", label: "CON I -- Opposition/Prosecution" },
  { id: "advocate-con-2", label: "CON II -- Opposition/Prosecution" }
];

const JUDGE_SEATS: Array<{ id: ParticipantId; label: string }> = [
  { id: "judge-1", label: "Judge I" },
  { id: "judge-2", label: "Judge II" },
  { id: "judge-3", label: "Judge III" }
];

const DEMO_MAX_ESTIMATE = new Decimal(JON_SNOW_DEMO_MAX_ESTIMATE_USD);

function isWithinDemoPolicy(model: EligibleModel): boolean {
  return new Decimal(model.conservativeFullTribunalEstimateUsd).lte(DEMO_MAX_ESTIMATE);
}

function SeatCard({ seat }: { seat: { id: ParticipantId; label: string } }) {
  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
      <Typography sx={{ fontWeight: 800 }}>{seat.label}</Typography>
      <Typography color="text.secondary" variant="body2">
        {JON_SNOW_PARTICIPANTS[seat.id].profileName}
      </Typography>
    </Box>
  );
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
      <Box
        sx={{
          background: "linear-gradient(160deg, #161B22 0%, #0B0F14 100%)",
          backgroundImage:
            "radial-gradient(1px 1px at 20% 30%, rgba(216,222,230,0.5) 0, transparent 60%), " +
            "radial-gradient(1px 1px at 70% 15%, rgba(216,222,230,0.4) 0, transparent 60%), " +
            "radial-gradient(1.5px 1.5px at 85% 55%, rgba(216,222,230,0.35) 0, transparent 60%), " +
            "radial-gradient(1px 1px at 40% 70%, rgba(216,222,230,0.3) 0, transparent 60%), " +
            "linear-gradient(160deg, #161B22 0%, #0B0F14 100%)",
          border: "1px solid #2A323D",
          borderRadius: 4,
          overflow: "hidden",
          p: { xs: 3, md: 5 },
          position: "relative"
        }}
      >
        <Box
          sx={{
            display: "grid",
            gap: { xs: 3, md: 4 },
            gridTemplateColumns: { xs: "1fr", md: "1.3fr 1fr" }
          }}
        >
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <JonSnowCrest size={40} />
              <Typography
                sx={{ color: "#A98548", fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}
                variant="caption"
              >
                The Realm v. Jon Snow
              </Typography>
            </Stack>
            <Typography
              component="h1"
              sx={{ color: "#D8DEE6", fontFamily: '"Fraunces", Georgia, serif' }}
              variant="h3"
            >
              Jon Snow Demo Settings
            </Typography>
            <Typography
              sx={{ color: "#7C8695", fontStyle: "italic", letterSpacing: "0.04em", textTransform: "uppercase" }}
              variant="caption"
            >
              Where oath and judgment meet
            </Typography>
            <Typography sx={{ color: "#D8DEE6", maxWidth: "56ch" }} variant="body2">
              Case T-001: a canonical, deterministic case run through the real Tribunal engine,
              operator-funded.
            </Typography>
          </Stack>

          <Box
            sx={{
              bgcolor: "rgba(22,27,34,0.7)",
              border: "1px solid #2A323D",
              borderRadius: 3,
              p: 2.5
            }}
          >
            <Stack spacing={1.5}>
              <Typography
                sx={{ color: "#A98548", fontWeight: 800, letterSpacing: 1, textTransform: "uppercase" }}
                variant="caption"
              >
                Demo Settings
              </Typography>
              {modelsLoading ? (
                <Typography sx={{ color: "#7C8695" }} variant="body2">
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
                  fullWidth
                  label="Model"
                  onChange={(event) => setSelectedModelId(event.target.value)}
                  select
                  size="small"
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
                <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
                  <Typography sx={{ color: "#7C8695" }} variant="caption">
                    Conservative estimate
                  </Typography>
                  <Typography sx={{ color: "#D8DEE6", fontWeight: 700 }} variant="body1">
                    ${selectedModel.conservativeFullTribunalEstimateUsd}
                  </Typography>
                </Stack>
              ) : null}
              {runStartError ? <Alert severity="error">{runStartError}</Alert> : null}
              <Button
                disabled={!canRun}
                fullWidth
                onClick={handleRun}
                size="large"
                sx={{
                  bgcolor: "#3D6B8C",
                  boxShadow: "0 8px 24px -8px rgba(61,107,140,0.6)",
                  color: "#FFFFFF",
                  "&:hover": { bgcolor: "#335A75" },
                  "&.Mui-disabled": { bgcolor: "rgba(216,222,230,0.12)", color: "#7C8695" }
                }}
                variant="contained"
              >
                {isSubmitting ? "Starting..." : "Run Jon Snow Demo"}
              </Button>
            </Stack>
          </Box>
        </Box>
      </Box>

      <Alert severity="info">{JON_SNOW_DOSSIER_DISCLAIMER}</Alert>

      <Box
        sx={{
          display: "grid",
          gap: 3,
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }
        }}
      >
        <Card>
          <CardContent>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Advocates
              </Typography>
              <Stack spacing={1.5}>
                {ADVOCATE_SEATS.map((seat) => (
                  <SeatCard key={seat.id} seat={seat} />
                ))}
              </Stack>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Case Overview
              </Typography>
              <Typography variant="body2">
                <strong>Defendant:</strong> {JON_SNOW_CHARGE_SHEET.defendant}
              </Typography>
              <Typography variant="body2">
                <strong>Exact Question:</strong> {JON_SNOW_CHARGE_SHEET.exactQuestion}
              </Typography>
              <Box
                sx={{
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  maxHeight: 220,
                  overflowY: "auto",
                  p: 1.5,
                  whiteSpace: "pre-wrap"
                }}
              >
                <Typography variant="body2">{JON_SNOW_CHARGE_SHEET.act}</Typography>
              </Box>
              <Typography color="text.secondary" variant="caption">
                Canonical preset {JON_SNOW_PRESET_VERSION}, drawn verbatim from the lecturer's
                case-design dossier.
              </Typography>
              <Typography color="text.secondary" variant="body2">
                Shared model -- one model, seven fixed roles and personalities. The assigned seat
                fixes only each participant's procedural role and directional stance (PRO argues
                toward NOT_GUILTY, CON argues toward GUILTY); it does not fix any specific
                reasoning, evidence weighting, or argument, and no Judge's verdict is
                predetermined.
              </Typography>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Stack spacing={1.5}>
              <Typography component="h2" variant="h6">
                Judges
              </Typography>
              <Stack spacing={1.5}>
                {JUDGE_SEATS.map((seat) => (
                  <SeatCard key={seat.id} seat={seat} />
                ))}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Box>

      {selectedModel ? (
        <Card>
          <CardContent>
            <Stack spacing={1}>
              <Typography component="h2" variant="h6">
                Model &amp; economics
              </Typography>
              <Typography variant="body2">Selected model: {selectedModel.name}</Typography>
              <Typography variant="body2">Price tier: {selectedModel.priceTier}</Typography>
              <Typography variant="body2">Expected logical calls: 7</Typography>
              <Typography variant="body2">Retry policy: max one retry per participant</Typography>
              <Typography variant="body2">
                Operator-funded demo maximum: ${JON_SNOW_DEMO_MAX_ESTIMATE_USD}
              </Typography>
              <Typography variant="body2">Generic product hard ceiling: $5.00 (unchanged)</Typography>
              <Typography color="text.secondary" variant="caption">
                Discovery estimate only -- the authoritative server preflight runs again, using
                the operator's own credential, when you Run.
              </Typography>
            </Stack>
          </CardContent>
        </Card>
      ) : null}

      <Typography
        color="text.secondary"
        sx={{ fontStyle: "italic", textAlign: "center" }}
        variant="body2"
      >
        The realm asks one question. The Tribunal answers with reasons.
      </Typography>
    </Stack>
  );
}
