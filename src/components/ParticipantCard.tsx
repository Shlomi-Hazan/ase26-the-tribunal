import {
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import {
  personalityLimit,
  validateParticipantPersonality
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";
import type { Participant } from "../mocks/tribunalMockData";
import { ModelSelect } from "./ModelSelect";

export function ParticipantCard({ participant }: { participant: Participant }) {
  const { state, dispatch } = useSetup();
  const config = state.participants[participant.id];
  const personalityError = validateParticipantPersonality(config.personality);
  const hasPersonalityError = Boolean(personalityError);

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
          <Button disabled variant="outlined">
            Personality import available in Milestone 5
          </Button>
          {state.executionMode === "separate" ? (
            <ModelSelect
              id={`${participant.id}-model`}
              label={`${participant.label} mock model`}
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
