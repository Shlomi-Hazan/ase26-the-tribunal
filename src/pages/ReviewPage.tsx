import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography
} from "@mui/material";
import { useRef, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { EconomicsSummary } from "../components/EconomicsSummary";
import { OpenRouterConnect } from "../components/OpenRouterConnect";
import { PageHeader } from "../components/PageHeader";
import { SetupStepper } from "../components/SetupStepper";
import { hasUserOpenRouterKey } from "../services/openRouterCredential";
import {
  areAdvocatePersonalitiesValid,
  areJudgePersonalitiesValid,
  isChargeSheetValid,
  isMockSetupReady,
  isSavedCaseCurrent,
  type SetupState
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";
import { allParticipants, mockModels } from "../mocks/tribunalMockData";
import { CaseApiError, saveCase, type StoredCase } from "../services/caseApi";
import {
  convene,
  RunApiError,
  type RunCaseRequest,
  type RunParticipantRequest,
  type StoredRun
} from "../services/runApi";

export function ReviewPage() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const [saveError, setSaveError] = useState("");
  const [savedCase, setSavedCase] = useState<StoredCase | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [conveneError, setConveneError] = useState("");
  const [conveneResult, setConveneResult] = useState<StoredRun | null>(null);
  const [isConvening, setIsConvening] = useState(false);
  // Milestone 8 (user-funded BYOK): Convene is disabled until an
  // OpenRouter credential is connected -- server-side enforcement
  // (OPENROUTER_NOT_CONNECTED) is independent and authoritative
  // regardless of this client-side gate.
  const [openRouterConnected, setOpenRouterConnected] = useState(() => hasUserOpenRouterKey());
  // Milestone 6 client idempotency key lifecycle: stable across a retry of
  // the same semantic submission, refreshed only when the underlying
  // request actually changed (docs/adr/0002-participant-configuration-
  // freeze.md Decision 8; SPEC.md CONFIG-008/008A). Refs, not state --
  // this is bookkeeping, not something that should trigger a re-render.
  const clientRequestIdRef = useRef<string | null>(null);
  const requestSnapshotRef = useRef<string | null>(null);
  const sharedModel = mockModels.find((model) => model.id === state.sharedModelId);
  const chargeSheetValid = isChargeSheetValid(state.chargeSheet);
  const advocatesValid = areAdvocatePersonalitiesValid(state);
  const judgesValid = areJudgePersonalitiesValid(state);
  // M5 persists only the canonical case (Defendant/Act/Exact Question plus
  // source metadata). Participant configuration is not persisted/frozen
  // until M6, so Save Case must not require seven valid participants.
  const canSaveCase = chargeSheetValid;
  const canConvene = isMockSetupReady(state);
  const blockedReasons = [
    !chargeSheetValid ? "Charge Sheet fields must be complete and valid." : "",
    !advocatesValid ? "All four advocate personalities must be valid." : "",
    !judgesValid ? "All three judge personalities must be valid." : ""
  ].filter(Boolean);

  async function handleSaveCase() {
    if (!canSaveCase) {
      return;
    }

    setSaveError("");
    setSavedCase(null);
    setIsSaving(true);

    try {
      const storedCase = await saveCase({
        ...state.chargeSheet,
        sourceType: state.caseSource.type,
        sourceFilename: state.caseSource.filename
      });

      setSavedCase(storedCase);
      dispatch({ type: "recordSavedCase", id: storedCase.id });
    } catch (error) {
      setSaveError(formatCaseError(error));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleConvene() {
    // Once accepted, retain the accepted run state instead of starting a
    // fresh request -- Convene is not re-armed after success. Milestone 8:
    // also requires a connected OpenRouter credential -- the server's own
    // OPENROUTER_NOT_CONNECTED gate is authoritative regardless, this is
    // purely a UX short-circuit.
    if (!canConvene || !openRouterConnected || isConvening || conveneResult) {
      return;
    }

    const caseRequest = buildCaseRequest(state);
    const participants = buildParticipantsRequest(state);
    const snapshot = JSON.stringify({
      case: caseRequest,
      executionMode: state.executionMode,
      participants
    });

    // Reuse the existing client_request_id only while the semantic
    // submission is unchanged from the last attempt; a materially edited
    // resubmission gets a fresh key rather than reusing one that would
    // now describe different data under the old identity.
    if (!clientRequestIdRef.current || requestSnapshotRef.current !== snapshot) {
      clientRequestIdRef.current = crypto.randomUUID();
      requestSnapshotRef.current = snapshot;
    }

    setConveneError("");
    setIsConvening(true);

    try {
      const { run, executionTriggered } = await convene({
        clientRequestId: clientRequestIdRef.current,
        case: caseRequest,
        executionMode: state.executionMode,
        participants
      });

      if (caseRequest.kind === "new") {
        dispatch({ type: "recordSavedCase", id: run.caseId });
      }

      setConveneResult(run);

      // Milestone 8: navigate to the real run page only when execution
      // was actually triggered by this request (ARCHITECTURE.md Sec 12's
      // /runs/:runId route). A BLOCKED_BUDGET run also has something
      // useful to show there; any other non-trigger outcome (e.g. an
      // unreachable worker invocation) stays on Review with the frozen
      // run id visible instead of navigating to an unchanging blank page.
      if (executionTriggered || run.status === "BLOCKED_BUDGET") {
        navigate(`/runs/${run.id}`);
      }
    } catch (error) {
      setConveneError(formatRunError(error));
    } finally {
      setIsConvening(false);
    }
  }

  return (
    <Stack spacing={4}>
      <SetupStepper />
      <PageHeader
        eyebrow="Review"
        title="Review Tribunal"
        description="Review the case and seven-participant configuration before freezing it."
      />
      {state.importNotice ? <Alert severity="info">{state.importNotice}</Alert> : null}
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography component="h2" variant="h5">
              Case summary
            </Typography>
            <Typography>
              <strong>Defendant:</strong>{" "}
              {state.chargeSheet.defendant || "Not entered yet"}
            </Typography>
            <Typography>
              <strong>Act:</strong> {state.chargeSheet.act || "Not entered yet"}
            </Typography>
            <Typography>
              <strong>Exact Question:</strong>{" "}
              {state.chargeSheet.exactQuestion || "Not entered yet"}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Source: {formatSourceType(state.caseSource.type)}
              {state.caseSource.filename ? ` (${state.caseSource.filename})` : ""}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography component="h2" variant="h5">
              Execution mode
            </Typography>
            <Typography>
              {state.executionMode === "shared"
                ? "Shared Model — one model, seven distinct roles and personalities."
                : "Separate Models — each participant can use a different eligible model."}
            </Typography>
            <Divider />
            <Typography component="h3" variant="h6">
              Seven-participant configuration
            </Typography>
            {state.executionMode === "shared" ? (
              <Typography>
                Shared mock model: {sharedModel?.displayName ?? state.sharedModelId}
              </Typography>
            ) : null}
            <Box
              sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }
              }}
            >
              {allParticipants.map((participant) => {
                const model = mockModels.find(
                  (item) => item.id === state.participants[participant.id].modelId
                );

                return (
                  <Box
                    key={participant.id}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      p: 2
                    }}
                  >
                    <Typography sx={{ fontWeight: 800 }}>
                      {participant.label}
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      {participant.side ? `${participant.side} advocate` : "Judge"}
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      Model:{" "}
                      {state.executionMode === "shared"
                        ? sharedModel?.displayName
                        : model?.displayName}
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      Profile name:{" "}
                      {state.participants[participant.id].profileName ||
                        "Not provided"}
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      Personality source:{" "}
                      {formatPersonalitySource(
                        state.participants[participant.id].personalitySource
                      )}
                      {state.participants[participant.id].personalitySourceFilename
                        ? ` (${
                            state.participants[participant.id]
                              .personalitySourceFilename
                          })`
                        : ""}
                    </Typography>
                    <Typography variant="body2">
                      Personality:{" "}
                      {state.participants[participant.id].personality ||
                        "Not entered yet"}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography component="h2" variant="h5">
            Mock economics preflight
          </Typography>
          <Typography sx={{ mt: 1 }}>
            Expected logical calls: <strong>7</strong>
          </Typography>
          <Typography>Retry policy: max one retry per participant</Typography>
          <Typography>Hard policy: $5.00 maximum</Typography>
          <Typography color="success.main" sx={{ fontWeight: 800 }}>
            Eligible in this mock scenario
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Mock conservative estimate: $0.42. This is fixture data, not live
            OpenRouter pricing or billing.
          </Typography>
        </CardContent>
      </Card>
      <EconomicsSummary />
      <Card>
        <CardContent>
          <Typography component="h2" sx={{ mb: 1 }} variant="h5">
            Connect OpenRouter
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }} variant="body2">
            Runtime model inference is user-funded: any charges from
            convening the Tribunal go to your own connected OpenRouter
            account, never the developer's. Convene is disabled until you
            connect.
          </Typography>
          <OpenRouterConnect connected={openRouterConnected} onConnectedChange={setOpenRouterConnected} />
        </CardContent>
      </Card>
      {!canConvene ? (
        <Alert severity="error">
          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 800 }}>
              Tribunal configuration cannot be frozen yet.
            </Typography>
            {blockedReasons.map((reason) => (
              <Typography key={reason} variant="body2">
                {reason}
              </Typography>
            ))}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button component={RouterLink} to="/new/charge-sheet" variant="outlined">
                Edit Charge Sheet
              </Button>
              <Button component={RouterLink} to="/new/advocates" variant="outlined">
                Edit Advocates
              </Button>
              <Button component={RouterLink} to="/new/judges" variant="outlined">
                Edit Judges
              </Button>
            </Stack>
          </Stack>
        </Alert>
      ) : null}
      <Alert severity="warning">
        This V1 course demo stores submitted cases in shared demo history. Do
        not submit sensitive, private, confidential, or identifying information.
      </Alert>
      {savedCase ? (
        <Alert severity="success">
          Case saved to Past Cases.{" "}
          <Button
            component={RouterLink}
            size="small"
            to={`/cases/${savedCase.id}`}
            variant="outlined"
          >
            Open saved case
          </Button>
        </Alert>
      ) : null}
      {saveError ? <Alert severity="error">{saveError}</Alert> : null}
      {conveneResult ? (
        <Alert severity="success">
          Tribunal configuration frozen.
          {" "}
          <Typography color="text.secondary" component="span" variant="body2">
            Run ID: {conveneResult.id}
          </Typography>
        </Alert>
      ) : null}
      {conveneError ? <Alert severity="error">{conveneError}</Alert> : null}
      {canConvene && !openRouterConnected ? (
        <Typography color="text.secondary" variant="body2">
          Connect OpenRouter above before convening the Tribunal.
        </Typography>
      ) : null}
      <Stack direction="row" spacing={2}>
        <Button component={RouterLink} to="/new/judges" variant="outlined">
          Back
        </Button>
        <Button
          disabled={!canSaveCase || isSaving}
          onClick={handleSaveCase}
          variant="outlined"
        >
          {isSaving ? "Saving..." : "Save Case"}
        </Button>
        <Button
          disabled={!canConvene || !openRouterConnected || isConvening || Boolean(conveneResult)}
          onClick={handleConvene}
          variant="contained"
        >
          {isConvening
            ? "Convening..."
            : conveneResult
              ? "Configuration frozen"
              : "Convene Tribunal"}
        </Button>
      </Stack>
    </Stack>
  );
}

// Milestone 6: Shared mode always sends the one shared model for every
// participant, regardless of each participant's individually-stored
// modelId (which the UI does not surface while in Shared mode) --
// matches SPEC.md CONFIG-004 and is re-validated authoritatively
// server-side either way.
function buildParticipantsRequest(state: SetupState): RunParticipantRequest[] {
  return allParticipants.map((participant) => {
    const config = state.participants[participant.id];
    const modelId =
      state.executionMode === "shared" ? state.sharedModelId : config.modelId;
    const profileName = config.profileName.trim() ? config.profileName : undefined;

    if (config.personalitySource === "manual") {
      return {
        participantId: participant.id,
        profileName,
        personality: config.personality,
        personalitySource: "manual",
        modelId
      };
    }

    return {
      participantId: participant.id,
      profileName,
      personality: config.personality,
      personalitySource: config.personalitySource,
      personalitySourceFilename: config.personalitySourceFilename,
      modelId
    };
  });
}

// Milestone 6: reuse the last successfully saved case only while it is
// still current (docs/adr/0002-participant-configuration-freeze.md
// Decision 8); otherwise Convene saves a fresh case as part of the same
// request rather than requiring a separate manual Save Case first.
function buildCaseRequest(state: SetupState): RunCaseRequest {
  if (state.savedCase && isSavedCaseCurrent(state)) {
    return { kind: "existing", caseId: state.savedCase.id };
  }

  return {
    kind: "new",
    case: {
      ...state.chargeSheet,
      sourceType: state.caseSource.type,
      sourceFilename: state.caseSource.filename
    }
  };
}

function formatCaseError(error: unknown) {
  if (error instanceof CaseApiError) {
    return error.errors.join(" ");
  }

  return "Case could not be saved.";
}

function formatRunError(error: unknown) {
  if (error instanceof RunApiError) {
    if (error.status === 409) {
      return "This configuration could not be frozen because a prior request with the same submission id already produced a different result. Please try again.";
    }

    return error.errors.join(" ") || "Tribunal configuration could not be frozen.";
  }

  return "Tribunal configuration could not be frozen.";
}

function formatSourceType(sourceType: string) {
  switch (sourceType) {
    case "CHARGE_SHEET_FILE":
      return "Charge Sheet file";
    case "TRIBUNAL_PACKAGE_FILE":
      return "Full Tribunal Package";
    default:
      return "Manual";
  }
}

function formatPersonalitySource(source: string) {
  switch (source) {
    case "individual_file":
      return "Individual file";
    case "tribunal_package":
      return "Full Tribunal Package";
    default:
      return "Manual";
  }
}
