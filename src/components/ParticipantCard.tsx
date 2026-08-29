import {
  Alert,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { type ChangeEvent, useRef, useState } from "react";
import {
  personalityLimit,
  profileNameLimit,
  validateParticipantProfileName,
  validateParticipantPersonality
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";
import type { Participant } from "../mocks/tribunalMockData";
import {
  ImportApiError,
  importPersonalityFile
} from "../services/importApi";

export function ParticipantCard({ participant }: { participant: Participant }) {
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
            <Typography color="text.secondary">
              {participant.side
                ? `${participant.side} advocate — fixed side`
                : "Independent judge"}
            </Typography>
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
          {state.executionMode === "separate" ? (
            // Independent audit correction (Issue #17 blocker 1/2):
            // Separate-Model execution is M9 scope and its radio is
            // disabled in ExecutionModeControl, so this branch is
            // unreachable via the real UI today -- kept as a visible
            // placeholder (not a real per-participant model selector,
            // which would need its own real-catalog wiring) rather than
            // silently deleted, since the underlying reducer action
            // remains for M9 to build on.
            <Typography color="text.secondary" variant="body2">
              Per-participant model selection is available in a future
              milestone (M9).
            </Typography>
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
