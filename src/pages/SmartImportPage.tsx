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

type Phase = "idle" | "preflighting" | "quoted" | "extracting" | "review" | "applying";

const SEAT_LABELS: Record<PackageSeat, string> = {
  PRO_1: "Advocate PRO I",
  PRO_2: "Advocate PRO II",
  CON_1: "Advocate CON I",
  CON_2: "Advocate CON II",
  JUDGE_1: "Judge I",
  JUDGE_2: "Judge II",
  JUDGE_3: "Judge III"
};

const RETRYABLE_ERROR_CODES = new Set(["PROVIDER_UNAVAILABLE", "TIMEOUT", "INVALID_STRUCTURED_OUTPUT"]);

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

function toTribunalSetupDraft(
  editable: EditableDraft,
  sourceFilename: string | null
): TribunalSetupDraft | null {
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
          personalitySourceFilename: sourceFilename ?? "smart-import"
        }
      ])
    ),
    importSource: {
      type: "TRIBUNAL_PACKAGE_FILE" as const,
      filename: sourceFilename ?? "smart-import"
    }
  };

  const result = tribunalSetupDraftSchema.safeParse(draft);

  return result.success ? result.data : null;
}

function warningsFor(
  result: PackageExtractionResult | null,
  path: string
): PackageExtractionResult["warnings"] {
  return (result?.warnings ?? []).filter((warning) => warning.field === path);
}

export function SmartImportPage() {
  const { dispatch } = useSetup();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState<DossierSourcePayload | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<PreflightResponse | null>(null);
  const [extractionId, setExtractionId] = useState<string | null>(null);
  const [rawResult, setRawResult] = useState<PackageExtractionResult | null>(null);
  const [editable, setEditable] = useState<EditableDraft | null>(null);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [lastAttempt, setLastAttempt] = useState<ExtractionAttemptSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const busy = phase === "preflighting" || phase === "extracting" || phase === "applying";

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

  function handleResponse(response: ExtractionResponse) {
    if (response.status === "blocked") {
      setLastErrorCode(response.errorCode);
      setLastAttempt(response.attempt ?? null);
      setError(response.message);
      setPhase("quoted");
      return;
    }

    if (response.status === "in_progress") {
      setError("This extraction is still in progress. Please try again shortly.");
      setPhase("quoted");
      return;
    }

    if (!response.draft) {
      setError("Extraction succeeded but returned no draft.");
      setPhase("quoted");
      return;
    }

    setRawResult(response.draft);
    setEditable(toEditableDraft(response.draft));
    setLastAttempt(response.attempt ?? null);
    setLastErrorCode(null);
    setPhase("review");
  }

  async function handleConfirmExtract() {
    if (!source) {
      return;
    }

    const id = crypto.randomUUID();

    setExtractionId(id);
    setError("");
    setPhase("extracting");

    try {
      const response = await submitExtraction(id, source);

      handleResponse(response);
    } catch (caught) {
      setError(formatError(caught));
      setPhase("quoted");
    }
  }

  async function handleRetry() {
    if (!source || !extractionId) {
      return;
    }

    setError("");
    setPhase("extracting");

    try {
      const response = await retryExtraction(extractionId, source);

      handleResponse(response);
    } catch (caught) {
      setError(formatError(caught));
      setPhase("quoted");
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

    const sourceFilename = source?.kind === "file" ? source.filename : null;
    const draft = toTribunalSetupDraft(editable, sourceFilename);

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

      {phase === "quoted" || phase === "extracting" ? (
        <Paper sx={{ p: { xs: 2, md: 4 } }}>
          <Stack spacing={2}>
            <Typography variant="h6">Extraction Quote</Typography>
            {quote?.eligible ? (
              <Typography>
                Estimated maximum cost: <strong>${quote.conservativeMaxCostUsd}</strong> of a{" "}
                ${quote.hardCeilingUsd} ceiling for this extraction.
              </Typography>
            ) : (
              <Typography color="error">
                This extraction is not currently eligible ({quote?.blockedReasonCodes.join(", ")}).
              </Typography>
            )}
            {lastAttempt ? (
              <Chip
                label={`Attempt ${lastAttempt.attemptNumber}: ${lastAttempt.status}`}
                size="small"
                sx={{ alignSelf: "flex-start" }}
              />
            ) : null}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <Button
                disabled={busy || !quote?.eligible}
                onClick={extractionId ? handleRetry : handleConfirmExtract}
                variant="contained"
              >
                {phase === "extracting" ? (
                  <CircularProgress size={20} />
                ) : extractionId && lastErrorCode && RETRYABLE_ERROR_CODES.has(lastErrorCode) ? (
                  "Retry"
                ) : (
                  "Confirm & Extract"
                )}
              </Button>
              <Button disabled={busy} onClick={handleCancel} variant="text">
                Cancel
              </Button>
            </Stack>
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

            <TextField
              error={warningsFor(rawResult, "chargeSheet.defendant").length > 0}
              fullWidth
              helperText={warningsFor(rawResult, "chargeSheet.defendant")[0]?.code}
              label="Defendant"
              onChange={(event) => updateField("defendant", event.target.value)}
              value={editable.defendant}
            />
            <TextField
              error={warningsFor(rawResult, "chargeSheet.act").length > 0}
              fullWidth
              helperText={warningsFor(rawResult, "chargeSheet.act")[0]?.code}
              label="Act"
              minRows={3}
              multiline
              onChange={(event) => updateField("act", event.target.value)}
              value={editable.act}
            />
            <TextField
              error={warningsFor(rawResult, "chargeSheet.exactQuestion").length > 0}
              fullWidth
              helperText={warningsFor(rawResult, "chargeSheet.exactQuestion")[0]?.code}
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
                  error={warningsFor(rawResult, `participants.${seat}.profileName`).length > 0}
                  fullWidth
                  label="Profile name (optional)"
                  onChange={(event) => updateParticipantField(seat, "profileName", event.target.value)}
                  size="small"
                  value={editable.participants[seat].profileName}
                />
                <TextField
                  error={warningsFor(rawResult, `participants.${seat}.personality`).length > 0}
                  fullWidth
                  helperText={warningsFor(rawResult, `participants.${seat}.personality`)[0]?.code}
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
