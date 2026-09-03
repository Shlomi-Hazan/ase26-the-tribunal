// Milestone 12 (human product override, PR #34 Sec 19) -- the Jon Snow
// demo's own submit path, reusing the SAME useIdempotentStart primitive
// useRunStart.ts uses (same clientRequestId/semantic-snapshot duplicate-
// spend resistance rule), calling the dedicated canonical demo endpoint
// (conveneJonSnowDemo) instead of the generic convene(). Used by both
// Home's one-click primary action and the Modify settings/models page,
// so both share one submission/idempotency implementation.
import { conveneJonSnowDemo } from "../../services/jonSnowDemoApi";
import type { ConveneResult } from "../../services/runApi";
import { useIdempotentStart } from "./useIdempotentStart";

export type UseJonSnowDemoStartResult = {
  isSubmitting: boolean;
  error: string;
  start: (modelId: string) => Promise<ConveneResult | null>;
};

type JonSnowDemoStartInput = {
  modelId: string;
};

export function useJonSnowDemoStart(): UseJonSnowDemoStartResult {
  const { isSubmitting, error, start: startIdempotent } = useIdempotentStart<
    JonSnowDemoStartInput,
    ConveneResult
  >((clientRequestId, input) => conveneJonSnowDemo({ clientRequestId, modelId: input.modelId }));

  async function start(modelId: string): Promise<ConveneResult | null> {
    return startIdempotent({ modelId });
  }

  return { isSubmitting, error, start };
}
