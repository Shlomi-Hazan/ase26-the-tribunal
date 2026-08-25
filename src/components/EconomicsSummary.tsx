import {
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import { mockEconomicsRows } from "../mocks/tribunalMockData";

export function EconomicsSummary({ detailed = false }: { detailed?: boolean }) {
  return (
    <Card component="section" data-testid="economics-section">
      <CardContent>
        <Typography component="h2" variant="h5">
          Mock economics
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          7 logical calls · 8 attempts · 18,420 tokens · $0.17 · 7.4s
        </Typography>
        <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
          Mock fixture data only. This is not live OpenRouter pricing or actual
          billing.
        </Typography>
        {detailed ? (
          <Table aria-label="Mock economics attempts" sx={{ mt: 2 }}>
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
        ) : null}
      </CardContent>
    </Card>
  );
}
