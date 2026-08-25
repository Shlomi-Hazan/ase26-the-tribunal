import { Button, Card, CardContent, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

export function EmptyHistoryState() {
  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography component="h2" variant="h5">
            No cases yet
          </Typography>
          <Typography color="text.secondary">
            Convene your first Tribunal to create a history entry.
          </Typography>
          <Button component={RouterLink} to="/new/charge-sheet" variant="contained">
            Bring a Case
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
