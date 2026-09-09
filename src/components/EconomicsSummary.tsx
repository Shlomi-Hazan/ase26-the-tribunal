import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import { mockEconomicsRows } from "../mocks/tribunalMockData";

export function EconomicsSummary({
  detailed = false,
  headingOverride,
  muted = false
}: {
  detailed?: boolean;
  // M14 Review-page visual refinement: both props are additive/opt-in --
  // omitted, this renders exactly as before (ResultPage's <EconomicsSummary
  // detailed /> call is byte-identical). `headingOverride` lets a caller
  // rename the visible heading without touching the underlying mock
  // fixture data; `muted` lets a caller visually subordinate this block
  // (e.g. Review, which shows its own real conservative estimate above
  // this one and needs this fixture block to read as clearly secondary)
  // without changing any value, calculation, or the disclaimer below.
  headingOverride?: string;
  muted?: boolean;
}) {
  return (
    <Card
      component="section"
      data-testid="economics-section"
      sx={
        muted
          ? { bgcolor: "action.hover", border: "1px solid", borderColor: "divider", boxShadow: "none" }
          : undefined
      }
    >
      <CardContent>
        <Typography
          color={muted ? "text.secondary" : undefined}
          component="h2"
          sx={muted ? { fontWeight: 700 } : undefined}
          variant={muted ? "subtitle2" : "h5"}
        >
          {headingOverride ?? "Mock economics"}
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          7 logical calls · 8 attempts · 18,420 tokens · $0.17 · 7.4s
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
          Mock fixture data only. This is not live OpenRouter pricing or actual
          billing.
        </Typography>
        {detailed ? (
          <TableContainer
            data-testid="economics-table-scroll"
            sx={{ mt: 2, maxWidth: "100%", overflowX: "auto" }}
          >
            <Table
              aria-label="Mock economics attempts"
              sx={{ minWidth: 840, whiteSpace: "nowrap" }}
            >
              <TableHead>
                <TableRow>
                  <TableCell>Participant</TableCell>
                  <TableCell>Attempt</TableCell>
                  <TableCell>Model</TableCell>
                  <TableCell>Input</TableCell>
                  <TableCell>Output</TableCell>
                  <TableCell>Total</TableCell>
                  <TableCell>Cost</TableCell>
                  <TableCell>Latency</TableCell>
                  <TableCell>Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {mockEconomicsRows.map((row) => (
                  <TableRow key={`${row.participant}-${row.attempt}`}>
                    <TableCell>{row.participant}</TableCell>
                    <TableCell>{row.attempt}</TableCell>
                    <TableCell>{row.model}</TableCell>
                    <TableCell>{row.input}</TableCell>
                    <TableCell>{row.output}</TableCell>
                    <TableCell>{row.total}</TableCell>
                    <TableCell>{row.cost}</TableCell>
                    <TableCell>{row.latency}</TableCell>
                    <TableCell>{row.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}
      </CardContent>
    </Card>
  );
}
