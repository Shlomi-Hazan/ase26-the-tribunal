// Milestone 12 (human product override, PR #34 Sec 19) -- the shared
// idempotent-submission primitive extracted out of useRunStart.ts so
// the Jon Snow demo's canonical submit path can reuse the exact same
// clientRequestId/semantic-snapshot duplicate-spend resistance rule
// (docs/adr/0002-participant-configuration-freeze.md Decision 8)
// without a second implementation. Generic over the request/result
// shape -- it knows nothing about Charge Sheets, participants, or the
// canonical Jon Snow preset; it owns only: mint-or-reuse the
// clientRequestId, submit/error state, and calling the injected submit
// function. It owns neither routing nor SetupProvider.
import { useRef, useState } from "react";
import { RunApiError } from "../../services/runApi";

export type UseIdempotentStartResult<TInput, TResult> = {
  isSubmitting: boolean;
  error: string;
  start: (input: TInput) => Promise<TResult | null>;
};

export function useIdempotentStart<TInput, TResult>(
  submit: (clientRequestId: string, input: TInput) => Promise<TResult>
): UseIdempotentStartResult<TInput, TResult> {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const clientRequestIdRef = useRef<string | null>(null);
  const snapshotRef = useRef<string | null>(null);

  async function start(input: TInput): Promise<TResult | null> {
    const snapshot = JSON.stringify(input);

    // Reuse the existing client_request_id only while the semantic
    // submission is unchanged from the last attempt; a materially
    // edited resubmission gets a fresh key rather than reusing one that
    // would now describe different data under the old identity.
    if (!clientRequestIdRef.current || snapshotRef.current !== snapshot) {
      clientRequestIdRef.current = crypto.randomUUID();
      snapshotRef.current = snapshot;
    }

    setError("");
    setIsSubmitting(true);

    try {
      return await submit(clientRequestIdRef.current, input);
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
