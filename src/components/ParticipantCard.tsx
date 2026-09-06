import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  personalityLimit,
  profileNameLimit,
  validateParticipantProfileName,
  validateParticipantPersonality
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";
import {
  CURRENT_ADVOCATE_SIDE_DESCRIPTION,
  CURRENT_ADVOCATE_SIDE_HEADING
} from "./advocateSideCopy";
import type { Participant } from "../mocks/tribunalMockData";
import type { RoleEligibleModel } from "../services/modelsApi";
import {
  ImportApiError,
  importPersonalityFile
} from "../services/importApi";
import { CounselIcon, UploadIcon } from "./icons/LineIcons";
import { RoleModelSelect } from "./RoleModelSelect";

export function ParticipantCard({
  participant,
  roleModels,
  roleModelsLoading,
  roleModelsError,
  presentation
}: {
  participant: Participant;
  // M9 (Separate-Model Tribunal, Issue #20): the shared role catalog
  // (fetched once per page -- AdvocatesPage/JudgesPage -- and reused by
  // every card of that role), only consulted while Separate Mode is
  // active. Optional so this component's existing Shared-Mode behavior
  // and every existing caller/test remain unaffected when omitted.
  roleModels?: RoleEligibleModel[];
  roleModelsLoading?: boolean;
  roleModelsError?: string;
  // Milestone 14 (Advocates high-fidelity redesign): a purely additive,
  // opt-in presentation switch. Omitted (the default), this renders
  // EXACTLY the prior markup/styling -- JudgesPage never passes this,
  // so Judges is byte-for-byte unaffected. Passed only by AdvocatesPage,
  // to give each advocate's card the "participant dossier" treatment
  // approved for that screen alone. Every field, id, label, dispatch
  // call, validation rule, and import handler below is identical in
  // both presentations -- only the surrounding layout/styling differs.
  presentation?: "advocateDossier";
}) {
  const { state, dispatch } = useSetup();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const config = state.participants[participant.id];
  const profileNameError = validateParticipantProfileName(config.profileName);
  const personalityError = validateParticipantPersonality(config.personality);
  const hasProfileNameError = Boolean(profileNameError);
  const hasPersonalityError = Boolean(personalityError);
  const isSeparateMode = state.executionMode === "separate";
  // Stable empty-array identity across renders when roleModels is
  // omitted -- otherwise `roleModels ?? []` allocates a new array every
  // render and would trip the repair effect's dependency array below on
  // every re-render, not only when the catalog genuinely changes.
  const models = useMemo(() => roleModels ?? [], [roleModels]);
  const modelsLoading = roleModelsLoading ?? false;
  const modelsError = roleModelsError ?? "";

  // M9 mock/stale-model guard (Issue #20 independent planning review,
  // Correction 3): once this participant's own role catalog has loaded,
  // repair an id that is not (or no longer) a real member of it --
  // never leave the empty starting default or a stale selection silently
  // in place, and never overwrite an already-valid selection (so
  // Shared -> Separate -> Shared -> Separate preserves it exactly).
  // Mirrors useEligibleModels's own auto-select-only-when-invalid
  // pattern for the Shared selector.
  useEffect(() => {
    if (!isSeparateMode || modelsLoading || modelsError || models.length === 0) {
      return;
    }

    const isCurrentSelectionValid = models.some((model) => model.id === config.modelId);

    if (!isCurrentSelectionValid) {
      dispatch({
        type: "setParticipantModel",
        participantId: participant.id,
        modelId: models[0].id
      });
    }
  }, [
    isSeparateMode,
    modelsLoading,
    modelsError,
    models,
    config.modelId,
    dispatch,
    participant.id
  ]);

  async function handlePersonalityImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    setImportError("");
    setImportNotice("");
    setIsImporting(true);

    try {
      const result = await importPersonalityFile(file);

      dispatch({
        type: "applyParticipantPersonalityImport",
        participantId: participant.id,
        personality: result.personality,
        filename: result.filename
      });
      setImportNotice(`Imported personality from ${result.filename}.`);
    } catch (error) {
      setImportError(formatImportError(error));
    } finally {
      setIsImporting(false);
    }
  }

  const isAdvocateDossier = presentation === "advocateDossier";
  // Local-only, opt-in field styling -- the same warm parchment-tinted
  // treatment approved on Charge Sheet. Judges' cards never set this
  // (sx={undefined} is a no-op) and keep the plain default MUI look.
  const dossierFieldSx = isAdvocateDossier
    ? {
        "& .MuiOutlinedInput-root": {
          backgroundColor: "rgba(184,137,43,0.035)",
          borderRadius: "9px",
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: "#8C6423",
            borderWidth: "2px"
          }
        }
      }
    : undefined;

  return (
    <Card
      component="section"
      sx={
        isAdvocateDossier
          ? {
              // Refinement pass: a very subtle top-corner gradient wash
              // (never a shiny/loud fill) for a touch of depth -- warm
              // gold-tinted for PRO, restrained umber/iron-tinted for
              // CON, both fading back into the plain card surface
              // within the first quarter of the card, so text stays on
              // flat, fully readable ground.
              backgroundImage:
                participant.side === "PRO"
                  ? "linear-gradient(160deg, rgba(184,137,43,0.09) 0%, rgba(184,137,43,0) 28%)"
                  : "linear-gradient(160deg, rgba(107,99,85,0.1) 0%, rgba(107,99,85,0) 28%)",
              borderRadius: "12px",
              borderTop: "3px solid",
              borderTopColor: participant.side === "PRO" ? "#B8892B" : "#6B6355"
            }
          : {
              borderTop: "4px solid",
              borderTopColor:
                participant.side === "PRO"
                  ? "info.main"
                  : participant.side === "CON"
                    ? "secondary.main"
                    : "primary.main"
            }
      }
    >
      <CardContent>
        <Stack spacing={2}>
          {isAdvocateDossier ? (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start", justifyContent: "space-between" }}>
              <Stack direction="row" spacing={1.5}>
                {/* Milestone 14 (Advocates refinement pass, corrected):
                    a neutral "counsel" mark (briefcase), not a person/
                    portrait glyph -- reads as "representation," never
                    as a placeholder avatar or emoji-like figure. Side
                    marker only in combination with the PRO/CON text
                    label beside it (color alone is never the signal). */}
                <Box
                  sx={{
                    alignItems: "center",
                    bgcolor: participant.side === "PRO" ? "rgba(184,137,43,0.12)" : "rgba(107,99,85,0.14)",
                    borderRadius: "50%",
                    color: participant.side === "PRO" ? "#8C6423" : "#6B6355",
                    display: "flex",
                    flexShrink: 0,
                    height: 44,
                    justifyContent: "center",
                    width: 44
                  }}
                >
                  <CounselIcon size={20} />
                </Box>
                <Stack spacing={0.5}>
                  <Typography component="h2" sx={{ fontFamily: '"Fraunces", Georgia, serif' }} variant="h5">
                    {participant.label}
                  </Typography>
                  {participant.side ? (
                    <>
                      <Typography
                        sx={{ color: participant.side === "PRO" ? "#8C6423" : "text.secondary", fontWeight: 700 }}
                        variant="body2"
                      >
                        {CURRENT_ADVOCATE_SIDE_HEADING[participant.side]}
                      </Typography>
                      <Typography color="text.secondary" variant="body2">
                        {toReadableVerdictDirection(CURRENT_ADVOCATE_SIDE_DESCRIPTION[participant.side])}
                      </Typography>
                    </>
                  ) : (
                    <Typography color="text.secondary">Independent judge</Typography>
                  )}
                </Stack>
              </Stack>
              {/* Import moved here (top-right, quiet) per the refinement
                  pass -- same ref/handler/behavior as the plain
                  presentation's button below, just relocated and
                  restyled as a small secondary action. */}
              <Button
                disabled={isImporting}
                onClick={() => fileInputRef.current?.click()}
                size="small"
                startIcon={<UploadIcon size={14} />}
                sx={{ color: "text.secondary", flexShrink: 0, fontWeight: 600 }}
                variant="text"
              >
                {isImporting ? "Importing..." : "Import"}
              </Button>
            </Stack>
          ) : (
            <Stack spacing={0.5}>
              <Typography component="h2" variant="h5">
                {participant.label}
              </Typography>
              {participant.side ? (
                <>
                  <Typography color="text.secondary">
                    {CURRENT_ADVOCATE_SIDE_HEADING[participant.side]}
                  </Typography>
                  <Typography color="text.secondary" variant="body2">
                    {CURRENT_ADVOCATE_SIDE_DESCRIPTION[participant.side]}
                  </Typography>
                </>
              ) : (
                <Typography color="text.secondary">Independent judge</Typography>
              )}
            </Stack>
          )}
          <TextField
            error={hasProfileNameError}
            fullWidth
            helperText={
              hasProfileNameError
                ? `${profileNameError} ${config.profileName.length}/${profileNameLimit} characters.`
                : `Optional display name. ${config.profileName.length}/${profileNameLimit} characters.`
            }
            id={`${participant.id}-profile-name`}
            label={`${participant.label} profile name`}
            onChange={(event) =>
              dispatch({
                type: "setParticipantProfileName",
                participantId: participant.id,
                value: event.target.value
              })
            }
            slotProps={{
              htmlInput: {
                maxLength: profileNameLimit
              }
            }}
            sx={dossierFieldSx}
            value={config.profileName}
          />
          <TextField
            error={hasPersonalityError}
            fullWidth
            helperText={
              hasPersonalityError
                ? `${personalityError} ${config.personality.length}/${personalityLimit} characters.`
                : `Personality is user-provided behavioural context. ${config.personality.length}/${personalityLimit} characters.`
            }
            id={`${participant.id}-personality`}
            label={`${participant.label} personality`}
            minRows={5}
            multiline
            onChange={(event) =>
              dispatch({
                type: "setParticipantPersonality",
                participantId: participant.id,
                value: event.target.value
              })
            }
            required
            slotProps={{
              htmlInput: {
                maxLength: personalityLimit
              }
            }}
            sx={dossierFieldSx}
            value={config.personality}
          />
          {config.personalitySource !== "manual" ? (
            <Typography color="text.secondary" variant="body2">
              Source:{" "}
              {config.personalitySource === "tribunal_package"
                ? "Full Tribunal Package"
                : "Individual personality file"}
              {config.personalitySourceFilename
                ? ` (${config.personalitySourceFilename})`
                : ""}
            </Typography>
          ) : null}
          {importNotice ? <Alert severity="success">{importNotice}</Alert> : null}
          {importError ? <Alert severity="error">{importError}</Alert> : null}
          <input
            aria-label={`${participant.label} personality import file`}
            accept=".txt,.md,text/plain,text/markdown"
            hidden
            onChange={handlePersonalityImport}
            ref={fileInputRef}
            type="file"
          />
          {!isAdvocateDossier ? (
            <Button
              disabled={isImporting}
              onClick={() => fileInputRef.current?.click()}
              variant="outlined"
            >
              {isImporting ? "Importing..." : "Import Personality"}
            </Button>
          ) : null}
          {isSeparateMode ? (
            <RoleModelSelect
              error={modelsError}
              id={`${participant.id}-model`}
              label={`${participant.label} model`}
              loading={modelsLoading}
              models={models}
              onChange={(modelId) =>
                dispatch({
                  type: "setParticipantModel",
                  participantId: participant.id,
                  modelId
                })
              }
              value={config.modelId}
            />
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

// Milestone 14 (Advocates refinement pass): DISPLAY-ONLY polish, local
// to this one presentation branch -- never touches the shared, locked
// advocateSideCopy.ts constant (also consumed by ReviewPage, and
// mirrored in describeHistoricalAdvocateSide.ts for historical Run
// display with its own locked tests). Rewriting that shared source
// would ripple wording into surfaces explicitly out of scope for this
// pass. This only reformats the raw enum-like "NOT_GUILTY"/"GUILTY"
// substrings into "Not Guilty"/"Guilty" for the advocate-dossier card
// text itself; the NOT_GUILTY replacement must run first since "GUILTY"
// is a substring of "NOT_GUILTY".
function toReadableVerdictDirection(description: string): string {
  return description.replace("NOT_GUILTY", "Not Guilty").replace("GUILTY", "Guilty");
}

function formatImportError(error: unknown) {
  if (error instanceof ImportApiError) {
    return error.errors.join(" ");
  }

  return "Personality import failed.";
}
