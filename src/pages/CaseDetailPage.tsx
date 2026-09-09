// Milestone 14 (Saved Case / Case Detail high-fidelity redesign, Ivory
// & Iron): restyle only. The case fetch, run-list fetch (independent
// loading/error/data state, kept distinct from "zero Runs" -- Issue
// #27 Slice 8), the exact seven persisted Run status labels, the
// case-not-found/missing-id gating that prevents the Runs section from
// ever rendering for an unresolved Case, and the /runs/:runId route
// below are all unchanged in logic -- only the surrounding composition/
// styling changed, so opening a saved case reads as opening its
// physical case file from the Case Archive rather than two generic
// white cards. PublicDemoRetentionNotice is rendered completely
// unmodified. PageHeader.tsx itself is untouched (still shared,
// unmodified, by RunPage/SmartImportPage/DeliberationPage/
// JonSnowSettingsPage, all out of scope this pass) -- this page hand-
// rolls its own eyebrow/title/description block instead, matching the
// same gold editorial hierarchy already approved on Review/History.
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Paper,
  Stack,
  Typography
} from "@mui/material";
import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { PublicDemoRetentionNotice } from "../components/PublicDemoRetentionNotice";
import { ChevronRightIcon, DocumentIcon, ScaleIcon } from "../components/icons/LineIcons";
import { CaseApiError, getCase, type StoredCase } from "../services/caseApi";
import {
  RunApiError,
  listRunsForCase,
  type RunStatus,
  type RunSummary
} from "../services/runApi";

// Milestone 11 (Issue #27) -- the exact seven persisted Run statuses,
// each with a distinct, honest human-facing label. There is no
// persisted generic "RUNNING" state; FAILED and BLOCKED_BUDGET must
// never collapse into an in-progress label or into each other, and none
// of these labels is or implies a Tribunal verdict.
const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  DRAFT: "Draft",
  READY: "Ready",
  ADVOCATES_RUNNING: "Advocates running",
  JUDGES_RUNNING: "Judges deliberating",
  COMPLETED: "Completed",
  FAILED: "Failed",
  BLOCKED_BUDGET: "Budget blocked"
};

// Display-only status tone (a restrained left-accent/marker color, never
// the sole carrier of meaning -- the human-facing label above is always
// shown too). This is deliberately NOT a verdict palette: Completed's
// calm green means "the execution finished", never "the Tribunal found
// Not Guilty"; Failed/Budget blocked use the theme's own semantic
// error/warning colors, not a bespoke scale.
const RUN_STATUS_TONE: Record<RunStatus, string> = {
  DRAFT: "#B8AFA0",
  READY: "#B8AFA0",
  ADVOCATES_RUNNING: "#4A6670",
  JUDGES_RUNNING: "#4A6670",
  COMPLETED: "#3F6E4E",
  FAILED: "#A23B2E",
  BLOCKED_BUDGET: "#8C6423"
};

export function CaseDetailPage() {
  const { caseId } = useParams();
  const [storedCase, setStoredCase] = useState<StoredCase | null>(null);
  const [caseError, setCaseError] = useState("");
  const [isLoadingCase, setIsLoadingCase] = useState(true);

  // Milestone 11 -- a distinct loading/error/data triple for the Run
  // list, kept independent of the Case fetch above: a run-list network
  // or server failure is NOT equivalent to "zero Runs" and must never be
  // presented as the honest empty-runs state (Issue #27 Slice 8).
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [runsError, setRunsError] = useState("");
  const [isLoadingRuns, setIsLoadingRuns] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadCase() {
      if (!caseId) {
        setCaseError("Case id is missing.");
        setIsLoadingCase(false);
        return;
      }

      try {
        const result = await getCase(caseId);

        if (!isMounted) {
          return;
        }

        if (!result) {
          setCaseError("Saved case was not found.");
          return;
        }

        setStoredCase(result);
        setCaseError("");
      } catch (loadError) {
        if (isMounted) {
          setCaseError(formatCaseError(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingCase(false);
        }
      }
    }

    void loadCase();

    return () => {
      isMounted = false;
    };
  }, [caseId]);

  useEffect(() => {
    let isMounted = true;

    async function loadRuns() {
      if (!caseId) {
        setIsLoadingRuns(false);
        return;
      }

      try {
        const result = await listRunsForCase(caseId);

        if (!isMounted) {
          return;
        }

        setRuns(result);
        setRunsError("");
      } catch (loadError) {
        if (isMounted) {
          setRunsError(formatRunsError(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoadingRuns(false);
        }
      }
    }

    void loadRuns();

    return () => {
      isMounted = false;
    };
  }, [caseId]);

  return (
    <Stack spacing={4}>
      <Stack spacing={1}>
        <Typography
          color="#8C6423"
          sx={{ fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}
          variant="caption"
        >
          Saved Case
        </Typography>
        <Typography component="h1" variant="h3">
          {storedCase?.defendant ?? "Saved Case"}
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: "65ch" }}>
          A persisted case can be reopened for inspection, along with any Tribunal runs
          associated with it.
        </Typography>
      </Stack>

      <PublicDemoRetentionNotice />

      {isLoadingCase ? (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress aria-label="Loading saved case" size={24} sx={{ color: "#8C6423" }} />
          <Typography color="text.secondary">Loading saved case...</Typography>
        </Stack>
      ) : null}

      {caseError ? (
        <Alert severity="error">
          <Stack spacing={1}>
            <Typography>{caseError}</Typography>
            <Button
              component={RouterLink}
              sx={{
                borderRadius: "8px",
                "&.Mui-focusVisible": { outline: "2px solid #8C6423", outlineOffset: "2px" }
              }}
              to="/history"
              variant="outlined"
            >
              Back to Past Cases
            </Button>
          </Stack>
        </Alert>
      ) : null}

      {/* A Case that does not exist (caseError set, storedCase never set)
         must never fall through to the Runs section below -- this keeps
         "unknown Case" from ever looking like a legitimate zero-run
         Case, regardless of what the independent run-list fetch
         returned (Issue #27 Slice 8 / "Case ID error semantics"). */}
      {storedCase ? (
        <>
          {/* CASE DOSSIER -- visually the expanded version of the Case
              Archive card the user just opened: the same docket-gold
              top rule, icon-labeled heading, and boxed Question
              treatment approved on Review's own Case Docket panel. */}
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
                  Case Dossier
                </Typography>
              </Stack>

              <Stack spacing={0.25}>
                <Typography color="text.secondary" sx={{ fontWeight: 700, letterSpacing: "0.06em" }} variant="caption">
                  DEFENDANT
                </Typography>
                <Typography>{storedCase.defendant}</Typography>
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
                    maxHeight: 260,
                    overflowY: "auto",
                    p: 1.5,
                    whiteSpace: "pre-wrap"
                  }}
                >
                  <Typography variant="body2">{storedCase.act}</Typography>
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
                  <Typography sx={{ fontWeight: 600 }}>{storedCase.exactQuestion}</Typography>
                </Box>
              </Stack>

              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={{ xs: 0.25, sm: 3 }}
                sx={{ borderTop: "1px solid", borderColor: "divider", pt: 1.5 }}
              >
                <Typography color="text.secondary" variant="caption">
                  Created: {formatDate(storedCase.createdAt)}
                </Typography>
                <Typography color="text.secondary" sx={{ wordBreak: "break-word" }} variant="caption">
                  Source: {formatSourceType(storedCase.sourceType)}
                  {storedCase.sourceFilename ? ` (${storedCase.sourceFilename})` : ""}
                </Typography>
              </Stack>
            </Stack>
          </Paper>

          {/* TRIBUNAL RUNS -- a proceedings log, not a status dashboard.
              Every status label/loading/error/zero-run string below is
              byte-identical to the pre-redesign version. */}
          <Paper sx={{ borderRadius: "14px", p: { xs: 2, md: 3 } }}>
            <Stack spacing={2}>
              <Stack spacing={0.5}>
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
                    <ScaleIcon size={18} />
                  </Box>
                  <Typography component="h2" sx={{ fontWeight: 700 }} variant="subtitle1">
                    Tribunal Runs
                  </Typography>
                </Stack>
                <Typography color="text.secondary" variant="body2">
                  Each entry below is one persisted Tribunal execution associated with this case.
                </Typography>
              </Stack>

              {isLoadingRuns ? (
                <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                  <CircularProgress aria-label="Loading Tribunal runs" size={24} sx={{ color: "#8C6423" }} />
                  <Typography color="text.secondary">Loading Tribunal runs...</Typography>
                </Stack>
              ) : null}
              {!isLoadingRuns && runsError ? (
                <Alert severity="error">{runsError}</Alert>
              ) : null}
              {!isLoadingRuns && !runsError && runs && runs.length === 0 ? (
                <Box sx={{ border: "1px dashed", borderColor: "divider", borderRadius: "10px", p: 2 }}>
                  <Typography color="text.secondary">
                    No Tribunal run has been started for this case yet.
                  </Typography>
                </Box>
              ) : null}
              {!isLoadingRuns && !runsError && runs && runs.length > 0 ? (
                <Stack spacing={1.5}>
                  {runs.map((run) => (
                    <RunSummaryRow key={run.runId} run={run} />
                  ))}
                </Stack>
              ) : null}
            </Stack>
          </Paper>
        </>
      ) : null}
    </Stack>
  );
}

function RunSummaryRow({ run }: { run: RunSummary }) {
  const tone = RUN_STATUS_TONE[run.status];

  return (
    <Box
      sx={{
        alignItems: { sm: "center" },
        border: "1px solid",
        borderColor: "divider",
        borderLeft: "3px solid",
        borderLeftColor: tone,
        borderRadius: "10px",
        display: "flex",
        flexDirection: { xs: "column", sm: "row" },
        gap: 1.5,
        justifyContent: "space-between",
        p: 2
      }}
    >
      <Stack spacing={0.25}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box aria-hidden="true" sx={{ bgcolor: tone, borderRadius: "50%", flexShrink: 0, height: 8, width: 8 }} />
          {/* Status label only -- never a Tribunal verdict. The
             authoritative verdict, when one exists, is available
             exclusively behind checkResultIntegrity() on the full
             stored run (Issue #27 "Corrected Run Summary"). */}
          <Typography sx={{ fontWeight: 700 }}>{RUN_STATUS_LABEL[run.status]}</Typography>
        </Stack>
        <Typography color="text.secondary" variant="body2">
          {run.executionMode === "shared" ? "Shared model" : "Separate models"} — Created{" "}
          {formatDate(run.createdAt)}
        </Typography>
        {run.startedAt ? (
          <Typography color="text.secondary" variant="body2">
            Started {formatDate(run.startedAt)}
          </Typography>
        ) : null}
        {run.completedAt ? (
          <Typography color="text.secondary" variant="body2">
            Completed {formatDate(run.completedAt)}
          </Typography>
        ) : null}
      </Stack>
      <Button
        component={RouterLink}
        endIcon={<ChevronRightIcon size={16} />}
        sx={{
          alignSelf: { xs: "flex-start", sm: "center" },
          borderRadius: "8px",
          flexShrink: 0,
          "&.Mui-focusVisible": { outline: "2px solid #8C6423", outlineOffset: "2px" }
        }}
        to={`/runs/${run.runId}`}
        variant="text"
      >
        View run
      </Button>
    </Box>
  );
}

function formatCaseError(error: unknown) {
  if (error instanceof CaseApiError) {
    return error.errors.join(" ");
  }

  return "Saved case could not be loaded.";
}

function formatRunsError(error: unknown) {
  if (error instanceof RunApiError) {
    return error.errors.length
      ? error.errors.join(" ")
      : "Tribunal runs could not be loaded.";
  }

  return "Tribunal runs could not be loaded.";
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
