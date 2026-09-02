import {
  Alert,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography
} from "@mui/material";
import { useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { PublicDemoRetentionNotice } from "../components/PublicDemoRetentionNotice";
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
      <PageHeader
        eyebrow="Saved Case"
        title={storedCase?.defendant ?? "Saved Case"}
        description="A persisted case can be reopened for inspection, along with any Tribunal runs associated with it."
      />
      <PublicDemoRetentionNotice />
      {isLoadingCase ? (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress aria-label="Loading saved case" size={24} />
          <Typography>Loading saved case...</Typography>
        </Stack>
      ) : null}
      {caseError ? (
        <Alert severity="error">
          <Stack spacing={1}>
            <Typography>{caseError}</Typography>
            <Button component={RouterLink} to="/history" variant="outlined">
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
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography component="h2" variant="h5">
                  Charge Sheet
                </Typography>
                <Typography>
                  <strong>Defendant:</strong> {storedCase.defendant}
                </Typography>
                <Typography>
                  <strong>Act:</strong> {storedCase.act}
                </Typography>
                <Typography>
                  <strong>Exact Question:</strong> {storedCase.exactQuestion}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  Source: {formatSourceType(storedCase.sourceType)}
                  {storedCase.sourceFilename
                    ? ` (${storedCase.sourceFilename})`
                    : ""}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  Created: {formatDate(storedCase.createdAt)}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Stack spacing={2}>
                <Typography component="h2" variant="h5">
                  Tribunal Runs
                </Typography>
                {isLoadingRuns ? (
                  <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
                    <CircularProgress aria-label="Loading Tribunal runs" size={24} />
                    <Typography>Loading Tribunal runs...</Typography>
                  </Stack>
                ) : null}
                {!isLoadingRuns && runsError ? (
                  <Alert severity="error">{runsError}</Alert>
                ) : null}
                {!isLoadingRuns && !runsError && runs && runs.length === 0 ? (
                  <Typography color="text.secondary">
                    No Tribunal run has been started for this case yet.
                  </Typography>
                ) : null}
                {!isLoadingRuns && !runsError && runs && runs.length > 0 ? (
                  <Stack spacing={1.5}>
                    {runs.map((run) => (
                      <RunSummaryRow key={run.runId} run={run} />
                    ))}
                  </Stack>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        </>
      ) : null}
    </Stack>
  );
}

function RunSummaryRow({ run }: { run: RunSummary }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={1.5}
          sx={{ alignItems: { sm: "center" }, justifyContent: "space-between" }}
        >
          <Stack spacing={0.25}>
            {/* Status label only -- never a Tribunal verdict. The
               authoritative verdict, when one exists, is available
               exclusively behind checkResultIntegrity() on the full
               stored run (Issue #27 "Corrected Run Summary"). */}
            <Typography sx={{ fontWeight: 700 }}>
              {RUN_STATUS_LABEL[run.status]}
            </Typography>
            <Typography color="text.secondary" variant="body2">
              {run.executionMode === "shared" ? "Shared model" : "Separate models"} --
              Created {formatDate(run.createdAt)}
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
          <Button component={RouterLink} to={`/runs/${run.runId}`} variant="outlined">
            View run
          </Button>
        </Stack>
      </CardContent>
    </Card>
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
