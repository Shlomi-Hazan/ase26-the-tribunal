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
import { CounselIcon, ScaleIcon, UploadIcon } from "./icons/LineIcons";
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
  // Milestone 14 (Advocates high-fidelity redesign; Judges follow-up
  // pass added "judgeDossier"): a purely additive, opt-in presentation
  // switch. Omitted (the default), this renders EXACTLY the original
  // plain markup/styling -- safe for any future caller that doesn't
  // pass it. "advocateDossier" (AdvocatesPage only) and "judgeDossier"
  // (JudgesPage only) each get their own restyled header/card
  // treatment below. Every field, id, label, dispatch call, validation
  // rule, and import handler is identical across all three
  // presentations -- only the surrounding layout/styling differs.
  presentation?: "advocateDossier" | "judgeDossier";
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
  const isJudgeDossier = presentation === "judgeDossier";
  const isPremiumPresentation = isAdvocateDossier || isJudgeDossier;
  // Milestone 14 (Judges follow-up pass): each of the three fixed judge
  // seats gets its own subtle wash tone (gold / stone / taupe-iron),
  // keyed off the participant's own fixed id -- never a color-only
  // signal (the seat's own label/heading text is always shown too).
  // Falls back to the Judge I tone for any id this map doesn't
  // recognize, so an unexpected/future id never renders unstyled.
  const judgeSeatTone: Record<string, string> = {
    "judge-1": "184,137,43", // muted gold
    "judge-2": "150,140,120", // soft stone
    "judge-3": "120,110,95" // restrained taupe/iron
  };
  const judgeTone = judgeSeatTone[participant.id] ?? judgeSeatTone["judge-1"];
  // Local-only, opt-in field styling -- the same warm parchment-tinted
  // treatment approved on Charge Sheet/Advocates. Judges' PLAIN cards
  // (i.e. any caller that omits `presentation`) never set this
  // (sx={undefined} is a no-op) and keep the original default MUI look.
  const dossierFieldSx = isPremiumPresentation
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
          : isJudgeDossier
            ? {
                // Judges follow-up pass: the three seats share ONE top
                // rule (never a per-seat color) so all three read as
                // one coordinated bench -- only the background wash
                // varies per seat, and only subtly, per judgeTone above.
                backgroundImage: `linear-gradient(160deg, rgba(${judgeTone},0.08) 0%, rgba(${judgeTone},0) 30%)`,
                borderRadius: "12px",
                borderTop: "3px solid",
                borderTopColor: "#8C6423"
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
          {isPremiumPresentation ? (
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start", justifyContent: "space-between" }}>
              <Stack direction="row" spacing={1.5}>
                {/* Milestone 14: a neutral, original mark -- never a
                    person/portrait glyph, emoji, or realistic face --
                    reads as the seat's role. Always paired with a text
                    label beside it (color alone is never the signal). */}
                <Box
                  sx={{
                    alignItems: "center",
                    bgcolor: isAdvocateDossier
                      ? participant.side === "PRO"
                        ? "rgba(184,137,43,0.12)"
                        : "rgba(107,99,85,0.14)"
                      : "rgba(140,100,53,0.12)",
                    borderRadius: "50%",
                    color: isAdvocateDossier
                      ? participant.side === "PRO"
                        ? "#8C6423"
                        : "#6B6355"
                      : "#8C6423",
                    display: "flex",
                    flexShrink: 0,
                    height: 44,
                    justifyContent: "center",
                    width: 44
                  }}
                >
                  {isAdvocateDossier ? <CounselIcon size={20} /> : <ScaleIcon size={20} />}
                </Box>
                <Stack spacing={0.5}>
                  <Typography component="h2" sx={{ fontFamily: '"Fraunces", Georgia, serif' }} variant="h5">
                    {participant.label}
                  </Typography>
                  {isAdvocateDossier && participant.side ? (
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
                  ) : isJudgeDossier ? (
                    <>
                      <Typography sx={{ color: "#6B6355", fontWeight: 700 }} variant="body2">
                        Judicial Seat
                      </Typography>
                      <Typography color="text.secondary" variant="body2">
                        Independent judge — evaluates the completed arguments and returns one
                        verdict.
                      </Typography>
                    </>
                  ) : (
                    <Typography color="text.secondary">Independent judge</Typography>
                  )}
                </Stack>
              </Stack>
              {/* Import moved here (top-right, quiet) per the Advocates
                  refinement pass, now shared by the judge presentation
                  too -- same ref/handler/behavior as the plain
                  presentation's bottom button, just relocated and
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
          {!isPremiumPresentation ? (
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
