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
import { CaseApiError, getCase, type StoredCase } from "../services/caseApi";

export function CaseDetailPage() {
  const { caseId } = useParams();
  const [storedCase, setStoredCase] = useState<StoredCase | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadCase() {
      if (!caseId) {
        setError("Case id is missing.");
        setIsLoading(false);
        return;
      }

      try {
        const result = await getCase(caseId);

        if (!isMounted) {
          return;
        }

        if (!result) {
          setError("Saved case was not found.");
          return;
        }

        setStoredCase(result);
        setError("");
      } catch (loadError) {
        if (isMounted) {
          setError(formatCaseError(loadError));
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadCase();

    return () => {
      isMounted = false;
    };
  }, [caseId]);

  return (
    <Stack spacing={4}>
      <PageHeader
        eyebrow="Saved Case"
        title={storedCase?.defendant ?? "Saved Case"}
        description="A persisted case can be reopened for inspection. No advocate speeches, judge verdicts, or model economics exist until later milestones."
      />
      {isLoading ? (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress aria-label="Loading saved case" size={24} />
          <Typography>Loading saved case...</Typography>
        </Stack>
      ) : null}
      {error ? (
        <Alert severity="error">
          <Stack spacing={1}>
            <Typography>{error}</Typography>
            <Button component={RouterLink} to="/history" variant="outlined">
              Back to Past Cases
            </Button>
          </Stack>
        </Alert>
      ) : null}
      {storedCase ? (
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
              <Alert severity="info">
                This is stored case data only. Tribunal execution, model calls,
                verdicts, protocols, and economics are later-milestone work.
              </Alert>
            </Stack>
          </CardContent>
        </Card>
      ) : null}
    </Stack>
  );
}

function formatCaseError(error: unknown) {
  if (error instanceof CaseApiError) {
    return error.errors.join(" ");
  }

  return "Saved case could not be loaded.";
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
