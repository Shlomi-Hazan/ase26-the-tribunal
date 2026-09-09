// Milestone 14 (Past Cases high-fidelity redesign, Ivory & Iron):
// restyle only. The data fetch (listCases, once on mount), loading/
// error states, formatCaseError, formatSourceType, formatDate, and the
// /cases/:id route below are all unchanged in logic -- only the
// surrounding composition/styling changed, to present stored cases as
// a curated case archive rather than a generic SaaS card grid.
// PublicDemoRetentionNotice and EmptyHistoryState are shared components
// (also used by CaseDetailPage/RunPage, and by this page respectively)
// and are rendered here completely unmodified.
import {
  Alert,
  Box,
  Card,
  CircularProgress,
  Stack,
  Typography
} from "@mui/material";
import { useEffect, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import { PublicDemoRetentionNotice } from "../components/PublicDemoRetentionNotice";
import { ChevronRightIcon, DocumentIcon } from "../components/icons/LineIcons";
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
      <Stack spacing={1}>
        <Typography
          color="#8C6423"
          sx={{ fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}
          variant="caption"
        >
          Case Archive
        </Typography>
        <Typography component="h1" variant="h3">
          Past Cases
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: "65ch" }}>
          Stored cases can be reopened for inspection. Open a case to review its Charge
          Sheet and any Tribunal runs associated with it.
        </Typography>
      </Stack>

      <PublicDemoRetentionNotice />

      {isLoading ? (
        <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
          <CircularProgress aria-label="Loading past cases" size={24} sx={{ color: "#8C6423" }} />
          <Typography color="text.secondary">Loading stored cases...</Typography>
        </Stack>
      ) : null}

      {error ? <Alert severity="error">{error}</Alert> : null}

      {!isLoading && !error && cases.length > 0 ? (
        <Box
          sx={{
            display: "grid",
            gap: 2.5,
            gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" }
          }}
        >
          {cases.map((item) => (
            <CaseFileCard item={item} key={item.id} />
          ))}
        </Box>
      ) : null}

      {!isLoading && !error && cases.length === 0 ? (
        <EmptyHistoryState />
      ) : null}
    </Stack>
  );
}

// One compact "case file" card -- the whole card is the navigable link
// to /cases/:id (a single real anchor, no nested interactive elements),
// styled with a thin docket-gold top rule and a small document mark so
// it reads as a record pulled from an archive rather than a plain
// dashboard tile. Every real field rendered (defendant/exactQuestion/
// createdAt/sourceType/sourceFilename) is unchanged in source; only the
// presentation changed.
function CaseFileCard({ item }: { item: StoredCase }) {
  return (
    <Card
      component={RouterLink}
      sx={{
        color: "inherit",
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        textDecoration: "none",
        transition: "border-color 150ms ease, transform 150ms ease, box-shadow 150ms ease",
        "&:hover": {
          borderColor: "#B8892B",
          boxShadow: "0 4px 16px rgba(36,33,28,.09)",
          transform: "translateY(-2px)"
        },
        "&:focus-visible": {
          outline: "2px solid #8C6423",
          outlineOffset: "2px"
        }
      }}
      to={`/cases/${item.id}`}
    >
      <Box
        aria-hidden="true"
        sx={{
          background: "linear-gradient(90deg, #B8892B 0%, #E8BE73 50%, #B8892B 100%)",
          height: 3,
          left: 0,
          position: "absolute",
          right: 0,
          top: 0
        }}
      />
      <Stack spacing={1.5} sx={{ flexGrow: 1, p: { xs: 2, md: 2.5 } }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              alignItems: "center",
              bgcolor: "rgba(184,137,43,0.12)",
              borderRadius: "50%",
              color: "#8C6423",
              display: "flex",
              height: 26,
              justifyContent: "center",
              width: 26
            }}
          >
            <DocumentIcon size={14} />
          </Box>
          <Typography
            color="#8C6423"
            sx={{ fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase" }}
            variant="caption"
          >
            Stored Case
          </Typography>
        </Stack>

        <Typography component="h2" sx={{ fontFamily: '"Fraunces", Georgia, serif' }} variant="h5">
          {item.defendant}
        </Typography>

        <Typography sx={{ fontWeight: 500 }} variant="body1">
          {item.exactQuestion}
        </Typography>

        <Stack
          spacing={0.5}
          sx={{ borderTop: "1px solid", borderColor: "divider", mt: "auto", pt: 1.5 }}
        >
          <Typography color="text.secondary" variant="caption">
            Created: {formatDate(item.createdAt)}
          </Typography>
          <Typography color="text.secondary" sx={{ wordBreak: "break-word" }} variant="caption">
            Source: {formatSourceType(item.sourceType)}
            {item.sourceFilename ? ` (${item.sourceFilename})` : ""}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: "#8C6423", mt: 0.5 }}>
            <Typography sx={{ fontWeight: 700 }} variant="caption">
              Open saved case
            </Typography>
            <ChevronRightIcon size={14} />
          </Stack>
        </Stack>
      </Stack>
    </Card>
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
