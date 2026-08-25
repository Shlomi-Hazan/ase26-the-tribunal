import {
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography
} from "@mui/material";
import { useSetup } from "../features/case-setup/useSetup";
import type { Participant } from "../mocks/tribunalMockData";
import { ModelSelect } from "./ModelSelect";

export function ParticipantCard({ participant }: { participant: Participant }) {
  const { state, dispatch } = useSetup();
  const config = state.participants[participant.id];
  const missingPersonality = config.personality.trim().length === 0;

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
            error={missingPersonality}
            fullWidth
            helperText={
              missingPersonality
                ? "Personality is required."
                : "Personality is user-provided behavioural context."
            }
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
