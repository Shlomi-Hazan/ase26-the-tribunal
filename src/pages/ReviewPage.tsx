import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Stack,
  Typography
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { EconomicsSummary } from "../components/EconomicsSummary";
import { PageHeader } from "../components/PageHeader";
import { SetupStepper } from "../components/SetupStepper";
import {
  areAdvocatePersonalitiesValid,
  areJudgePersonalitiesValid,
  isChargeSheetValid,
  isMockSetupReady
} from "../features/case-setup/setupState";
import { useSetup } from "../features/case-setup/useSetup";
import { allParticipants, mockModels } from "../mocks/tribunalMockData";

export function ReviewPage() {
  const { state } = useSetup();
  const sharedModel = mockModels.find((model) => model.id === state.sharedModelId);
  const chargeSheetValid = isChargeSheetValid(state.chargeSheet);
  const advocatesValid = areAdvocatePersonalitiesValid(state);
  const judgesValid = areJudgePersonalitiesValid(state);
  const canConvene = isMockSetupReady(state);
  const blockedReasons = [
    !chargeSheetValid ? "Charge Sheet fields must be complete and valid." : "",
    !advocatesValid ? "All four advocate personalities must be valid." : "",
    !judgesValid ? "All three judge personalities must be valid." : ""
  ].filter(Boolean);

  return (
    <Stack spacing={4}>
      <SetupStepper />
      <PageHeader
        eyebrow="Review"
        title="Review Tribunal"
        description="This is the final mock review gate before the UI-only deliberation route."
      />
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography component="h2" variant="h5">
              Case summary
            </Typography>
            <Typography>
              <strong>Defendant:</strong>{" "}
              {state.chargeSheet.defendant || "Not entered yet"}
            </Typography>
            <Typography>
              <strong>Act:</strong> {state.chargeSheet.act || "Not entered yet"}
            </Typography>
            <Typography>
              <strong>Exact Question:</strong>{" "}
              {state.chargeSheet.exactQuestion || "Not entered yet"}
            </Typography>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Stack spacing={2}>
            <Typography component="h2" variant="h5">
              Execution mode
            </Typography>
            <Typography>
              {state.executionMode === "shared"
                ? "Shared Model — one model, seven distinct roles and personalities."
                : "Separate Models — each participant can use a different eligible model."}
            </Typography>
            <Divider />
            <Typography component="h3" variant="h6">
              Seven-participant configuration
            </Typography>
            {state.executionMode === "shared" ? (
              <Typography>
                Shared mock model: {sharedModel?.displayName ?? state.sharedModelId}
              </Typography>
            ) : null}
            <Box
              sx={{
                display: "grid",
                gap: 1.5,
                gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" }
              }}
            >
              {allParticipants.map((participant) => {
                const model = mockModels.find(
                  (item) => item.id === state.participants[participant.id].modelId
                );

                return (
                  <Box
                    key={participant.id}
                    sx={{
                      border: "1px solid",
                      borderColor: "divider",
                      borderRadius: 2,
                      p: 2
                    }}
                  >
                    <Typography sx={{ fontWeight: 800 }}>
                      {participant.label}
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      {participant.side ? `${participant.side} advocate` : "Judge"}
                    </Typography>
                    <Typography color="text.secondary" variant="body2">
                      Model:{" "}
                      {state.executionMode === "shared"
                        ? sharedModel?.displayName
                        : model?.displayName}
                    </Typography>
                  </Box>
                );
              })}
            </Box>
          </Stack>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <Typography component="h2" variant="h5">
            Mock economics preflight
          </Typography>
          <Typography sx={{ mt: 1 }}>
            Expected logical calls: <strong>7</strong>
          </Typography>
          <Typography>Retry policy: max one retry per participant</Typography>
          <Typography>Hard policy: $5.00 maximum</Typography>
          <Typography color="success.main" sx={{ fontWeight: 800 }}>
            Eligible in this mock scenario
          </Typography>
          <Typography color="text.secondary" variant="body2">
            Mock conservative estimate: $0.42. This is fixture data, not live
            OpenRouter pricing or billing.
          </Typography>
        </CardContent>
      </Card>
      <EconomicsSummary />
      {!canConvene ? (
        <Alert severity="error">
          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 800 }}>
              Mock Tribunal cannot be convened yet.
            </Typography>
            {blockedReasons.map((reason) => (
              <Typography key={reason} variant="body2">
                {reason}
              </Typography>
            ))}
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <Button component={RouterLink} to="/new/charge-sheet" variant="outlined">
                Edit Charge Sheet
              </Button>
              <Button component={RouterLink} to="/new/advocates" variant="outlined">
                Edit Advocates
              </Button>
              <Button component={RouterLink} to="/new/judges" variant="outlined">
                Edit Judges
              </Button>
            </Stack>
          </Stack>
        </Alert>
      ) : null}
      <Alert severity="warning">
        This V1 course demo stores submitted cases in shared demo history. Do
        not submit sensitive, private, confidential, or identifying information.
      </Alert>
      <Stack direction="row" spacing={2}>
        <Button component={RouterLink} to="/new/judges" variant="outlined">
          Back
        </Button>
        {canConvene ? (
          <Button
            component={RouterLink}
            to="/demo/deliberation?scenario=running"
            variant="contained"
          >
            Convene Tribunal
          </Button>
        ) : (
          <Button disabled variant="contained">
            Convene Tribunal
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
