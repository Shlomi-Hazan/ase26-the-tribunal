// Milestone 12 -- shared run-start abstraction (Issue #32 Sec 7).
//
// Extracted from ReviewPage.tsx's handleConvene tail. Owns exactly the
// clientRequestId/semantic-snapshot idempotency rule (docs/adr/0002-
// participant-configuration-freeze.md Decision 8), the convene() call,
// and submit/error state -- byte-identical to ReviewPage's existing
// behavior before this extraction.
//
// It deliberately owns NEITHER charge-sheet/participant construction NOR
// any on-success side effect (no `recordSavedCase` dispatch, no
// navigation): the two current callers need genuinely different things
// there -- ReviewPage's `recordSavedCase` dispatch is SetupState/
// SetupProvider-specific and has no meaning for the Jon Snow demo
// launcher, and the two callers navigate to different routes on success
// (the generic `/runs/:runId` vs. the themed `/demo/jon-snow/runs/:runId`
// -- Issue #32 Sec 10). Coupling this hook to SetupProvider merely to
// keep `recordSavedCase` working, or hard-coding a single navigation
// target, would both break that requirement. Instead `start()` resolves
// to the same `ConveneResult` (`{ run, executionTriggered }`,
// src/services/runApi.ts, unchanged) that `convene()` itself already
// returns, and each caller performs its own on-success responsibility
// against that result -- see ReviewPage.tsx and JonSnowDemoPage.tsx.
import { useRef, useState } from "react";
import {
  convene,
  RunApiError,
  type ConveneResult,
  type RunCaseRequest,
  type RunParticipantRequest
} from "../../services/runApi";

export type ExecutionMode = "shared" | "separate";

export type UseRunStartResult = {
  isSubmitting: boolean;
  error: string;
  start: (
    caseRequest: RunCaseRequest,
    executionMode: ExecutionMode,
    participants: RunParticipantRequest[]
  ) => Promise<ConveneResult | null>;
};

export function useRunStart(): UseRunStartResult {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Milestone 6 client idempotency key lifecycle, unchanged by this
  // extraction: stable across a retry of the same semantic submission,
  // refreshed only when the underlying request actually changed.
  const clientRequestIdRef = useRef<string | null>(null);
  const requestSnapshotRef = useRef<string | null>(null);

  async function start(
    caseRequest: RunCaseRequest,
    executionMode: ExecutionMode,
    participants: RunParticipantRequest[]
  ): Promise<ConveneResult | null> {
    const snapshot = JSON.stringify({ case: caseRequest, executionMode, participants });

    if (!clientRequestIdRef.current || requestSnapshotRef.current !== snapshot) {
      clientRequestIdRef.current = crypto.randomUUID();
      requestSnapshotRef.current = snapshot;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const result = await convene({
        clientRequestId: clientRequestIdRef.current,
        case: caseRequest,
        executionMode,
        participants
      });

      return result;
    } catch (thrown) {
      setError(formatRunError(thrown));

      return null;
    } finally {
      setIsSubmitting(false);
    }
  }

  return { isSubmitting, error, start };
}

function formatRunError(error: unknown): string {
  if (error instanceof RunApiError) {
    if (error.status === 409) {
      return "This configuration could not be frozen because a prior request with the same submission id already produced a different result. Please try again.";
    }

    return error.errors.join(" ") || "Tribunal configuration could not be frozen.";
  }

  return "Tribunal configuration could not be frozen.";
}
