import {
  Box,
  Button,
  Card,
  CardContent,
  Alert,
  CircularProgress,
  Stack,
  Typography
} from "@mui/material";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { EmptyHistoryState } from "../features/history/EmptyHistoryState";
import {
  CaseApiError,
  listCases,
  type StoredCase
} from "../services/caseApi";

export function HistoryPage() {
  const [cases, setCases] = useState<StoredCase[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadCases() {
      try {
        const storedCases = await listCases();

        if (isMounted) {
          setCases(storedCases);
          setError("");
        }
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

    void loadCases();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <Stack spacing={4}>
      <PageHeader
        eyebrow="Past Cases"
        title="Past Cases"
        description="Stored case drafts can be reopened for inspection. No Tribunal run or model output is persisted in this milestone."
      />
      {isLoading ? (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress aria-label="Loading past cases" size={24} />
          <Typography>Loading stored cases...</Typography>
        </Stack>
      ) : null}
      {error ? <Alert severity="error">{error}</Alert> : null}
      {!isLoading && !error && cases.length > 0 ? (
        <Box
          sx={{
            display: "grid",
            gap: 2,
            gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }
          }}
        >
          {cases.map((item) => (
            <Card key={item.id}>
              <CardContent>
                <Stack spacing={1.5}>
                  <Typography component="h2" variant="h6">
                    {item.defendant}
                  </Typography>
                  <Typography color="text.secondary">
                    {item.exactQuestion}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    Created: {formatDate(item.createdAt)}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    Source: {formatSourceType(item.sourceType)}
                    {item.sourceFilename ? ` (${item.sourceFilename})` : ""}
                  </Typography>
                  <Typography sx={{ fontWeight: 800 }}>No verdict yet</Typography>
                  <Button
                    component={RouterLink}
                    to={`/cases/${item.id}`}
                    variant="outlined"
                  >
                    Open saved case
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Box>
      ) : null}
      {!isLoading && !error && cases.length === 0 ? (
        <EmptyHistoryState />
      ) : null}
    </Stack>
  );
}

function formatCaseError(error: unknown) {
  if (error instanceof CaseApiError) {
    return error.errors.join(" ");
  }

  return "Past cases could not be loaded.";
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
