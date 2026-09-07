// Milestone 14 (Review Tribunal high-fidelity redesign, Ivory & Iron):
// restyle only. Every hook, dispatch, validation gate, Decimal-safe
// aggregation, save/convene handler, clientRequestId/idempotency
// behavior (inside useRunStart, untouched), and navigation below is
// byte-identical in logic to the prior version -- only the surrounding
// composition/presentation changed, to read as one coherent final
// docket rather than a stack of generic cards. EconomicsSummary and
// OpenRouterConnect are shared components used by other pages too and
// are rendered here completely unmodified, just repositioned.
import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  Typography
} from "@mui/material";
import Decimal from "decimal.js";
import { useCallback, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import {
  CURRENT_ADVOCATE_SIDE_DESCRIPTION,
  CURRENT_ADVOCATE_SIDE_HEADING
} from "../components/advocateSideCopy";
import { EconomicsSummary } from "../components/EconomicsSummary";
import {
  BarChartIcon,
  ChevronRightIcon,
  CounselIcon,
  DocumentIcon,
  ScaleIcon
} from "../components/icons/LineIcons";
import { OpenRouterConnect } from "../components/OpenRouterConnect";
import { SetupStepper } from "../components/SetupStepper";
import { hasUserOpenRouterKey } from "../services/openRouterCredential";
import { useEligibleModels } from "../features/case-setup/useEligibleModels";
import { useRoleEligibleModels } from "../features/case-setup/useRoleEligibleModels";
import {
  areAdvocatePersonalitiesValid,
  areJudgePersonalitiesValid,
  isChargeSheetValid,
  isMockSetupReady,
  isSavedCaseCurrent,
  type SetupState
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";
import { useRunStart } from "../features/tribunal-run/useRunStart";
import {
  advocateParticipants,
  judgeParticipants,
  type Participant
} from "../mocks/tribunalMockData";
import { CaseApiError, saveCase, type StoredCase } from "../services/caseApi";
import type { RunCaseRequest, RunParticipantRequest, StoredRun } from "../services/runApi";

// Display-only polish (never touches the shared, locked
// advocateSideCopy.ts constant also consumed by AdvocatesPage,
// ParticipantCard, and RunPage's historical caption): renders the
// enum-like "NOT_GUILTY"/"GUILTY" as "Not Guilty"/"Guilty" for this
// page's compact roster text, and joins the heading/description with a
// proper em dash instead of a double hyphen. The NOT_GUILTY replacement
// must run first since "GUILTY" is a substring of "NOT_GUILTY".
function describeAdvocateSideForDocket(side: "PRO" | "CON"): string {
  const description = CURRENT_ADVOCATE_SIDE_DESCRIPTION[side]
    .replace("NOT_GUILTY", "Not Guilty")
    .replace("GUILTY", "Guilty");

  return `${CURRENT_ADVOCATE_SIDE_HEADING[side]} — ${description}`;
}

// One compact roster row -- a denser, read-only summary of the same
// real fields ParticipantCard's editable presentation shows. Every
// line of text rendered here (Model:/Profile name:/Personality
// source:/Personality:) is byte-identical to the pre-redesign version;
// only the container/icon/spacing changed.
function RosterRow({
  participant,
  icon: Icon,
  accentColor,
  displayModelName,
  profileName,
  personalitySourceLabel,
  personality
}: {
  participant: Participant;
  icon: typeof CounselIcon;
  accentColor: string;
  displayModelName: string;
  profileName: string;
  personalitySourceLabel: string;
  personality: string;
}) {
  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderLeft: "3px solid",
        borderLeftColor: accentColor,
        borderRadius: "8px",
        p: 1.5
      }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Box sx={{ alignItems: "center", color: accentColor, display: "flex" }}>
          <Icon size={16} />
        </Box>
        <Typography sx={{ fontWeight: 800 }} variant="body2">
          {participant.label}
        </Typography>
        {profileName !== "Not provided" ? (
          <Typography color="text.secondary" variant="body2">
            · {profileName}
          </Typography>
        ) : null}
      </Stack>
      {participant.side ? (
        <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">
          {describeAdvocateSideForDocket(participant.side)}
        </Typography>
      ) : null}
      <Typography sx={{ display: "block", mt: 0.5 }} variant="body2">
        Model: {displayModelName}
      </Typography>
      <Typography color="text.secondary" sx={{ display: "block" }} variant="caption">
        Personality source: {personalitySourceLabel}
      </Typography>
      <Typography
        color="text.secondary"
        sx={{
          display: "-webkit-box",
          mt: 0.25,
          overflow: "hidden",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 3
        }}
        variant="body2"
      >
        {personality}
      </Typography>
    </Box>
  );
}

export function ReviewPage() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const [saveError, setSaveError] = useState("");
  const [savedCase, setSavedCase] = useState<StoredCase | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [conveneResult, setConveneResult] = useState<StoredRun | null>(null);
  // Milestone 12 (Issue #32 Sec 7): the clientRequestId/snapshot
  // idempotency rule, the convene() call, and submit/error state now
  // live in the shared useRunStart hook, reused unchanged by the Jon
  // Snow demo launcher -- this page keeps only what is genuinely its
  // own: charge-sheet/participant construction and its own on-success
  // behavior (recordSavedCase, navigation) below.
  const { isSubmitting: isConvening, error: conveneError, start: startRun } = useRunStart();
  // Milestone 8 (user-funded BYOK): Convene is disabled until an
  // OpenRouter credential is connected -- server-side enforcement
  // (OPENROUTER_NOT_CONNECTED) is independent and authoritative
  // regardless of this client-side gate.
  const [openRouterConnected, setOpenRouterConnected] = useState(() => hasUserOpenRouterKey());
  // Independent audit correction (Issue #17 blocker 1): the real
  // eligible catalog, not mock/tribunalMockData. Also passes the
  // auto-select callback -- a setup can reach Review directly (e.g.
  // after a Smart Import apply) without ExecutionModeControl (rendered
  // only on Advocates/Judges) ever having mounted, so Review must be
  // able to auto-select on its own too, not merely display whatever was
  // already chosen elsewhere.
  const handleAutoSelectSharedModel = useCallback(
    (modelId: string) => dispatch({ type: "setSharedModel", modelId }),
    [dispatch]
  );
  const {
    models: eligibleModels,
    loading: modelsLoading,
    error: modelsError
  } = useEligibleModels(state.sharedModelId, handleAutoSelectSharedModel);
  // M9 (Separate-Model Tribunal, Issue #20): Review can be reached
  // directly (e.g. after a Smart Import apply) without AdvocatesPage/
  // JudgesPage ever having mounted, so it fetches both role catalogs
  // itself too, exactly like it already does for the Shared catalog --
  // never relies on another page having already fetched them.
  const {
    models: advocateModels,
    loading: advocateModelsLoading,
    error: advocateModelsError
  } = useRoleEligibleModels("ADVOCATE");
  const {
    models: judgeModels,
    loading: judgeModelsLoading,
    error: judgeModelsError
  } = useRoleEligibleModels("JUDGE");
  const sharedModel = eligibleModels.find((model) => model.id === state.sharedModelId);
  const chargeSheetValid = isChargeSheetValid(state.chargeSheet);
  const advocatesValid = areAdvocatePersonalitiesValid(state);
  const judgesValid = areJudgePersonalitiesValid(state);
  const allParticipants = [...advocateParticipants, ...judgeParticipants];

  function roleModelsFor(participant: Participant) {
    return participant.kind === "advocate" ? advocateModels : judgeModels;
  }

  function resolvedSeparateModel(participant: Participant) {
    return roleModelsFor(participant).find(
      (model) => model.id === state.participants[participant.id].modelId
    );
  }

  // M9 pre-live audit correction (Issue #20): never render a stale/
  // no-longer-eligible/mock historical id as though it were a valid
  // selected model. Three explicit states, never a raw-id fallback:
  // empty -> "Not selected"; a current role-catalog member -> its real
  // name; a non-empty id that is NOT a current catalog member (stale,
  // removed, or a leftover mock id) -> an explicit "No longer eligible"
  // state. This never mutates/freezes/submits anything -- canConvene
  // (above) already independently requires every seat to be a current
  // catalog member, so a "No longer eligible" seat here is always
  // already reflected in a blocked Convene.
  function describeSeparateModelSelection(participant: Participant): string {
    const modelId = state.participants[participant.id].modelId;

    if (!modelId) {
      return "Not selected";
    }

    const roleLoading =
      participant.kind === "advocate" ? advocateModelsLoading : judgeModelsLoading;
    const roleError = participant.kind === "advocate" ? advocateModelsError : judgeModelsError;

    // While that seat's own role catalog is still loading (or failed to
    // load), an already-chosen id cannot yet be confirmed either way --
    // never claim "no longer eligible" merely because the catalog hasn't
    // arrived, that would misrepresent a genuinely still-valid selection.
    if (roleLoading || roleError) {
      return "Checking eligibility…";
    }

    const resolved = resolvedSeparateModel(participant);

    if (resolved) {
      return resolved.name;
    }

    return "No longer eligible — select a current eligible model";
  }

  const separateModelsLoading = advocateModelsLoading || judgeModelsLoading;
  const separateModelsError = advocateModelsError || judgeModelsError;
  // M9 correction (Issue #20 independent planning review, Correction 3):
  // mode-aware validity. SHARED is exactly the pre-M9 check, unchanged.
  // SEPARATE requires every one of the seven seats to hold a current
  // member of ITS OWN role catalog (advocates against the ADVOCATE
  // catalog, judges against the JUDGE catalog) -- never merely a
  // non-empty id, and never validated against the wrong role's catalog.
  const separateParticipantsValid = allParticipants.every((participant) =>
    roleModelsFor(participant).some(
      (model) => model.id === state.participants[participant.id].modelId
    )
  );
  // Independent audit correction (final micro-correction #3): validity
  // means real CATALOG MEMBERSHIP, not merely a non-empty id -- a stale
  // id left over from a prior catalog fetch (or one that simply never
  // resolves) must never be treated as a valid selection. Convene is
  // therefore also blocked while the catalog is loading, if it failed to
  // load, or if it loaded empty, not only when nothing is selected yet.
  const hasRealModelSelected =
    state.executionMode === "shared"
      ? !modelsLoading && !modelsError && eligibleModels.length > 0 && sharedModel !== undefined
      : !separateModelsLoading && !separateModelsError && separateParticipantsValid;
  // M5 persists only the canonical case (Defendant/Act/Exact Question plus
  // source metadata). Participant configuration is not persisted/frozen
  // until M6, so Save Case must not require seven valid participants.
  const canSaveCase = chargeSheetValid;
  // Independent audit correction (Issue #17 blocker 1): Convene must not
  // proceed without a real selected model -- isMockSetupReady itself
  // doesn't know about the live catalog, so this is checked here too.
  const canConvene = isMockSetupReady(state) && hasRealModelSelected;
  // M9: per-seat blocked reasons for Separate Mode, identifying WHICH
  // participant(s) still need a valid model rather than one generic
  // message -- reuses each participant's own catalog-membership check
  // above, never a second validation system.
  const separateSeatReasons =
    state.executionMode === "separate" && !separateModelsLoading && !separateModelsError
      ? allParticipants
          .filter(
            (participant) =>
              !roleModelsFor(participant).some(
                (model) => model.id === state.participants[participant.id].modelId
              )
          )
          .map(
            (participant) =>
              `${participant.label} requires a current eligible ${
                participant.kind === "advocate" ? "Advocate" : "Judge"
              } model.`
          )
      : [];
  const blockedReasons = [
    !chargeSheetValid ? "Charge Sheet fields must be complete and valid." : "",
    !advocatesValid ? "All four advocate personalities must be valid." : "",
    !judgesValid ? "All three judge personalities must be valid." : "",
    ...(state.executionMode === "shared"
      ? [!hasRealModelSelected ? "A real eligible Shared model must be selected." : ""]
      : separateModelsError
        ? [separateModelsError]
        : separateModelsLoading
          ? ["Loading eligible models..."]
          : separateSeatReasons)
  ].filter(Boolean);
  // M9: Decimal-safe sum of the seven participant-scoped conservative
  // discovery estimates -- never ad-hoc Number addition for the
  // authoritative displayed aggregate. Only computed once every seat
  // resolves to a real catalog member; the authoritative frozen-run
  // preflight (server-side) remains the real gate regardless.
  const separateAggregateEstimateUsd =
    state.executionMode === "separate" && separateParticipantsValid
      ? allParticipants.reduce((sum, participant) => {
          const resolved = resolvedSeparateModel(participant);

          return resolved ? sum.plus(new Decimal(resolved.conservativeParticipantEstimateUsd)) : sum;
        }, new Decimal(0))
      : null;

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

    const result = await startRun(caseRequest, state.executionMode, participants);

    if (!result) {
      // useRunStart already captured the formatted error in `conveneError`.
      return;
    }

    const { run, executionTriggered } = result;

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
  }

  function participantSummaryProps(participant: Participant) {
    const config = state.participants[participant.id];
    const displayModelName =
      state.executionMode === "shared"
        ? (sharedModel?.name ?? (state.sharedModelId || "Not selected yet"))
        : describeSeparateModelSelection(participant);

    return {
      participant,
      displayModelName,
      profileName: config.profileName || "Not provided",
      personalitySourceLabel:
        formatPersonalitySource(config.personalitySource) +
        (config.personalitySourceFilename ? ` (${config.personalitySourceFilename})` : ""),
      personality: config.personality || "Not entered yet"
    };
  }

  const proParticipants = advocateParticipants.filter((p) => p.side === "PRO");
  const conParticipants = advocateParticipants.filter((p) => p.side === "CON");

  return (
    <Stack spacing={4}>
      <SetupStepper />

      <Stack spacing={1}>
        <Typography
          color="#8C6423"
          sx={{ fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}
          variant="caption"
        >
          Final Review
        </Typography>
        <Typography component="h1" variant="h3">
          Review Tribunal
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: "70ch" }}>
          Review the complete case, seven-seat Tribunal, model configuration, economics, and
          connection state before freezing the configuration and convening the Tribunal.
        </Typography>
      </Stack>

      {state.importNotice ? <Alert severity="info">{state.importNotice}</Alert> : null}

      {/* CASE DOCKET -- read-only, matches the Charge Sheet's own
          premium panel language (gold top accent, icon-labeled
          heading, boxed decision-question treatment) so this reads as
          the same document reviewed one screen later, not a new
          surface. */}
      <Paper sx={{ borderRadius: "14px", overflow: "hidden", p: { xs: 2, md: 3 }, position: "relative" }}>
        <Box
          aria-hidden="true"
          sx={{
            background: "linear-gradient(90deg, #B8892B 0%, #E8BE73 50%, #B8892B 100%)",
            height: 4,
            left: 0,
            position: "absolute",
            right: 0,
            top: 0
          }}
        />
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
            <Box
              sx={{
                alignItems: "center",
                bgcolor: "rgba(184,137,43,0.12)",
                borderRadius: "50%",
                color: "#8C6423",
                display: "flex",
                height: 36,
                justifyContent: "center",
                width: 36
              }}
            >
              <DocumentIcon size={18} />
            </Box>
            <Typography component="h2" sx={{ fontWeight: 700 }} variant="subtitle1">
              Case Docket
            </Typography>
          </Stack>
          <Stack spacing={0.25}>
            <Typography color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.06em" }} variant="caption">
              DEFENDANT
            </Typography>
            <Typography>{state.chargeSheet.defendant || "Not entered yet"}</Typography>
          </Stack>
          <Stack spacing={0.25}>
            <Typography color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.06em" }} variant="caption">
              DISPUTED ACT
            </Typography>
            <Box
              sx={{
                border: "1px solid",
                borderColor: "divider",
                borderRadius: "10px",
                maxHeight: 220,
                overflowY: "auto",
                p: 1.5,
                whiteSpace: "pre-wrap"
              }}
            >
              <Typography variant="body2">{state.chargeSheet.act || "Not entered yet"}</Typography>
            </Box>
          </Stack>
          <Stack spacing={0.25}>
            <Typography color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.06em" }} variant="caption">
              QUESTION BEFORE THE TRIBUNAL
            </Typography>
            <Box
              sx={{
                bgcolor: "rgba(184,137,43,0.05)",
                border: "1px solid rgba(196,168,120,0.4)",
                borderRadius: "10px",
                p: { xs: 1.5, sm: 2 }
              }}
            >
              <Typography sx={{ fontWeight: 600 }}>
                {state.chargeSheet.exactQuestion || "Not entered yet"}
              </Typography>
            </Box>
          </Stack>
          <Typography color="text.secondary" variant="caption">
            Source: {formatSourceType(state.caseSource.type)}
            {state.caseSource.filename ? ` (${state.caseSource.filename})` : ""}
          </Typography>
        </Stack>
      </Paper>

      {/* TRIBUNAL CONFIGURATION -- execution mode summary (read-only;
          no radio controls here) followed by the real roster,
          organized into its true structure instead of seven identical
          boxes. */}
      <Stack spacing={2.5}>
        <Stack spacing={0.25}>
          <Typography
            sx={{ color: "#8C6423", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}
            variant="subtitle2"
          >
            Tribunal Configuration
          </Typography>
          <Typography>
            {state.executionMode === "shared"
              ? "Shared Model — one model, seven distinct roles and personalities."
              : "Separate Models — each participant uses its own selected eligible model."}
          </Typography>
          {state.executionMode === "shared" ? (
            <Typography sx={{ fontWeight: 700 }}>
              Shared model: {sharedModel?.name ?? (state.sharedModelId || "Not selected yet")}
            </Typography>
          ) : null}
        </Stack>

        <Stack spacing={1.5}>
          <Typography color="#8C6423" sx={{ fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }} variant="caption">
            Advocates
          </Typography>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
            <Stack spacing={1}>
              <Typography color="text.secondary" sx={{ fontWeight: 700 }} variant="caption">
                PRO — DEFENSE
              </Typography>
              <Stack spacing={1}>
                {proParticipants.map((participant) => (
                  <RosterRow
                    accentColor="#8C6423"
                    icon={CounselIcon}
                    key={participant.id}
                    {...participantSummaryProps(participant)}
                  />
                ))}
              </Stack>
            </Stack>
            <Stack spacing={1}>
              <Typography color="text.secondary" sx={{ fontWeight: 700 }} variant="caption">
                CON — OPPOSITION
              </Typography>
              <Stack spacing={1}>
                {conParticipants.map((participant) => (
                  <RosterRow
                    accentColor="#6B6355"
                    icon={CounselIcon}
                    key={participant.id}
                    {...participantSummaryProps(participant)}
                  />
                ))}
              </Stack>
            </Stack>
          </Box>
        </Stack>

        <Stack spacing={1.5}>
          <Typography color="#8C6423" sx={{ fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }} variant="caption">
            The Bench
          </Typography>
          <Box sx={{ display: "grid", gap: 2, gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" } }}>
            {judgeParticipants.map((participant) => (
              <RosterRow
                accentColor="#8C6423"
                icon={ScaleIcon}
                key={participant.id}
                {...participantSummaryProps(participant)}
              />
            ))}
          </Box>
        </Stack>
      </Stack>

      {/* ECONOMICS & PREFLIGHT -- preserves the exact same computed
          text/values; EconomicsSummary (a shared mock-fixture component
          reused by Run/Result/SmartImport too) is rendered completely
          unmodified below, just repositioned into this section. */}
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Box sx={{ alignItems: "center", color: "#8C6423", display: "flex" }}>
            <BarChartIcon size={20} />
          </Box>
          <Typography
            sx={{ color: "#8C6423", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}
            variant="subtitle2"
          >
            Economics &amp; Preflight
          </Typography>
        </Stack>
        <Paper sx={{ borderRadius: "12px", p: { xs: 2, md: 3 } }}>
          <Stack spacing={0.5}>
            <Typography>
              Expected logical calls: <strong>7</strong>
            </Typography>
            <Typography>Retry policy: max one retry per participant</Typography>
            <Typography>Hard policy: $5.00 maximum</Typography>
            {state.executionMode === "shared" ? (
              sharedModel ? (
                <>
                  <Typography color="success.main" sx={{ fontWeight: 800 }}>
                    {sharedModel.priceTier} tier
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {`Conservative full-Tribunal estimate for this route: $${sharedModel.conservativeFullTribunalEstimateUsd} (discovery estimate; the authoritative preflight runs again, using your connected credential, when you Convene).`}
                  </Typography>
                </>
              ) : (
                <Typography color="text.secondary" variant="body2">
                  Select a Shared model above to see its conservative estimate.
                </Typography>
              )
            ) : separateAggregateEstimateUsd ? (
              <Typography color="text.secondary" variant="body2">
                {`Conservative discovery estimate for this Separate-Mode configuration (sum of each of the seven participants' own estimate): $${separateAggregateEstimateUsd.toFixed()} (discovery estimate; the authoritative preflight runs again, using your connected credential, when you Convene. The $5.00 hard ceiling remains authoritative regardless of this estimate.)`}
              </Typography>
            ) : (
              <Typography color="text.secondary" variant="body2">
                Select an eligible model for all seven participants above to see the aggregate conservative estimate.
              </Typography>
            )}
          </Stack>
        </Paper>
        <EconomicsSummary headingOverride="Demo fixture economics" muted />
      </Stack>

      {/* OPENROUTER CONNECTION -- a readiness requirement, not a
          generic card. OpenRouterConnect itself (a shared component
          also used by SmartImport/Jon Snow Settings) is rendered
          completely unmodified below. */}
      <Paper sx={{ borderRadius: "12px", p: { xs: 2, md: 3 } }}>
        <Stack spacing={1.5}>
          <Typography
            sx={{ color: "#8C6423", fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }}
            variant="subtitle2"
          >
            OpenRouter Connection
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Runtime model inference is user-funded: any charges from convening the Tribunal go
            to your own connected OpenRouter account, never the developer's. Convene is disabled
            until you connect.
          </Typography>
          <OpenRouterConnect
            connected={openRouterConnected}
            onConnectedChange={setOpenRouterConnected}
            showHeading={false}
          />
        </Stack>
      </Paper>

      {!canConvene ? (
        <Alert severity="error">
          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }} variant="caption">
              Action Required
            </Typography>
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
      ) : (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              alignItems: "center",
              bgcolor: "success.main",
              borderRadius: "50%",
              color: "#FFFFFF",
              display: "flex",
              flexShrink: 0,
              fontSize: "0.7rem",
              fontWeight: 800,
              height: 18,
              justifyContent: "center",
              width: 18
            }}
          >
            ✓
          </Box>
          <Typography color="success.main" sx={{ fontWeight: 800, letterSpacing: "0.06em", textTransform: "uppercase" }} variant="caption">
            Ready to Convene
          </Typography>
        </Stack>
      )}
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

      {/* FINAL ACTION ZONE */}
      <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 3 }}>
        <Typography color="text.secondary" sx={{ mb: 1.5 }} variant="body2">
          Configuration will be frozen when the Tribunal is convened.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Button component={RouterLink} sx={{ borderRadius: "8px" }} to="/new/judges" variant="outlined">
            Back
          </Button>
          <Button
            disabled={!canSaveCase || isSaving}
            onClick={handleSaveCase}
            sx={{ borderRadius: "8px" }}
            variant="outlined"
          >
            {isSaving ? "Saving..." : "Save Case"}
          </Button>
          <Button
            disabled={!canConvene || !openRouterConnected || isConvening || Boolean(conveneResult)}
            endIcon={<ChevronRightIcon size={18} />}
            onClick={handleConvene}
            sx={{ borderRadius: "10px" }}
            variant="contained"
          >
            {isConvening
              ? "Convening..."
              : conveneResult
                ? "Configuration frozen"
                : "Convene Tribunal"}
          </Button>
        </Stack>
      </Box>
    </Stack>
  );
}

// Milestone 6: Shared mode always sends the one shared model for every
// participant, regardless of each participant's individually-stored
// modelId (which the UI does not surface while in Shared mode) --
// matches SPEC.md CONFIG-004 and is re-validated authoritatively
// server-side either way.
function buildParticipantsRequest(state: SetupState): RunParticipantRequest[] {
  const allParticipants = [...advocateParticipants, ...judgeParticipants];

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
