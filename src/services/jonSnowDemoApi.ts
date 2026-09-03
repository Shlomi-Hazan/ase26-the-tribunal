// Milestone 12 (human product override, PR #34) -- the client caller for
// the dedicated, operator-funded, canonical-only demo endpoint. Reuses
// runApi.ts's exact response envelope/error handling (parseRunPayload,
// RunApiError, ConveneResult) -- both endpoints return the identical
// shape, so there is no second parsing implementation.
import { withJonSnowDemoAccessHeader } from "./jonSnowDemoAccess";
import { parseRunPayload, type ConveneResult } from "./runApi";

export type ConveneJonSnowDemoRequest = {
  clientRequestId: string;
  modelId: string;
};

// The only two fields the client may ever influence for the canonical
// demo -- the server independently re-verifies modelId eligibility/
// price and owns every other field (Charge Sheet, participants, seat
// mapping, execution mode) itself (netlify/server/tribunal/
// jonSnowDemoRun.ts).
export async function conveneJonSnowDemo(
  request: ConveneJonSnowDemoRequest
): Promise<ConveneResult> {
  const response = await fetch("/api/demo/jon-snow/runs", {
    method: "POST",
    headers: withJonSnowDemoAccessHeader({
      "content-type": "application/json"
    }),
    body: JSON.stringify(request)
  });

  const payload = await parseRunPayload(response);

  return { run: payload.run, executionTriggered: Boolean(payload.executionTriggered) };
}
