import {
  Alert,
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
import { RoleModelSelect } from "./RoleModelSelect";

export function ParticipantCard({
  participant,
  roleModels,
  roleModelsLoading,
  roleModelsError
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

  return (
    <Card
      component="section"
      sx={{
        borderTop: "4px solid",
        borderTopColor:
          participant.side === "PRO"
            ? "info.main"
            : participant.side === "CON"
              ? "secondary.main"
              : "primary.main"
      }}
    >
      <CardContent>
        <Stack spacing={2}>
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
          <Button
            disabled={isImporting}
            onClick={() => fileInputRef.current?.click()}
            variant="outlined"
          >
            {isImporting ? "Importing..." : "Import Personality"}
          </Button>
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

function formatImportError(error: unknown) {
  if (error instanceof ImportApiError) {
    return error.errors.join(" ");
  }

  return "Personality import failed.";
}
