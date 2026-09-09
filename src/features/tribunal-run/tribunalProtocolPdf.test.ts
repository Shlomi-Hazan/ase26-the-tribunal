// Milestone 14 (COMPLETED-result PDF export) -- focused tests for the
// pure, non-rendering pieces of the export: display formatting (the
// "no underscore" human-facing verdict rule, and the existing
// "Unavailable" convention for null figures) and the deterministic
// filename builder. The actual @react-pdf/renderer document/blob
// generation is exercised via RunPage's own integration tests (see
// runPage.test.tsx), which mock this module rather than invoking the
// real PDF layout engine -- keeping these tests fast and not brittle.
import { describe, expect, it } from "vitest";
import type { StoredRun } from "../../services/runApi";
import {
  buildTribunalProtocolFilename,
  formatCostUsdForExport,
  formatTokenCountForExport,
  formatVerdictForExport,
  formatWallClockSecondsForExport
} from "./tribunalProtocolPdf";

describe("formatVerdictForExport (display-only, no underscore)", () => {
  it("renders NOT_GUILTY as 'NOT GUILTY'", () => {
    expect(formatVerdictForExport("NOT_GUILTY")).toBe("NOT GUILTY");
  });

  it("renders GUILTY unchanged", () => {
    expect(formatVerdictForExport("GUILTY")).toBe("GUILTY");
  });
});

describe("export formatters never fabricate a value for a missing field", () => {
  it("formatTokenCountForExport returns Unavailable for null, never 0", () => {
    expect(formatTokenCountForExport(null)).toBe("Unavailable");
    expect(formatTokenCountForExport(0)).toBe("0");
    expect(formatTokenCountForExport(18420)).toBe("18,420");
  });

  it("formatCostUsdForExport returns Unavailable for null, never $0", () => {
    expect(formatCostUsdForExport(null)).toBe("Unavailable");
    expect(formatCostUsdForExport("0.17")).toBe("$0.17");
  });

  it("formatWallClockSecondsForExport returns Unavailable for null", () => {
    expect(formatWallClockSecondsForExport(null)).toBe("Unavailable");
    expect(formatWallClockSecondsForExport(12800)).toBe("12.8s");
  });
});

describe("buildTribunalProtocolFilename", () => {
  it("builds a deterministic filename from the real run id only", () => {
    const run = { id: "5ebe204c-b2d3-4f25-ad1f-c6baa8e5e2e3" } as StoredRun;

    expect(buildTribunalProtocolFilename(run)).toBe(
      "tribunal-report-5ebe204c-b2d3-4f25-ad1f-c6baa8e5e2e3.pdf"
    );
  });
});
