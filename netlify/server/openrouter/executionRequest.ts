// Milestone 7 -- future execution route contract (ADR Decision 6).
// M7 does not execute; this module implements/tests the request
// construction contract M8 will consume so route pinning is never
// silently loosened later. Never invoked against the real network by any
// M7 code path -- only exercised with the fake provider / mocked
// transport in tests.

import type { ProviderChatRequest } from "./provider";
import type { ResolvedModelRoute } from "./routeResolution";
import { toDecimalString } from "./pricing";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type StructuredOutputSchema = {
  name: string;
  schema: Record<string, unknown>;
};

// Builds the exact future completion request for an already-resolved,
// already-proven-uniquely-pinnable route. `provider.order` is the primary
// pin (matching OpenRouter's own documented exact-endpoint-pin example,
// `order: ['deepinfra/turbo'], allowFallbacks: false`); `provider.only` is
// set to the same tag as an additional restriction, never the sole claim
// of an exact pin.
export function buildFutureCompletionRequest(params: {
  route: ResolvedModelRoute;
  messages: ChatMessage[];
  maxCompletionTokens: number;
  structuredOutput: StructuredOutputSchema;
}): ProviderChatRequest {
  const { route, messages, maxCompletionTokens, structuredOutput } = params;

  // Defense in depth: ResolvedModelRoute's own type guarantees
  // isUniquelyPinnable is always `true` (a not-uniquely-pinnable endpoint
  // never becomes a ResolvedModelRoute -- see routeResolution.ts), but the
  // routing slug used for execution is re-asserted here rather than
  // trusted implicitly, so a future refactor that ever widens the type
  // cannot silently start pinning an unproven tag.
  if (!route.isUniquelyPinnable) {
    throw new Error(
      "Refusing to build a completion request for a route that was not proven uniquely pinnable."
    );
  }

  return {
    model: route.canonicalModelId,
    messages,
    max_completion_tokens: maxCompletionTokens,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: structuredOutput.name,
        strict: true,
        schema: structuredOutput.schema
      }
    },
    provider: {
      order: [route.providerEndpointTag],
      only: [route.providerEndpointTag],
      allow_fallbacks: false,
      require_parameters: true,
      // Correction (independent review, pre-live gate): reverified
      // against the current official OpenRouter OpenAPI spec --
      // ProviderPreferences.max_price.{prompt,completion,request} are
      // documented as decimal STRINGS ("USD per million prompt/
      // completion tokens" / "USD per request"), the same convention as
      // PublicPricing's own rate fields -- never a JS number. The
      // first pass called `.toNumber()` here, an unnecessary and lossy
      // conversion of an authoritative Decimal value; toDecimalString
      // (pricing.ts) serializes the exact value with no rounding
      // instead.
      //
      // This is provider-routing DEFENSE IN DEPTH, not the authoritative
      // budget control -- local preflight (preflight.ts) remains sole
      // authority for the complete Tribunal economics, including
      // cache-write exposure via effectiveInputPricePerToken. Setting
      // max_price.prompt to the exact accepted effectiveInputPricePerToken
      // (never the raw, possibly-lower promptPricePerToken) means this
      // ceiling can never itself accept a request preflight would have
      // rejected -- it can only ever reject a request whose real-time
      // provider price has drifted upward since preflight observed it,
      // never accept one preflight's own bound already excludes.
      max_price: {
        prompt: toDecimalString(route.pricing.effectiveInputPricePerToken.times(1_000_000)),
        completion: toDecimalString(route.pricing.completionPricePerToken.times(1_000_000)),
        // Included consistently, even when zero, matching the documented
        // schema shape and keeping the contract simple/testable rather
        // than conditionally omitting it only when a request fee exists.
        request: toDecimalString(route.pricing.requestPriceUsd)
      }
    }
  };
}
