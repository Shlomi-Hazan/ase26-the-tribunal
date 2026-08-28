// Milestone 7A -- Smart Import (ADR 0004 Decisions 12, 18). Upload/Paste
// -> read-only preflight -> explicit Confirm & Extract -> Extraction
// Review (staged preview, human-editable) -> explicit Apply -> existing
// setup Review. Never auto-Convenes; Cancel leaves the active draft
// untouched.

import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { type ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { SetupStepper } from "../components/SetupStepper";
import { useSetup } from "../features/case-setup/useSetup";
import {
  packageSeatToParticipantId,
  packageSeats,
  tribunalSetupDraftSchema,
  type PackageSeat,
  type TribunalSetupDraft
} from "../schemas/tribunalSetup";
import type { PackageExtractionResult } from "../schemas/packageExtraction";
import {
  dossierFileToPayload,
  ExtractionApiError,
  requestExtractionPreflight,
  retryExtraction,
  submitExtraction,
  type DossierSourcePayload,
  type ExtractionAttemptSummary,
  type ExtractionResponse,
  type PreflightResponse
} from "../services/extractionApi";
import { RETRYABLE_ERROR_CODES, SMART_IMPORT_PROVENANCE_MARKER } from "./smartImportConstants";

// Corrected this pass (independent pre-live audit, Section 8): an
// explicit client-side state machine distinguishing "no logical
// extraction started" / "an action's HTTP outcome is ambiguous" /
// "attempt #1 explicitly failed, retryable" / "server confirmed
// CLAIMED/in-progress" / "terminal, non-retryable" / "success/needs-
// review" -- the prior revision inferred which endpoint to call purely
// from whether `extractionId` was set, which meant a lost HTTP response
// after a successful attempt #1 (validated_result already persisted
// server-side) incorrectly called the RETRY endpoint instead of
// idempotently replaying the INITIAL endpoint with the same id/source,
// defeating the lost-response recovery contract (ADR Decision 15).
type Phase =
  | "idle"
  | "preflighting"
  | "quoted"
  | "ambiguous"
  | "in_progress"
  | "retryable"
  | "terminal_failure"
  | "review"
  | "applying";

// The one endpoint a "recover" action replays -- always the SAME action
// that was last actually sent, never inferred from `extractionId`
// merely being set.
type LastAction = "initial" | "retry" | null;

// Which in-flight request (if any) is currently awaited. Kept SEPARATE
// from `Phase` -- an earlier revision folded this into a "submitting"
// Phase value, but the button whose click started the request needed to
// stay visible (with its own spinner) for the exact same phase
// (`"quoted"`/`"retryable"`/`"ambiguous"`/`"in_progress"`) the request
// was launched from; collapsing to one shared "submitting" phase made
// TypeScript's control-flow narrowing correctly flag every `phase ===
// "submitting"` spinner check as unreachable dead code from within an
// already-phase-narrowed branch (e.g. `showConfirmAction`'s block, where
// `phase` is statically known to be `"quoted"`) -- and, not merely a
// type-checker artifact, it was a REAL bug: the button whose action was
// in flight vanished entirely instead of showing a spinner.
type PendingAction = "confirm" | "retry" | "recover" | null;

const SEAT_LABELS: Record<PackageSeat, string> = {
  PRO_1: "Advocate PRO I",
  PRO_2: "Advocate PRO II",
  CON_1: "Advocate CON I",
  CON_2: "Advocate CON II",
  JUDGE_1: "Judge I",
  JUDGE_2: "Judge II",
  JUDGE_3: "Judge III"
};

type EditableDraft = {
  defendant: string;
  act: string;
  exactQuestion: string;
  participants: Record<PackageSeat, { profileName: string; personality: string }>;
};

function toEditableDraft(result: PackageExtractionResult): EditableDraft {
  return {
    defendant: result.chargeSheet.defendant ?? "",
    act: result.chargeSheet.act ?? "",
    exactQuestion: result.chargeSheet.exactQuestion ?? "",
    participants: Object.fromEntries(
      packageSeats.map((seat) => [
        seat,
        {
          profileName: result.participants[seat].profileName ?? "",
          personality: result.participants[seat].personality ?? ""
        }
      ])
    ) as EditableDraft["participants"]
  };
}

function toTribunalSetupDraft(editable: EditableDraft): TribunalSetupDraft | null {
  const draft = {
    chargeSheet: {
      defendant: editable.defendant,
      act: editable.act,
      exactQuestion: editable.exactQuestion
    },
    participants: Object.fromEntries(
      packageSeats.map((seat) => [
        packageSeatToParticipantId[seat],
        {
          profileName: editable.participants[seat].profileName || undefined,
          personality: editable.participants[seat].personality,
          personalitySource: "tribunal_package" as const,
          personalitySourceFilename: SMART_IMPORT_PROVENANCE_MARKER
        }
      ])
    ),
    importSource: {
      type: "TRIBUNAL_PACKAGE_FILE" as const,
      filename: SMART_IMPORT_PROVENANCE_MARKER
    }
  };

  const result = tribunalSetupDraftSchema.safeParse(draft);

  return result.success ? result.data : null;
}

function fieldWarnings(
  result: PackageExtractionResult | null,
  path: string
): PackageExtractionResult["warnings"] {
  return (result?.warnings ?? []).filter((warning) => warning.field === path);
}

// Corrected this pass (independent pre-live audit, Section 15): warnings
// whose `field` is null (e.g. UNSUPPORTED_CONTENT_IGNORED) were
// previously invisible -- the Review UI only ever rendered warnings via
// fieldWarnings, which by definition excludes them. Every model-reported
// warning must be visible SOMEWHERE in Extraction Review.
function documentLevelWarnings(
  result: PackageExtractionResult | null
): PackageExtractionResult["warnings"] {
  return (result?.warnings ?? []).filter((warning) => warning.field === null);
}

export function SmartImportPage() {
  const { dispatch } = useSetup();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [lastAction, setLastAction] = useState<LastAction>(null);
  const [source, setSource] = useState<DossierSourcePayload | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<PreflightResponse | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [rawResult, setRawResult] = useState<PackageExtractionResult | null>(null);
  const [editable, setEditable] = useState<EditableDraft | null>(null);
  const [lastAttempt, setLastAttempt] = useState<ExtractionAttemptSummary | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "preflighting" || phase === "applying" || pendingAction !== null;

  async function runPreflight(nextSource: DossierSourcePayload) {
    setError("");
    setSource(nextSource);
    setPhase("preflighting");

    try {
      const result = await requestExtractionPreflight(nextSource);

      setQuote(result);
      setPhase("quoted");
    } catch (caught) {
      setError(formatError(caught));
      setPhase("idle");
    }
  }

  async function handlePasteSubmit() {
    if (!pastedText.trim()) {
      setError("Enter dossier text before checking eligibility.");
      return;
    }

    await runPreflight({ kind: "text", text: pastedText });
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    await runPreflight(await dossierFileToPayload(file));
  }

  // `action` is passed explicitly rather than read back from the
  // `lastAction` state: the caller's own `setLastAction(...)` call just
  // above is asynchronous, so by the time this synchronous continuation
  // runs, the `lastAction` closed-over value here would still be
  // whatever it was at the START of the render that created this
  // callback -- a real stale-closure bug caught during Section 8's own
  // regression testing (smartImport.test.tsx's "offers Retry" case
  // failed against this exact bug before the fix).
  function handleResponse(action: LastAction, response: ExtractionResponse) {
    if (response.status === "blocked") {
      setLastAttempt(response.attempt ?? null);
      setError(response.message);
      // Only an attempt #1 explicit terminal failure with a retryable
      // code offers Retry -- never merely because extractionId exists,
      // and never for a non-retryable code (Decision 16).
      setPhase(
        action === "initial" && RETRYABLE_ERROR_CODES.has(response.errorCode)
          ? "retryable"
          : "terminal_failure"
      );
      return;
    }

    if (response.status === "in_progress") {
      setLastAttempt(response.attempt ?? null);
      setError("");
      setPhase("in_progress");
      return;
    }

    if (!response.draft) {
      setError("Extraction succeeded but returned no draft.");
      setPhase("terminal_failure");
      return;
    }

    setRawResult(response.draft);
    setEditable(toEditableDraft(response.draft));
    setLastAttempt(response.attempt ?? null);
    setError("");
    setPhase("review");
  }

  async function handleConfirmExtract() {
    if (!source) {
      return;
    }

    const id = crypto.randomUUID();

    setExtractionId(id);
    setLastAction("initial");
    setError("");
    setPendingAction("confirm");

    try {
      const response = await submitExtraction(id, source);

      handleResponse("initial", response);
    } catch (caught) {
      // The HTTP outcome is genuinely unknown (e.g. a dropped
      // connection) -- the server may have already succeeded and
      // persisted validated_result. "ambiguous" offers Recover, which
      // replays this SAME initial request idempotently -- it must never
      // fall through to the retry endpoint.
      setError(formatError(caught));
      setPhase("ambiguous");
    } finally {
      setPendingAction(null);
    }
  }

  async function handleRetry() {
    if (!source || !extractionId) {
      return;
    }

    setLastAction("retry");
    setError("");
    setPendingAction("retry");

    try {
      const response = await retryExtraction(extractionId, source);

      handleResponse("retry", response);
    } catch (caught) {
      setError(formatError(caught));
      setPhase("ambiguous");
    } finally {
      setPendingAction(null);
    }
  }

  // Replays whichever action (initial or retry) was last actually sent
  // -- the one and only recovery path for both an ambiguous HTTP outcome
  // and a confirmed in-progress (CLAIMED) status. Never advances to a
  // new attempt number by itself.
  async function handleRecover() {
    if (!source || !extractionId || !lastAction) {
      return;
    }

    const action = lastAction;

    setError("");
    setPendingAction("recover");

    try {
      const response =
        action === "initial"
          ? await submitExtraction(extractionId, source)
          : await retryExtraction(extractionId, source);

      handleResponse(action, response);
    } catch (caught) {
      setError(formatError(caught));
      setPhase("ambiguous");
    } finally {
      setPendingAction(null);
    }
  }

  function handleCancel() {
    // The active draft was never touched -- nothing to revert.
    navigate("/new/charge-sheet");
  }

  function handleApply() {
    if (!editable) {
      return;
    }

    const draft = toTribunalSetupDraft(editable);

    if (!draft) {
      setError("Complete every required field before applying the extracted draft.");
      return;
    }

    setPhase("applying");
    dispatch({ type: "applyTribunalPackageImport", draft });
    navigate("/new/review");
  }

  function updateField(field: "defendant" | "act" | "exactQuestion", value: string) {
    setEditable((current) => (current ? { ...current, [field]: value } : current));
  }

  function updateParticipantField(
    seat: PackageSeat,
    field: "profileName" | "personality",
    value: string
  ) {
    setEditable((current) =>
      current
        ? {
            ...current,
            participants: {
              ...current.participants,
              [seat]: { ...current.participants[seat], [field]: value }
            }
          }
        : current
    );
  }

  const showRecoverAction = phase === "ambiguous" || phase === "in_progress";
  const showRetryAction = phase === "retryable";
  const showConfirmAction = phase === "quoted";

  return (
    <Stack spacing={4}>
      <SetupStepper />
      <PageHeader
        eyebrow="New Case"
        title="Smart Import"
        description="Upload or paste a free-form case dossier -- a setup-time model call extracts the Charge Sheet and all seven participants for your review. This never convenes the Tribunal by itself."
      />

      {phase !== "review" ? (
        <Alert severity="info">
          The raw dossier is not retained. The validated, structured extraction result may
          be retained for recovery and audit -- even before you Apply or Convene. This V1
          demo has no accounts and no private per-user ownership guarantee. Do not submit
          sensitive, private, confidential, or personally identifying material.
        </Alert>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}

      {phase === "idle" || phase === "preflighting" ? (
        <Paper sx={{ p: { xs: 2, md: 4 } }}>
          <Stack spacing={3}>
            <TextField
              disabled={busy}
              fullWidth
              label="Paste dossier text"
              minRows={6}
              multiline
              onChange={(event) => setPastedText(event.target.value)}
              value={pastedText}
            />
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <Button disabled={busy} onClick={handlePasteSubmit} variant="outlined">
                {phase === "preflighting" ? <CircularProgress size={20} /> : "Check Eligibility & Cost"}
              </Button>
              <input
                accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf"
                aria-label="Smart Import dossier file"
                hidden
                onChange={handleFileChange}
                ref={fileInputRef}
                type="file"
              />
              <Button
                disabled={busy}
                onClick={() => fileInputRef.current?.click()}
                variant="outlined"
              >
                Upload .txt / .md / .pdf
              </Button>
            </Stack>
            <Box>
              <Button onClick={() => navigate("/new/charge-sheet")} variant="text">
                Back to manual entry
              </Button>
            </Box>
          </Stack>
        </Paper>
      ) : null}

      {phase !== "idle" && phase !== "preflighting" && phase !== "review" && quote ? (
        <Paper sx={{ p: { xs: 2, md: 4 } }}>
          <Stack spacing={2}>
            <Typography variant="h6">Extraction Quote</Typography>
            {quote.eligible ? (
              <Stack spacing={0.5}>
                <Typography>
                  Estimated maximum cost:{" "}
                  <strong>${quote.logicalConservativeMaxCostUsd}</strong> of a $
                  {quote.hardCeilingUsd} ceiling for this extraction (both permitted attempts
                  combined).
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  Configured model: {quote.configuredModelId}
                  {quote.canonicalModelId && quote.canonicalModelId !== quote.configuredModelId
                    ? ` (resolved: ${quote.canonicalModelId})`
                    : ""}
                  {quote.providerEndpointTag ? ` — endpoint ${quote.providerEndpointTag}` : ""}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  Per-attempt conservative maximum: ${quote.perAttemptConservativeMaxCostUsd}
                  {quote.pricingObservedAt
                    ? ` — pricing observed ${new Date(quote.pricingObservedAt).toLocaleString()}`
                    : ""}
                </Typography>
              </Stack>
            ) : (
              <Typography color="error">
                This extraction is not currently eligible ({quote.blockedReasonCodes.join(", ")}).
              </Typography>
            )}
            {lastAttempt ? (
              <Stack sx={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 1 }}>
                <Chip label={`Attempt ${lastAttempt.attemptNumber}: ${lastAttempt.status}`} size="small" />
                <Chip
                  label={
                    lastAttempt.actualCostUsd !== null
                      ? `Actual cost: $${lastAttempt.actualCostUsd}`
                      : `Conservative maximum: $${lastAttempt.conservativeMaxCostUsd} (actual not yet known)`
                  }
                  size="small"
                  variant="outlined"
                />
              </Stack>
            ) : null}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              {showConfirmAction ? (
                <Button disabled={busy || !quote.eligible} onClick={handleConfirmExtract} variant="contained">
                  {pendingAction === "confirm" ? <CircularProgress size={20} /> : "Confirm & Extract"}
                </Button>
              ) : null}
              {showRetryAction ? (
                <Button disabled={busy} onClick={handleRetry} variant="contained">
                  {pendingAction === "retry" ? <CircularProgress size={20} /> : "Retry"}
                </Button>
              ) : null}
              {showRecoverAction ? (
                <Button disabled={busy} onClick={handleRecover} variant="contained">
                  {pendingAction === "recover" ? (
                    <CircularProgress size={20} />
                  ) : phase === "in_progress" ? (
                    "Check Status"
                  ) : (
                    "Recover"
                  )}
                </Button>
              ) : null}
              <Button disabled={busy} onClick={handleCancel} variant="text">
                Cancel
              </Button>
            </Stack>
            {phase === "in_progress" ? (
              <Typography color="text.secondary" variant="body2">
                This extraction is still in progress on the server. Checking status replays
                the same request -- it never starts a new attempt.
              </Typography>
            ) : null}
            {phase === "ambiguous" ? (
              <Typography color="text.secondary" variant="body2">
                The connection was lost before a response arrived. Recovering safely
                replays the exact same request -- if it already succeeded, no new attempt
                or charge occurs.
              </Typography>
            ) : null}
          </Stack>
        </Paper>
      ) : null}

      {phase === "review" && editable ? (
        <Paper sx={{ p: { xs: 2, md: 4 } }}>
          <Stack spacing={3}>
            <Typography variant="h6">Extraction Review</Typography>
            <Typography color="text.secondary" variant="body2">
              Highlighted fields were unresolved or ambiguous -- edit them before applying.
            </Typography>

            {lastAttempt ? (
              <Stack sx={{ display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 1 }}>
                <Chip label={`Attempt ${lastAttempt.attemptNumber}: ${lastAttempt.status}`} size="small" />
                <Chip
                  label={
                    lastAttempt.actualCostUsd !== null
                      ? `Actual cost: $${lastAttempt.actualCostUsd}`
                      : `Conservative maximum: $${lastAttempt.conservativeMaxCostUsd}`
                  }
                  size="small"
                  variant="outlined"
                />
              </Stack>
            ) : null}

            {documentLevelWarnings(rawResult).length > 0 ? (
              <Alert severity="warning">
                <Typography variant="body2">
                  Additional dossier content was not used for any field:
                </Typography>
                <ul>
                  {documentLevelWarnings(rawResult).map((warning, index) => (
                    <li key={index}>{warning.code}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}

            <TextField
              error={fieldWarnings(rawResult, "chargeSheet.defendant").length > 0}
              fullWidth
              helperText={fieldWarnings(rawResult, "chargeSheet.defendant")[0]?.code}
              label="Defendant"
              onChange={(event) => updateField("defendant", event.target.value)}
              value={editable.defendant}
            />
            <TextField
              error={fieldWarnings(rawResult, "chargeSheet.act").length > 0}
              fullWidth
              helperText={fieldWarnings(rawResult, "chargeSheet.act")[0]?.code}
              label="Act"
              minRows={3}
              multiline
              onChange={(event) => updateField("act", event.target.value)}
              value={editable.act}
            />
            <TextField
              error={fieldWarnings(rawResult, "chargeSheet.exactQuestion").length > 0}
              fullWidth
              helperText={fieldWarnings(rawResult, "chargeSheet.exactQuestion")[0]?.code}
              label="Exact Question"
              minRows={2}
              multiline
              onChange={(event) => updateField("exactQuestion", event.target.value)}
              value={editable.exactQuestion}
            />

            {packageSeats.map((seat) => (
              <Stack key={seat} spacing={1}>
                <Typography variant="subtitle2">{SEAT_LABELS[seat]}</Typography>
                <TextField
                  error={fieldWarnings(rawResult, `participants.${seat}.profileName`).length > 0}
                  fullWidth
                  label="Profile name (optional)"
                  onChange={(event) => updateParticipantField(seat, "profileName", event.target.value)}
                  size="small"
                  value={editable.participants[seat].profileName}
                />
                <TextField
                  error={fieldWarnings(rawResult, `participants.${seat}.personality`).length > 0}
                  fullWidth
                  helperText={fieldWarnings(rawResult, `participants.${seat}.personality`)[0]?.code}
                  label="Personality"
                  minRows={2}
                  multiline
                  onChange={(event) => updateParticipantField(seat, "personality", event.target.value)}
                  size="small"
                  value={editable.participants[seat].personality}
                />
              </Stack>
            ))}

            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <Button disabled={busy} onClick={handleApply} variant="contained">
                Apply extracted draft
              </Button>
              <Button disabled={busy} onClick={handleCancel} variant="text">
                Cancel
              </Button>
            </Stack>
          </Stack>
        </Paper>
      ) : null}
    </Stack>
  );
}

function formatError(error: unknown): string {
  if (error instanceof ExtractionApiError) {
    return error.message;
  }

  return "Smart Import failed.";
}
