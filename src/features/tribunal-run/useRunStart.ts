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
// against that result -- see ReviewPage.tsx and JonSnowHomeCard/
// JonSnowSettingsPage.
//
// Human product override (PR #34 Sec 19): the clientRequestId/snapshot
// idempotency rule itself now lives in the shared, request-shape-generic
// useIdempotentStart primitive (useIdempotentStart.ts), reused unchanged
// by useJonSnowDemoStart below -- this hook is now a thin, unchanged-
// contract wrapper around it, so ReviewPage.tsx (the only existing
// caller) needed no further changes for this correction pass.
import {
  convene,
  type ConveneResult,
  type RunCaseRequest,
  type RunParticipantRequest
} from "../../services/runApi";
import { useIdempotentStart } from "./useIdempotentStart";

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

type GenericRunStartInput = {
  case: RunCaseRequest;
  executionMode: ExecutionMode;
  participants: RunParticipantRequest[];
};

export function useRunStart(): UseRunStartResult {
  const { isSubmitting, error, start: startIdempotent } = useIdempotentStart<
    GenericRunStartInput,
    ConveneResult
  >((clientRequestId, input) =>
    convene({
      clientRequestId,
      case: input.case,
      executionMode: input.executionMode,
      participants: input.participants
    })
  );

  async function start(
    caseRequest: RunCaseRequest,
    executionMode: ExecutionMode,
    participants: RunParticipantRequest[]
  ): Promise<ConveneResult | null> {
    return startIdempotent({ case: caseRequest, executionMode, participants });
  }

  return { isSubmitting, error, start };
}
