import {
  Alert,
  Box,
  Button,
  Paper,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { type ChangeEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { SetupStepper } from "../components/SetupStepper";
import { ChevronRightIcon, DocumentIcon } from "../components/icons/LineIcons";
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

const fields: Array<{
  name: ChargeField;
  label: string;
  helper: string;
  multiline?: boolean;
  minRows?: number;
}> = [
  {
    name: "defendant",
    label: "Defendant",
    helper: "Who or what is the case about?"
  },
  {
    name: "act",
    label: "Act",
    helper: "Describe the disputed act or situation.",
    multiline: true,
    minRows: 5
  },
  {
    name: "exactQuestion",
    label: "Exact Question",
    helper: "Write the binary question the judges should answer.",
    multiline: true,
    minRows: 3
  }
];

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
      <PageHeader
        eyebrow="New Case"
        title="Charge Sheet"
        description="Define the case in three deterministic fields before configuring the Tribunal."
      />
      <Paper
        component="form"
        noValidate
        sx={{
          overflow: "hidden",
          p: { xs: 2, md: 4 },
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
          {fields.map((field) => {
            const value = state.chargeSheet[field.name];
            const showError = attempted && Boolean(errors[field.name]);

            return (
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
                  htmlInput: {
                    maxLength: chargeSheetLimits[field.name]
                  }
                }}
                value={value}
              />
            );
          })}
          {state.importNotice ? (
            <Alert onClose={() => dispatch({ type: "clearImportNotice" })} severity="success">
              {state.importNotice}
            </Alert>
          ) : null}
          {importError ? <Alert severity="error">{importError}</Alert> : null}
          <Alert severity="info">
            Import Charge Sheet fills only the case fields. Import Full Tribunal
            Package fills the case and all seven participant personalities for
            review; neither import convenes a Tribunal.
          </Alert>
          <Box
            sx={{
              border: "1px dashed",
              borderColor: "divider",
              borderRadius: 2,
              p: { xs: 1.5, sm: 2 }
            }}
          >
            <Typography color="text.secondary" sx={{ fontWeight: 700, mb: 1.5 }} variant="caption">
              OR IMPORT AN EXISTING CASE
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
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
                variant="outlined"
              >
                {importing === "package"
                  ? "Importing..."
                  : "Import Full Tribunal Package"}
              </Button>
              <Button
                disabled={Boolean(importing)}
                onClick={() => navigate("/new/smart-import")}
                variant="outlined"
              >
                Smart Import (free-form dossier)
              </Button>
            </Stack>
          </Box>
          <Box sx={{ borderTop: "1px solid", borderColor: "divider", pt: 3 }}>
            <Button
              endIcon={<ChevronRightIcon size={18} />}
              onClick={handleContinue}
              size="large"
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
