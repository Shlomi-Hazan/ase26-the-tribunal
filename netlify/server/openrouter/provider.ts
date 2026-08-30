// Milestone 7 -- the one server-only OpenRouter provider boundary
// (ADR Decision 1). One real fetch-based implementation, one deterministic
// fake (fakeProvider.ts). OpenRouter remains the only V1 gateway -- no
// generic multi-provider framework is introduced.
//
// IMPORTANT (Section 8 of the M7 implementation task): this module
// IMPLEMENTS createChatCompletion for future Milestone 8 consumption. No
// M7 application code path (preflight, model discovery) ever calls it.
// Every automated M7 test injects the fake provider or a mocked `fetch` --
// see errors thrown by RealOpenRouterProvider are never exercised against
// the real network in this task.

import {
  chatCompletionResponseSchema,
  endpointListResponseSchema,
  modelListResponseSchema,
  providerPreferencesSchema,
  type ProviderPreferences,
  type RawChatCompletionResponse,
  type RawOpenRouterEndpoint,
  type RawOpenRouterModel
} from "./schemas";
import { normalizeHttpFailure, ProviderError } from "./errors";
import type { OpenRouterServerConfig } from "../env";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Locked ceiling (ADR Decision 6 / docs/economics.md Sec 10): a single
// provider attempt never runs longer than this.
export const PROVIDER_ATTEMPT_TIMEOUT_MS = 60_000;

export type ProviderChatRequest = {
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  max_completion_tokens: number;
  response_format?: {
    type: "json_schema";
    json_schema: { name: string; strict: true; schema: Record<string, unknown> };
  };
  // M8 live-gate root-cause correction (Issue #17): OpenRouter's unified
  // reasoning-control parameter, sent only for an exact endpoint proven
  // (via ResolvedModelRoute.supportsReasoningControl) to support it --
  // never a broader shape than the one conservative V1 policy this
  // application actually sends (see executionRequest.ts), so this stays a
  // narrow literal type rather than an open-ended `unknown`/passthrough.
  reasoning?: { effort: "minimal"; exclude: true };
  provider?: ProviderPreferences;
};

export type ProviderChatResult = {
  raw: RawChatCompletionResponse;
};

export interface OpenRouterProvider {
  listModels(): Promise<RawOpenRouterModel[]>;
  listEndpoints(author: string, slug: string): Promise<RawOpenRouterEndpoint[]>;
  createChatCompletion(request: ProviderChatRequest): Promise<ProviderChatResult>;
}

export type FetchLike = typeof fetch;

export class RealOpenRouterProvider implements OpenRouterProvider {
  constructor(
    private readonly config: OpenRouterServerConfig,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly timeoutMs: number = PROVIDER_ATTEMPT_TIMEOUT_MS
  ) {}

  async listModels(): Promise<RawOpenRouterModel[]> {
    const payload = await this.request("GET", "/models");
    const result = modelListResponseSchema.safeParse(payload);

    if (!result.success) {
      throw normalizeHttpFailure(null, "invalid_response");
    }

    return result.data.data;
  }

  async listEndpoints(
    author: string,
    slug: string
  ): Promise<RawOpenRouterEndpoint[]> {
    const payload = await this.request(
      "GET",
      `/models/${encodeURIComponent(author)}/${encodeURIComponent(slug)}/endpoints`
    );
    const result = endpointListResponseSchema.safeParse(payload);

    if (!result.success) {
      throw normalizeHttpFailure(null, "invalid_response");
    }

    return result.data.data.endpoints;
  }

  // Section 8: implemented for M8's future consumption; never invoked by
  // any M7 application code path or automated test against the real API.
  async createChatCompletion(
    request: ProviderChatRequest
  ): Promise<ProviderChatResult> {
    if (request.provider) {
      const validated = providerPreferencesSchema.safeParse(request.provider);

      if (!validated.success) {
        throw new ProviderError(
          "INVALID_PROVIDER_REQUEST",
          "Provider preferences failed validation."
        );
      }
    }

    const payload = await this.request("POST", "/chat/completions", request);
    const result = chatCompletionResponseSchema.safeParse(payload);

    if (!result.success) {
      throw normalizeHttpFailure(null, "invalid_response");
    }

    return { raw: result.data };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: unknown
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      let response: Response;

      try {
        response = await this.fetchImpl(`${OPENROUTER_BASE_URL}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.config.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          throw normalizeHttpFailure(null, "timeout");
        }

        throw normalizeHttpFailure(null, "network");
      }

      if (!response.ok) {
        throw normalizeHttpFailure(response.status, "http");
      }

      try {
        return await response.json();
      } catch {
        throw normalizeHttpFailure(response.status, "invalid_response");
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
