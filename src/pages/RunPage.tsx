// Milestone 8 -- the real run page (ARCHITECTURE.md Sec 12's
// `/runs/:runId` route). Replaces the mock `?scenario=` query-param
// state the M4-era DeliberationPage/ResultPage still use (left
// unmodified -- they remain a valid UI-shell demonstration independent
// of real execution) with GET /api/runs/:id polling against a real run.

import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Collapse,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography
} from "@mui/material";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { JudgeVoteGroup } from "../components/JudgeVoteGroup";
import { PageHeader } from "../components/PageHeader";
import { PublicDemoRetentionNotice } from "../components/PublicDemoRetentionNotice";
import { StatusBadge } from "../components/StatusBadge";
import { verdictColor } from "../components/verdictColor";
import {
  advocateParticipants,
  judgeParticipants,
  type ParticipantStatus
} from "../mocks/tribunalMockData";
import {
  getRun,
  type AttemptAudit,
  type ParticipantAttemptStatus,
  type StoredRun
} from "../services/runApi";

const POLL_INTERVAL_MS = 2000;
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "BLOCKED_BUDGET"]);

// Post-M9 Result UX follow-up: a plain chevron-down glyph, not an
// @mui/icons-material dependency (none is installed and this is the
// only place one would be needed). `currentColor` inherits
// AccordionSummary's own expandIconWrapper color/rotation styling, so it
// stays theme-consistent without any extra CSS. Purely decorative --
// `aria-hidden` keeps it out of the accessible name, which is already
// carried by the visible text next to it.
function AccordionExpandIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      viewBox="0 0 24 24"
      width="20"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

const STATUS_MAP: Record<ParticipantAttemptStatus, ParticipantStatus> = {
  PENDING: "Waiting",
  RUNNING: "Running",
  RETRYING: "Retrying",
  SUCCESS: "Complete",
  FAILED: "Failed"
};

export function RunPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<StoredRun | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!runId) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const fetched = await getRun(runId!);

        if (cancelled) {
          return;
        }

        if (!fetched) {
          setError("This run could not be found.");

          return;
        }

        setRun(fetched);

        if (!TERMINAL_STATUSES.has(fetched.status)) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
        }
      } catch {
        if (!cancelled) {
          setError("This run's status could not be loaded.");
        }
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [runId]);

  if (error) {
    return (
      <Stack spacing={4}>
        <PublicDemoRetentionNotice />
        <Alert severity="error">{error}</Alert>
      </Stack>
    );
  }

  if (!run) {
    return (
      <Stack spacing={2} sx={{ alignItems: "center", py: 8 }}>
        <CircularProgress />
        <Typography color="text.secondary">Loading run...</Typography>
      </Stack>
    );
  }

  if (run.status === "BLOCKED_BUDGET") {
    return (
      <Stack spacing={4}>
        <PublicDemoRetentionNotice />
        <PageHeader
          description="Budget blocking happens before model execution and is not a participant failure."
          eyebrow="Budget Gate"
          title="This run cannot be executed"
        />
        <Card>
          <CardContent>
            <Typography>{run.failureMessage ?? "Conservative preflight exceeded the $5.00 policy limit."}</Typography>
          </CardContent>
        </Card>
      </Stack>
    );
  }

  if (run.status === "FAILED") {
    return (
      <Stack spacing={4}>
        <PublicDemoRetentionNotice />
        <PageHeader
          description={run.failureMessage ?? "The run could not complete."}
          eyebrow="Run Failed"
          title="The Tribunal could not complete"
        />
        <Alert severity="error">
          Failure is never a verdict. {run.failureCode ? `Code: ${run.failureCode}` : ""}
        </Alert>
        <PartialSpendNotice partialSpend={run.partialSpend} />
        <ParticipantGrid run={run} />
        {run.attempts.length > 0 ? <EconomicsAuditAccordion run={run} /> : null}
      </Stack>
    );
  }

  if (run.status === "COMPLETED") {
    return <CompletedResult run={run} />;
  }

  return (
    <Stack spacing={4}>
      <PublicDemoRetentionNotice />
      <PageHeader
        description={`Status: ${run.status}`}
        eyebrow="The Tribunal is in session"
        title="Deliberation in progress"
      />
      <ParticipantGrid run={run} />
    </Stack>
  );
}

function ParticipantGrid({ run }: { run: StoredRun }) {
  const statusById = new Map(run.participants.map((participant) => [participant.participantId, participant.attemptStatus]));
  const judgesActive = run.status === "JUDGES_RUNNING" || run.status === "COMPLETED" || run.status === "FAILED";

  return (
    <Stack spacing={3}>
      <Card component="section">
        <CardContent>
          <Typography component="h2" variant="h5">
            Advocates
          </Typography>
          <ParticipantRow
            participants={advocateParticipants}
            statuses={advocateParticipants.map((p) => STATUS_MAP[statusById.get(p.id) ?? "PENDING"])}
          />
        </CardContent>
      </Card>
      {judgesActive ? (
        <Card component="section">
          <CardContent>
            <Typography component="h2" variant="h5">
              Judges
            </Typography>
            <ParticipantRow
              participants={judgeParticipants}
              statuses={judgeParticipants.map((p) => STATUS_MAP[statusById.get(p.id) ?? "PENDING"])}
            />
          </CardContent>
        </Card>
      ) : (
        <Alert severity="info">Judges begin only after all four advocate speeches validate.</Alert>
      )}
    </Stack>
  );
}

function ParticipantRow({
  participants,
  statuses
}: {
  participants: Array<{ id: string; label: string; side?: string }>;
  statuses: ParticipantStatus[];
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gap: 2,
        gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" },
        mt: 2
      }}
    >
      {participants.map((participant, index) => (
        <Stack
          key={participant.id}
          spacing={1}
          sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}
        >
          <Typography sx={{ fontWeight: 800 }}>{participant.label}</Typography>
          {participant.side ? (
            <Typography color="text.secondary" variant="body2">
              Side: {participant.side}
            </Typography>
          ) : null}
          <StatusBadge status={statuses[index]} />
        </Stack>
      ))}
    </Box>
  );
}

// Independent audit correction (Issue #17 blocker 6): a run marked
// COMPLETED must actually carry a complete, valid result before any of
// it is rendered -- a non-null majority verdict, exactly four non-empty
// advocate speeches, and exactly three valid judge verdicts with
// non-empty reasoning. This never trusts `run.status === "COMPLETED"`
// alone; it independently re-verifies the data that status claims to
// describe, exactly the way a failed integrity check must never fall
// back to a fabricated default (never `?? "NOT_GUILTY"`, never `?? ""`).
type ResultIntegrityCheck =
  | { valid: true }
  | { valid: false; reason: string };

function checkResultIntegrity(run: StoredRun): ResultIntegrityCheck {
  if (run.majorityVerdict !== "GUILTY" && run.majorityVerdict !== "NOT_GUILTY") {
    return { valid: false, reason: "The stored majority verdict is missing or invalid." };
  }

  const speeches = advocateParticipants.map((advocate) =>
    run.participants.find((entry) => entry.participantId === advocate.id)
  );

  if (speeches.some((participant) => !participant?.speech || participant.speech.trim().length === 0)) {
    return { valid: false, reason: "One or more advocate speeches are missing." };
  }

  const verdicts = judgeParticipants.map((judge) =>
    run.participants.find((entry) => entry.participantId === judge.id)
  );

  if (
    verdicts.some(
      (participant) =>
        (participant?.verdict !== "GUILTY" && participant?.verdict !== "NOT_GUILTY") ||
        !participant?.reasoning ||
        participant.reasoning.trim().length === 0
    )
  ) {
    return { valid: false, reason: "One or more judge verdicts or reasonings are missing." };
  }

  return { valid: true };
}

function CompletedResult({ run }: { run: StoredRun }) {
  const integrity = checkResultIntegrity(run);

  if (!integrity.valid) {
    return (
      <Stack spacing={4}>
        <PublicDemoRetentionNotice />
        <PageHeader
          description="This completed run's stored result is incomplete or corrupted -- it is not displayed as a verdict."
          eyebrow="Result Data Integrity Error"
          title="This result cannot be safely displayed"
        />
        <Alert severity="error">{integrity.reason}</Alert>
      </Stack>
    );
  }

  // Safe: checkResultIntegrity already proved majorityVerdict is GUILTY
  // or NOT_GUILTY above.
  const majorityVerdict = run.majorityVerdict as "GUILTY" | "NOT_GUILTY";
  const votes = judgeParticipants.map((judge) => {
    // Safe: checkResultIntegrity already proved every judge has a valid
    // verdict/non-empty reasoning above.
    const participant = run.participants.find((entry) => entry.participantId === judge.id)!;

    return {
      judge: judge.label,
      verdict: participant.verdict as "GUILTY" | "NOT_GUILTY",
      model: participant.modelId,
      personality: participant.personality,
      reasoning: participant.reasoning as string
    };
  });
  const speeches = advocateParticipants.map((advocate) => {
    // Safe: checkResultIntegrity already proved every advocate has a
    // non-empty speech above.
    const participant = run.participants.find((entry) => entry.participantId === advocate.id)!;

    return {
      participant: advocate.label,
      side: advocate.side ?? "PRO",
      model: participant.modelId,
      personality: participant.personality,
      speech: participant.speech as string
    };
  });

  return (
    <Stack spacing={4}>
      <PublicDemoRetentionNotice />
      <Card component="section">
        <CardContent>
          <Typography color="text.secondary" sx={{ fontWeight: 800 }}>
            TRIBUNAL VERDICT
          </Typography>
          <Typography
            color={verdictColor(majorityVerdict)}
            component="h1"
            sx={{ mt: 1 }}
            variant="h2"
          >
            {majorityVerdict}
          </Typography>
          <Typography color="text.secondary">
            Deterministic majority of the three judge votes -- real execution, user-funded.
          </Typography>
          {run.totalCostUsd ? (
            <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
              Total model cost: ${run.totalCostUsd}
            </Typography>
          ) : null}
        </CardContent>
      </Card>
      <JudgeVoteGroup votes={votes} />
      {votes.map((vote) => (
        <Accordion key={vote.judge}>
          <AccordionSummary expandIcon={<AccordionExpandIcon />}>
            <Stack spacing={0.25}>
              <Typography sx={{ fontWeight: 800 }}>
                {vote.judge} --{" "}
                <Typography color={verdictColor(vote.verdict)} component="span" sx={{ fontWeight: 800 }}>
                  {vote.verdict}
                </Typography>
              </Typography>
              <Typography color="text.secondary" variant="caption">
                View reasoning
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Typography>{vote.reasoning}</Typography>
          </AccordionDetails>
        </Accordion>
      ))}
      {speeches.map((speech) => (
        <Accordion key={speech.participant}>
          <AccordionSummary expandIcon={<AccordionExpandIcon />}>
            <Stack spacing={0.25}>
              <Typography sx={{ fontWeight: 800 }}>
                {speech.participant} -- {speech.side}
              </Typography>
              <Typography color="text.secondary" variant="caption">
                View argument
              </Typography>
            </Stack>
          </AccordionSummary>
          <AccordionDetails>
            <Typography>{speech.speech}</Typography>
          </AccordionDetails>
        </Accordion>
      ))}
      <EconomicsSummaryLine run={run} />
      <EconomicsAuditAccordion run={run} />
      <ProtocolAccordion protocol={run.protocol} />
    </Stack>
  );
}

// Milestone 10 (Issue #23) -- `Unavailable` for a null token/latency
// figure, never a fabricated zero (docs/economics.md Sec 7). Locale
// grouping for readability only, not authoritative formatting.
function formatTokenCount(value: number | null): string {
  return value === null ? "Unavailable" : value.toLocaleString("en-US");
}

function formatLatency(ms: number | null): string {
  return ms === null ? "Unavailable" : `${ms}ms`;
}

function formatWallClockSeconds(ms: number | null): string {
  return ms === null ? "Unavailable" : `${(ms / 1000).toFixed(1)}s`;
}

function formatCostUsd(value: string | null): string {
  return value === null ? "Unavailable" : `$${value}`;
}

// Milestone 10 (Issue #23, "Actual vs Derived Cost Presentation"): the
// primary cost value is the actual provider-billed cost when present,
// otherwise the derived comparison cost -- always explicitly labeled
// which one it is. `Unavailable` (never `$0`) when both are null.
function attemptCostDisplay(attempt: AttemptAudit): { text: string; source: "Actual" | "Derived" | null } {
  if (attempt.actualCostUsd !== null) {
    return { text: formatCostUsd(attempt.actualCostUsd), source: "Actual" };
  }

  if (attempt.derivedCostUsd !== null) {
    return { text: formatCostUsd(attempt.derivedCostUsd), source: "Derived" };
  }

  return { text: "Unavailable", source: null };
}

// docs/ui-spec.md Sec 15's compact summary example, using real response
// values -- never a hard-coded attempt/call count.
function EconomicsSummaryLine({ run }: { run: StoredRun }) {
  return (
    <Typography color="text.secondary">
      {run.logicalCallCount} logical calls &middot; {run.providerAttemptCount} attempts &middot;{" "}
      {formatTokenCount(run.totalTokens)} tokens &middot; {formatCostUsd(run.totalCostUsd)} &middot;{" "}
      {formatWallClockSeconds(run.wallClockMs)}
    </Typography>
  );
}

// Milestone 10 (Issue #23 Sec 8/Finding 3): the reconstructed COMPLETED-
// run admission decision. Explicitly never the actual charge -- that
// stays in the summary/table above, kept visually and textually
// distinct. `Unavailable` (honest disclosure, Option 1) rather than a
// fabricated figure when the persisted evidence doesn't support exact
// reconstruction (e.g. a FAILED-during-Advocates run never reaches here
// at all, since `admission` is only ever non-null on a COMPLETED run).
function AdmissionBudgetSafety({ admission }: { admission: StoredRun["admission"] }) {
  if (!admission) {
    return null;
  }

  return (
    <Box sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 2 }}>
      <Typography sx={{ fontWeight: 800 }} variant="body2">
        Admission / Budget Safety
      </Typography>
      {admission.available ? (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          <Typography variant="body2">
            Economics policy:{" "}
            {admission.economicsPolicyVersion === "tribunal-economics-policy-v1"
              ? "V1"
              : admission.economicsPolicyVersion}
          </Typography>
          <Typography variant="body2">
            Conservative authorized maximum: ${admission.authoritativeHistoricalBound}
          </Typography>
          <Typography variant="body2">Safety factor: {admission.budgetSafetyFactor}&times;</Typography>
          <Typography variant="body2">Hard run ceiling: ${admission.hardBudgetUsd}</Typography>
          <Typography color={admission.withinBudget ? "success" : "error"} variant="body2">
            Admission result: {admission.withinBudget ? "Within budget" : "Budget anomaly"}
          </Typography>
          <Typography color="text.secondary" variant="caption">
            This is the conservative amount the run was authorized for, not the actual amount charged.
          </Typography>
        </Stack>
      ) : (
        <Typography color="text.secondary" sx={{ mt: 1 }} variant="body2">
          Admission evidence: Unavailable
        </Typography>
      )}
    </Box>
  );
}

// Milestone 10 (independent source audit, Finding 3): docs/economics.md
// Sec 18 requires the detailed audit to include a pricing SNAPSHOT, not
// only actual/derived cost -- the primary table stays compact (per
// docs/ui-spec.md Sec 15's own "do not overload the first view"
// guidance), and each row gets its own expandable detail exposing the
// full per-attempt evidence: configured/canonical model, provider
// endpoint, prompt version, the historical pricing snapshot (explicitly
// labeled as such -- never "current price", never recomputed against
// today's OpenRouter pricing), the conservative admission reserve,
// actual/derived cost kept separately labeled, and provider/audit
// metadata. A missing field is always `Unavailable`, never `0`/`$0`.
function formatPricePerMillion(value: string | null): string {
  return value === null ? "Unavailable" : `$${value} / 1M tokens`;
}

function attemptDetailId(attempt: AttemptAudit): string {
  return `attempt-detail-${attempt.participantId}-${attempt.attemptNumber}`;
}

function AttemptDetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <Typography variant="body2">
      {label}: {value ?? "Unavailable"}
    </Typography>
  );
}

function AttemptDetailRow({ attempt }: { attempt: AttemptAudit }) {
  const [expanded, setExpanded] = useState(false);
  const detailId = attemptDetailId(attempt);
  const rowLabel = `${attempt.participantId} attempt ${attempt.attemptNumber}`;
  const cost = attemptCostDisplay(attempt);

  return (
    <>
      <TableRow>
        <TableCell sx={{ pr: 0 }}>
          <IconButton
            aria-controls={detailId}
            aria-expanded={expanded}
            // Stable label regardless of expanded state -- aria-expanded
            // alone communicates the toggle, matching PR #22's own
            // established "smallest accessible implementation" choice
            // for the Judge/Advocate Accordion affordances.
            aria-label={`View pricing detail for ${rowLabel}`}
            onClick={() => setExpanded((current) => !current)}
            size="small"
            sx={{
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.15s"
            }}
          >
            <AccordionExpandIcon />
          </IconButton>
        </TableCell>
        <TableCell>{attempt.participantId}</TableCell>
        <TableCell>{attempt.attemptNumber}</TableCell>
        <TableCell>{attempt.configuredModelId}</TableCell>
        <TableCell>{formatTokenCount(attempt.inputTokens)}</TableCell>
        <TableCell>{formatTokenCount(attempt.outputTokens)}</TableCell>
        <TableCell>{formatTokenCount(attempt.totalTokens)}</TableCell>
        <TableCell>
          {cost.text}
          {cost.source ? (
            <Typography color="text.secondary" component="span" sx={{ ml: 0.5 }} variant="caption">
              ({cost.source})
            </Typography>
          ) : null}
        </TableCell>
        <TableCell>{formatLatency(attempt.latencyMs)}</TableCell>
        <TableCell>{attempt.status}</TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={10} sx={{ border: expanded ? undefined : "none", p: 0 }}>
          <Collapse in={expanded} unmountOnExit={false}>
            <Box id={detailId} sx={{ p: 2 }}>
              <Stack spacing={2} sx={{ whiteSpace: "normal" }}>
                <Stack spacing={0.5}>
                  <Typography sx={{ fontWeight: 800 }} variant="body2">
                    Model / routing
                  </Typography>
                  <AttemptDetailField label="Configured model" value={attempt.configuredModelId} />
                  <AttemptDetailField label="Canonical model" value={attempt.canonicalModelId} />
                  <AttemptDetailField label="Provider endpoint" value={attempt.providerEndpointTag} />
                  <AttemptDetailField label="Prompt version" value={attempt.promptVersion} />
                </Stack>
                <Stack spacing={0.5}>
                  <Typography sx={{ fontWeight: 800 }} variant="body2">
                    Historical pricing snapshot
                  </Typography>
                  <Typography color="text.secondary" variant="caption">
                    Prices recorded when this attempt was authorized -- never today's current price.
                  </Typography>
                  <AttemptDetailField label="Input price" value={formatPricePerMillion(attempt.inputPricePerMillion)} />
                  <AttemptDetailField
                    label="Output price"
                    value={formatPricePerMillion(attempt.outputPricePerMillion)}
                  />
                  <AttemptDetailField label="Request fee" value={formatCostUsd(attempt.requestPriceUsd)} />
                  <AttemptDetailField label="Pricing observed at" value={attempt.pricingObservedAt} />
                </Stack>
                <Stack spacing={0.5}>
                  <Typography sx={{ fontWeight: 800 }} variant="body2">
                    Authorization
                  </Typography>
                  <AttemptDetailField
                    label="Conservative participant reserve"
                    value={formatCostUsd(attempt.conservativeMaxCostUsd)}
                  />
                </Stack>
                <Stack spacing={0.5}>
                  <Typography sx={{ fontWeight: 800 }} variant="body2">
                    Cost audit
                  </Typography>
                  <AttemptDetailField label="Actual provider cost" value={formatCostUsd(attempt.actualCostUsd)} />
                  <AttemptDetailField label="Derived comparison" value={formatCostUsd(attempt.derivedCostUsd)} />
                </Stack>
                <Stack spacing={0.5}>
                  <Typography sx={{ fontWeight: 800 }} variant="body2">
                    Provider / audit metadata
                  </Typography>
                  <AttemptDetailField label="Provider request ID" value={attempt.providerRequestId} />
                  <AttemptDetailField label="Error category" value={attempt.errorCategory} />
                  <AttemptDetailField label="Error message" value={attempt.errorMessage} />
                  <AttemptDetailField label="Started at" value={attempt.startedAt} />
                  <AttemptDetailField label="Completed at" value={attempt.completedAt} />
                </Stack>
              </Stack>
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

function EconomicsAuditAccordion({ run }: { run: StoredRun }) {
  return (
    <Accordion>
      <AccordionSummary expandIcon={<AccordionExpandIcon />}>
        <Stack spacing={0.25}>
          <Typography sx={{ fontWeight: 800 }}>Economics / Audit details</Typography>
          <Typography color="text.secondary" variant="caption">
            View attempt-level detail
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={3}>
          <TableContainer sx={{ maxWidth: "100%", overflowX: "auto" }}>
            <Table aria-label="Model call attempt audit" sx={{ minWidth: 900, whiteSpace: "nowrap" }}>
              <TableHead>
                <TableRow>
                  <TableCell aria-label="Detail" />
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
                {run.attempts.map((attempt) => (
                  <AttemptDetailRow key={`${attempt.participantId}-${attempt.attemptNumber}`} attempt={attempt} />
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <AdmissionBudgetSafety admission={run.admission} />
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

// Milestone 10 (Issue #23 Sec 11): a readable resolved protocol view --
// the persisted protocol_json plus its referenced Charge Sheet/
// reasonings/economics, assembled server-side (protocolResolution.ts).
// Never a raw JSON dump; never present for a non-COMPLETED run or a
// protocol that failed validation/consistency checks.
function ProtocolAccordion({ protocol }: { protocol: StoredRun["protocol"] }) {
  if (!protocol) {
    return null;
  }

  return (
    <Accordion>
      <AccordionSummary expandIcon={<AccordionExpandIcon />}>
        <Stack spacing={0.25}>
          <Typography sx={{ fontWeight: 800 }}>Protocol</Typography>
          <Typography color="text.secondary" variant="caption">
            View full protocol
          </Typography>
        </Stack>
      </AccordionSummary>
      <AccordionDetails>
        <Stack spacing={3}>
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 800 }} variant="body2">
              Charge Sheet
            </Typography>
            <Typography variant="body2">Defendant: {protocol.chargeSheet.defendant}</Typography>
            <Typography variant="body2">Act: {protocol.chargeSheet.act}</Typography>
            <Typography variant="body2">Exact Question: {protocol.chargeSheet.exactQuestion}</Typography>
          </Stack>
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 800 }} variant="body2">
              Run
            </Typography>
            <Typography variant="body2">Protocol schema: {protocol.schemaVersion}</Typography>
            <Typography variant="body2">Execution mode: {protocol.executionMode}</Typography>
            <Typography color={verdictColor(protocol.majorityVerdict)} variant="body2">
              Deterministic majority: {protocol.majorityVerdict}
            </Typography>
          </Stack>
          <Stack spacing={1}>
            <Typography sx={{ fontWeight: 800 }} variant="body2">
              Frozen Participants
            </Typography>
            {/* Corrected (final source re-review, "Frozen Participant
               Micro-Correction"): the readable Full Protocol must expose
               the complete human-configured participant context, not
               only identity/model/prompt version -- profile name (when
               set) and personality too. One small bordered block per
               participant keeps long personality text readable rather
               than squeezed into a single inline sentence. */}
            {protocol.participants.map((entry) => (
              <Stack
                key={entry.participantId}
                spacing={0.25}
                sx={{ border: "1px solid", borderColor: "divider", borderRadius: 2, p: 1.5 }}
              >
                <Typography sx={{ fontWeight: 700 }} variant="body2">
                  {entry.participantId} -- {entry.role}
                  {entry.side ? ` (${entry.side})` : ""}
                </Typography>
                {entry.profileName ? (
                  <Typography variant="body2">Profile: {entry.profileName}</Typography>
                ) : null}
                <Typography variant="body2">Personality: {entry.personality}</Typography>
                <Typography variant="body2">Model: {entry.modelId}</Typography>
                <Typography variant="body2">Prompt version: {entry.promptVersion}</Typography>
              </Stack>
            ))}
          </Stack>
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 800 }} variant="body2">
              Advocates
            </Typography>
            {protocol.advocates.map((entry) => (
              <Typography key={entry.participantId} variant="body2">
                {entry.participantId} ({entry.side}): {entry.speech}
              </Typography>
            ))}
          </Stack>
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 800 }} variant="body2">
              Judges
            </Typography>
            {protocol.judges.map((entry) => (
              <Typography key={entry.participantId} variant="body2">
                {entry.participantId} ({entry.verdict}): {entry.reasoning}
              </Typography>
            ))}
          </Stack>
          <Stack spacing={0.5}>
            <Typography sx={{ fontWeight: 800 }} variant="body2">
              Economics reference
            </Typography>
            <Typography variant="body2">
              {protocol.economics.logicalCallCount} logical calls &middot; {protocol.economics.providerAttemptCount}{" "}
              attempts &middot; {formatTokenCount(protocol.economics.totalTokens)} tokens &middot;{" "}
              {formatCostUsd(protocol.economics.totalCostUsd)}
            </Typography>
            <Typography color="text.secondary" variant="caption">
              See Economics / Audit details above for the full per-attempt breakdown.
            </Typography>
          </Stack>
        </Stack>
      </AccordionDetails>
    </Accordion>
  );
}

// Milestone 10 (Issue #23 Finding 2): honest partial-spend disclosure on
// a FAILED run. A single line only when every incurred attempt's cost is
// known; an explicit known/unavailable split when it is not; nothing at
// all when zero provider attempts occurred (BLOCKED_BUDGET is handled
// separately and never reaches this component -- see docs/ui-spec.md
// Sec 13).
function PartialSpendNotice({ partialSpend }: { partialSpend: StoredRun["partialSpend"] }) {
  if (!partialSpend) {
    return null;
  }

  if (!partialSpend.hasUnknownCost) {
    return (
      <Typography color="text.secondary" variant="body2">
        Partial model cost so far: ${partialSpend.knownCostUsd}
      </Typography>
    );
  }

  return (
    <Stack spacing={0.5}>
      <Typography color="text.secondary" variant="body2">
        Known partial model cost: ${partialSpend.knownCostUsd}
      </Typography>
      <Typography color="text.secondary" variant="body2">
        Additional attempt cost: Unavailable
      </Typography>
    </Stack>
  );
}
