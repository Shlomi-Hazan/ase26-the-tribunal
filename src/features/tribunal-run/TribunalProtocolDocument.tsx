// Milestone 14 (COMPLETED-result PDF export) -- the single canonical PDF
// document component, kept in its own component-only file (same
// Fast-Refresh-boundary convention as verdictColor.ts being split out of
// JudgeVoteGroup.tsx). Every value rendered comes from `props` (real
// run/protocol facts already resolved by RunPage's CompletedResult, or
// the shared formatters in tribunalProtocolPdf.ts), never re-derived
// here. No cryptographic/on-chain/legal-certification language anywhere
// in this document -- this is a software export, not a court record.
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { StoredRun } from "../../services/runApi";
import {
  formatCostUsdForExport,
  formatTimestampForExport,
  formatTokenCountForExport,
  formatVerdictForExport,
  formatWallClockSecondsForExport
} from "./tribunalProtocolPdf";

export type ExportJudgeVote = {
  judge: string;
  displayName?: string;
  verdict: "GUILTY" | "NOT_GUILTY";
  reasoning: string;
};

export type ExportAdvocateSpeech = {
  participantId: string;
  displayName: string;
  seatLabel: string | null;
  side: "PRO" | "CON";
  speech: string;
};

export type TribunalProtocolExportData = {
  run: StoredRun;
  majorityVerdict: "GUILTY" | "NOT_GUILTY";
  votes: ExportJudgeVote[];
  speeches: ExportAdvocateSpeech[];
};

const styles = StyleSheet.create({
  page: { color: "#24211C", fontFamily: "Helvetica", fontSize: 10, padding: 40 },
  title: { fontFamily: "Times-Roman", fontSize: 22 },
  subtitle: { color: "#6B6355", fontSize: 9, letterSpacing: 1, marginBottom: 20, marginTop: 2, textTransform: "uppercase" },
  sectionHeading: {
    borderBottomColor: "#E4D9C2",
    borderBottomWidth: 1,
    fontFamily: "Times-Roman",
    fontSize: 13,
    marginBottom: 8,
    marginTop: 18,
    paddingBottom: 4
  },
  label: { color: "#6B6355", fontFamily: "Helvetica-Bold", fontSize: 9 },
  value: { fontSize: 10, marginBottom: 4 },
  verdict: { color: "#3F6E4E", fontFamily: "Times-Roman", fontSize: 24, marginVertical: 4 },
  verdictGuilty: { color: "#A23B2E" },
  item: { marginBottom: 10 },
  itemHeading: { fontFamily: "Helvetica-Bold", fontSize: 10, marginBottom: 1 },
  itemMeta: { color: "#6B6355", fontSize: 8, marginBottom: 3 },
  bodyText: { fontSize: 9, lineHeight: 1.4 },
  footer: { bottom: 24, color: "#6B6355", fontSize: 8, left: 40, position: "absolute", right: 40, textAlign: "center" },
  disclaimer: { color: "#6B6355", fontSize: 8, marginTop: 4 }
});

export function TribunalProtocolDocument({ run, majorityVerdict, votes, speeches }: TribunalProtocolExportData) {
  const defendant = run.protocol?.chargeSheet.defendant;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>The Tribunal</Text>
        <Text style={styles.subtitle}>Final Protocol</Text>

        <Text style={styles.sectionHeading}>Tribunal Record</Text>
        {defendant ? (
          <Text style={styles.value}>
            <Text style={styles.label}>Case: </Text>
            {defendant}
          </Text>
        ) : null}
        <Text style={styles.value}>
          <Text style={styles.label}>Run ID: </Text>
          {run.id}
        </Text>
        <Text style={styles.value}>
          <Text style={styles.label}>Execution mode: </Text>
          {run.executionMode === "shared" ? "Shared Model" : "Separate Models"}
        </Text>
        {run.completedAt ? (
          <Text style={styles.value}>
            <Text style={styles.label}>Completed: </Text>
            {formatTimestampForExport(run.completedAt)}
          </Text>
        ) : null}
        <Text style={styles.value}>
          <Text style={styles.label}>Runtime: </Text>
          {formatWallClockSecondsForExport(run.wallClockMs)}
        </Text>

        <Text style={styles.sectionHeading}>Final Verdict</Text>
        <Text style={[styles.verdict, majorityVerdict === "GUILTY" ? styles.verdictGuilty : undefined]}>
          {formatVerdictForExport(majorityVerdict)}
        </Text>
        <Text style={styles.bodyText}>Deterministic majority of the three judge votes -- real model execution.</Text>

        <Text style={styles.sectionHeading}>Judge Votes</Text>
        {votes.map((vote) => (
          <View key={vote.judge} style={styles.item}>
            <Text style={styles.itemHeading}>{vote.displayName ?? vote.judge}</Text>
            {vote.displayName ? <Text style={styles.itemMeta}>{vote.judge}</Text> : null}
            <Text style={styles.bodyText}>Verdict: {formatVerdictForExport(vote.verdict)}</Text>
          </View>
        ))}

        <Text style={styles.sectionHeading}>Advocate Speeches</Text>
        {speeches.map((speech) => (
          <View key={speech.participantId} style={styles.item}>
            <Text style={styles.itemHeading}>{speech.displayName}</Text>
            <Text style={styles.itemMeta}>
              {speech.seatLabel ? `${speech.seatLabel} -- ${speech.side}` : speech.side}
            </Text>
            <Text style={styles.bodyText}>{speech.speech}</Text>
          </View>
        ))}

        <Text style={styles.sectionHeading}>Judicial Reasoning</Text>
        {votes.map((vote) => (
          <View key={`reasoning-${vote.judge}`} style={styles.item}>
            <Text style={styles.itemHeading}>{vote.displayName ?? vote.judge}</Text>
            {vote.displayName ? <Text style={styles.itemMeta}>{vote.judge}</Text> : null}
            <Text style={styles.bodyText}>Verdict: {formatVerdictForExport(vote.verdict)}</Text>
            <Text style={styles.bodyText}>{vote.reasoning}</Text>
          </View>
        ))}

        <Text style={styles.sectionHeading}>Economics Summary</Text>
        <Text style={styles.value}>Logical calls: {run.logicalCallCount}</Text>
        <Text style={styles.value}>Provider attempts: {run.providerAttemptCount}</Text>
        <Text style={styles.value}>Input tokens: {formatTokenCountForExport(run.totalInputTokens)}</Text>
        <Text style={styles.value}>Output tokens: {formatTokenCountForExport(run.totalOutputTokens)}</Text>
        <Text style={styles.value}>Total tokens: {formatTokenCountForExport(run.totalTokens)}</Text>
        <Text style={styles.value}>Total cost: {formatCostUsdForExport(run.totalCostUsd)}</Text>
        <Text style={styles.value}>Wall clock: {formatWallClockSecondsForExport(run.wallClockMs)}</Text>

        {run.protocol ? (
          <>
            <Text style={styles.sectionHeading}>Protocol Reference</Text>
            <Text style={styles.value}>Protocol schema: {run.protocol.schemaVersion}</Text>
            <Text style={styles.value}>Execution mode: {run.protocol.executionMode}</Text>
            <Text style={styles.value}>
              Deterministic majority: {formatVerdictForExport(run.protocol.majorityVerdict)}
            </Text>
          </>
        ) : null}

        <Text style={styles.disclaimer}>
          Generated by The Tribunal, an educational AI deliberation product. This is a software
          export, not an official legal or court document.
        </Text>

        <Text
          fixed
          render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          style={styles.footer}
        />
      </Page>
    </Document>
  );
}
