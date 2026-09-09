// Milestone 14 (COMPLETED-result PDF export, explicitly product-approved
// in this pass -- see RunPage.tsx's CompletedResult). A real, client-side
// PDF export of an already-completed, already-integrity-checked Tribunal
// run, built with @react-pdf/renderer (proper text-based, multipage PDF
// generation -- no html2canvas/screenshot rasterization). Pure logic/
// export-side-effect only, kept in its own file (not a component) so
// TribunalProtocolDocument.tsx stays a component-only Fast Refresh
// boundary. This module never re-derives, recalculates, or fabricates
// any fact -- every value formatted below is either a real StoredRun
// field or one of the already-computed `votes`/`speeches` arrays
// CompletedResult builds from the same identity-resolution rule used
// on-screen. No network/model call is made anywhere in this module -- it
// operates entirely on data already loaded into memory by RunPage's
// existing poll.
import { pdf } from "@react-pdf/renderer";
import type { StoredRun } from "../../services/runApi";
import { TribunalProtocolDocument, type TribunalProtocolExportData } from "./TribunalProtocolDocument";

export type { ExportAdvocateSpeech, ExportJudgeVote, TribunalProtocolExportData } from "./TribunalProtocolDocument";

// Same "no underscore" human-facing rule as the on-screen verdict
// (RunPage.tsx's formatVerdictDisplay) -- kept as its own small pure
// copy here rather than importing a page-local (non-exported) function,
// and independently unit-tested below.
export function formatVerdictForExport(verdict: "GUILTY" | "NOT_GUILTY"): string {
  return verdict === "NOT_GUILTY" ? "NOT GUILTY" : "GUILTY";
}

// Milestone 10 (Issue #23) convention carried into the export: a null
// numeric figure renders as the honest "Unavailable", never a
// fabricated 0.
export function formatTokenCountForExport(value: number | null): string {
  return value === null ? "Unavailable" : value.toLocaleString("en-US");
}

export function formatCostUsdForExport(value: string | null): string {
  return value === null ? "Unavailable" : `$${value}`;
}

export function formatWallClockSecondsForExport(ms: number | null): string {
  return ms === null ? "Unavailable" : `${(ms / 1000).toFixed(1)}s`;
}

export function formatTimestampForExport(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

// Milestone 14 -- a deterministic, real-run-id-based filename. `run.id`
// is always a server-issued UUID (never user-originated text), so no
// sanitization is needed or performed. Named "report" (not "protocol")
// to match the human-facing product decision: this document is a
// readable Tribunal report, not a full raw protocol/audit export.
export function buildTribunalProtocolFilename(run: StoredRun): string {
  return `tribunal-report-${run.id}.pdf`;
}

// Milestone 14 -- generates the PDF entirely client-side and returns a
// Blob. No file-system, network, or backend call. Split from the
// download side-effect below so it can be exercised/tested (or reused)
// independently of triggering a real browser download.
export async function generateTribunalProtocolPdfBlob(data: TribunalProtocolExportData): Promise<Blob> {
  return pdf(<TribunalProtocolDocument {...data} />).toBlob();
}

// Milestone 14 -- the actual browser download side-effect: build the
// Blob, create a short-lived object URL, click a detached anchor, then
// revoke the URL. Never mutates the run, never calls the run/model APIs.
export async function downloadTribunalProtocolPdf(data: TribunalProtocolExportData): Promise<void> {
  const blob = await generateTribunalProtocolPdfBlob(data);
  const url = URL.createObjectURL(blob);

  try {
    const link = document.createElement("a");

    link.href = url;
    link.download = buildTribunalProtocolFilename(data.run);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    // Deferred so the browser has a chance to start the download before
    // the object URL is revoked.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
