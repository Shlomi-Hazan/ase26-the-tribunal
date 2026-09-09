// Milestone 14 (Charge Sheet high-fidelity redesign, Ivory & Iron):
// restyle only. Every field, its limits, validation, helper/error text,
// import behavior, and navigation below is byte-identical in logic to
// the prior version -- only the surrounding presentation changed, to
// bring this screen into the same premium visual language the Home
// page was approved with.
import {
  Alert,
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { type ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SetupStepper } from "../components/SetupStepper";
import {
  ChevronRightIcon,
  DocumentIcon,
  GavelIcon,
  ScaleIcon,
  UploadIcon
} from "../components/icons/LineIcons";
import {
  chargeSheetLimits,
  SETUP_STEP_INDEX,
  validateChargeSheet
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";
import {
  ImportApiError,
  importChargeSheetFile,
  importTribunalPackageFile
} from "../services/importApi";

type ChargeField = keyof typeof chargeSheetLimits;

// Milestone 14: the three fields are given distinct visual roles
// (compact identity / substantial narrative / separated decision
// question) per the approved direction -- their name, label, helper
// text, limits, and multiline/minRows behavior are unchanged.
const fields: Array<{
  name: ChargeField;
  label: string;
  kicker: string;
  helper: string;
  multiline?: boolean;
  minRows?: number;
}> = [
  {
    name: "defendant",
    label: "Defendant",
    kicker: "IDENTITY",
    helper: "Who or what is the case about?"
  },
  {
    name: "act",
    label: "Act",
    kicker: "NARRATIVE",
    helper: "Describe the disputed act or situation.",
    multiline: true,
    minRows: 5
  },
  {
    name: "exactQuestion",
    label: "Exact Question",
    kicker: "DECISION QUESTION",
    helper: "Write the binary question the judges should answer.",
    multiline: true,
    minRows: 3
  }
];

// Local-only field styling (not a theme override -- this page alone
// gets the warmer parchment-tinted input treatment described in the
// approved direction; every other screen's TextFields are untouched).
const fieldSx = {
  "& .MuiOutlinedInput-root": {
    backgroundColor: "rgba(184,137,43,0.035)",
    borderRadius: "9px",
    "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
      borderColor: "#8C6423",
      borderWidth: "2px"
    }
  }
};

export function ChargeSheetPage() {
  const { state, dispatch } = useSetup();
  const navigate = useNavigate();
  const [attempted, setAttempted] = useState(false);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState<"charge" | "package" | "">("");
  const chargeSheetInputRef = useRef<HTMLInputElement>(null);
  const tribunalPackageInputRef = useRef<HTMLInputElement>(null);
  const fieldRefs = {
    defendant: useRef<HTMLInputElement>(null),
    act: useRef<HTMLInputElement>(null),
    exactQuestion: useRef<HTMLInputElement>(null)
  };
  const errors = validateChargeSheet(state.chargeSheet);
  const hasErrors = Object.values(errors).some(Boolean);

  function handleContinue() {
    setAttempted(true);

    if (hasErrors) {
      const firstInvalid = fields.find((field) => errors[field.name]);
      fieldRefs[firstInvalid?.name ?? "defendant"].current?.focus();
      return;
    }

    dispatch({
      type: "advanceFurthestStep",
      index: SETUP_STEP_INDEX.ADVOCATES
    });
    navigate("/new/advocates");
  }

  async function handleChargeSheetImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setImportError("");
    setImporting("charge");

    try {
      const result = await importChargeSheetFile(file);

      dispatch({
        type: "applyChargeSheetImport",
        chargeSheet: result.chargeSheet,
        filename: result.filename
      });
      setAttempted(false);
    } catch (error) {
      setImportError(formatImportError(error));
    } finally {
      setImporting("");
    }
  }

  async function handleTribunalPackageImport(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setImportError("");
    setImporting("package");

    try {
      const result = await importTribunalPackageFile(file);

      dispatch({
        type: "applyTribunalPackageImport",
        draft: result.draft
      });
      setAttempted(false);
      navigate("/new/review");
    } catch (error) {
      setImportError(formatImportError(error));
    } finally {
      setImporting("");
    }
  }

  return (
    <Stack spacing={4}>
      <SetupStepper />

      <Stack spacing={1}>
        <Typography
          color="#8C6423"
          sx={{ fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase" }}
          variant="caption"
        >
          New Case
        </Typography>
        <Typography component="h1" variant="h3">
          Charge Sheet
        </Typography>
        <Typography color="text.secondary" sx={{ maxWidth: "60ch" }}>
          Define the case in three deterministic fields before configuring the Tribunal.
        </Typography>
      </Stack>

      <Paper
        component="form"
        noValidate
        sx={{
          borderRadius: "14px",
          overflow: "hidden",
          p: { xs: 2.5, md: 4.5 },
          position: "relative"
        }}
      >
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
        {/* Quiet decorative watermark -- the same original scale motif
            used across the product, extremely low-opacity, purely
            atmospheric. Never competes with content. */}
        <Box
          aria-hidden="true"
          sx={{
            color: "#8C6423",
            display: { xs: "none", md: "block" },
            opacity: 0.05,
            pointerEvents: "none",
            position: "absolute",
            right: 24,
            top: 24
          }}
        >
          <ScaleIcon size={96} />
        </Box>

        <Stack spacing={4} sx={{ position: "relative" }}>
          <Stack spacing={3}>
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
                Case Details
              </Typography>
            </Stack>

            <Stack divider={<Divider sx={{ borderColor: "rgba(196,168,120,0.32)" }} />} spacing={3}>
              {fields.map((field, index) => {
                const value = state.chargeSheet[field.name];
                const showError = attempted && Boolean(errors[field.name]);
                const isDecisionQuestion = field.name === "exactQuestion";

                const input = (
                  <TextField
                    error={showError}
                    fullWidth
                    helperText={
                      showError
                        ? errors[field.name]
                        : `${field.helper} ${value.length}/${chargeSheetLimits[field.name]} characters.`
                    }
                    inputRef={fieldRefs[field.name]}
                    key={field.name}
                    label={field.label}
                    minRows={field.minRows}
                    multiline={field.multiline}
                    onChange={(event) =>
                      dispatch({
                        type: "setChargeField",
                        field: field.name,
                        value: event.target.value
                      })
                    }
                    required
                    slotProps={{
                      formHelperText: {
                        sx: { fontSize: "0.72rem", ml: 0 }
                      },
                      htmlInput: {
                        maxLength: chargeSheetLimits[field.name]
                      }
                    }}
                    sx={index === 0 ? { ...fieldSx, maxWidth: { md: 440 } } : fieldSx}
                    value={value}
                  />
                );

                return (
                  <Stack key={field.name} spacing={1}>
                    <Typography
                      color="text.secondary"
                      sx={{ fontWeight: 700, letterSpacing: "0.08em" }}
                      variant="caption"
                    >
                      {field.kicker}
                    </Typography>
                    {isDecisionQuestion ? (
                      <Box
                        sx={{
                          bgcolor: "rgba(184,137,43,0.05)",
                          border: "1px solid rgba(196,168,120,0.4)",
                          borderRadius: "10px",
                          p: { xs: 1.5, sm: 2 }
                        }}
                      >
                        <Typography color="text.secondary" sx={{ fontStyle: "italic", mb: 1.25 }} variant="body2">
                          This is the binary question the judges will answer.
                        </Typography>
                        {input}
                      </Box>
                    ) : (
                      input
                    )}
                  </Stack>
                );
              })}
            </Stack>
          </Stack>

          <Stack spacing={1.5}>
            <Typography sx={{ fontWeight: 700 }} variant="subtitle2">
              Import an existing case / dossier
            </Typography>
            <Typography color="text.secondary" variant="body2">
              Already have a case prepared? Bring it in instead of typing it out.
            </Typography>
            {state.importNotice ? (
              <Alert onClose={() => dispatch({ type: "clearImportNotice" })} severity="success">
                {state.importNotice}
              </Alert>
            ) : null}
            {importError ? <Alert severity="error">{importError}</Alert> : null}
            <Alert severity="info" sx={{ fontSize: "0.8rem", py: 0.5 }}>
              Import Charge Sheet fills only the case fields. Import Full Tribunal
              Package fills the case and all seven participant personalities for
              review; neither import convenes a Tribunal.
            </Alert>
            <Box
              sx={{
                border: "1px dashed",
                borderColor: "divider",
                borderRadius: "10px",
                p: { xs: 1.5, sm: 2 }
              }}
            >
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <input
                  aria-label="Charge Sheet import file"
                  accept=".txt,.md,text/plain,text/markdown"
                  hidden
                  onChange={handleChargeSheetImport}
                  ref={chargeSheetInputRef}
                  type="file"
                />
                <Button
                  disabled={Boolean(importing)}
                  onClick={() => chargeSheetInputRef.current?.click()}
                  startIcon={<UploadIcon size={16} />}
                  sx={{ borderRadius: "8px" }}
                  variant="outlined"
                >
                  {importing === "charge" ? "Importing..." : "Import Charge Sheet"}
                </Button>
                <input
                  aria-label="Full Tribunal Package import file"
                  accept=".txt,.md,text/plain,text/markdown"
                  hidden
                  onChange={handleTribunalPackageImport}
                  ref={tribunalPackageInputRef}
                  type="file"
                />
                <Button
                  disabled={Boolean(importing)}
                  onClick={() => tribunalPackageInputRef.current?.click()}
                  startIcon={<GavelIcon size={16} />}
                  sx={{ borderRadius: "8px" }}
                  variant="outlined"
                >
                  {importing === "package"
                    ? "Importing..."
                    : "Import Full Tribunal Package"}
                </Button>
                <Button
                  disabled={Boolean(importing)}
                  onClick={() => navigate("/new/smart-import")}
                  startIcon={<UploadIcon size={16} />}
                  sx={{ borderRadius: "8px" }}
                  variant="outlined"
                >
                  Smart Import (free-form dossier)
                </Button>
              </Stack>
            </Box>
          </Stack>

          <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 3 }}>
            <Button
              endIcon={<ChevronRightIcon size={18} />}
              onClick={handleContinue}
              size="large"
              sx={{ borderRadius: "10px" }}
              variant="contained"
            >
              Continue to Advocates
            </Button>
            {hasErrors ? (
              <Typography color="text.secondary" sx={{ mt: 1.5 }} variant="body2">
                Required fields must be valid before proceeding.
              </Typography>
            ) : null}
          </Box>
        </Stack>
      </Paper>
    </Stack>
  );
}

function formatImportError(error: unknown) {
  if (error instanceof ImportApiError) {
    return error.errors.join(" ");
  }

  return "Import failed.";
}
