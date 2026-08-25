import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  Typography
} from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import { PageHeader } from "../components/PageHeader";
import { EmptyHistoryState } from "../features/history/EmptyHistoryState";
import { mockHistoryCases } from "../mocks/tribunalMockData";

export function HistoryPage() {
  return (
    <Stack spacing={4}>
      <PageHeader
        eyebrow="Past Cases"
        title="Past Cases"
        description="Static mock history only. Refreshing does not persist new setup data in Milestone 4."
      />
      <Box
        sx={{
          display: "grid",
          gap: 2,
          gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }
        }}
      >
        {mockHistoryCases.map((item) => (
          <Card key={item.id}>
            <CardContent>
              <Stack spacing={1.5}>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <Typography component="h2" variant="h6">
                    {item.defendant}
                  </Typography>
                  <Chip
                    color={item.status === "Failed" ? "error" : "success"}
                    label={item.status}
                    size="small"
                  />
                </Stack>
                <Typography color="text.secondary">
                  {item.exactQuestion}
                </Typography>
                <Typography variant="body2">{item.date}</Typography>
                <Typography variant="body2">{item.executionMode}</Typography>
                <Typography sx={{ fontWeight: 800 }}>
                  {item.verdict ? `Verdict: ${item.verdict}` : "No verdict"}
                </Typography>
                <Typography color="text.secondary" variant="body2">
                  Mock cost: {item.cost}
                </Typography>
                {item.status === "Completed" ? (
                  <Button
                    component={RouterLink}
                    to={`/demo/result?source=history&case=${item.id}`}
                    variant="outlined"
                  >
                    Open historical result
                  </Button>
                ) : null}
              </Stack>
            </CardContent>
          </Card>
        ))}
      </Box>
      <EmptyHistoryState />
    </Stack>
  );
}
