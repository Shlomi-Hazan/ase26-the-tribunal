// Milestone 7A -- deterministic fake OpenRouterProvider that CAN return a
// configurable createChatCompletion result (ADR 0004 Decision 8/23/34).
// Distinct from M7's FakeOpenRouterProvider (fakeProvider.ts), which
// deliberately throws on createChatCompletion since no M7 application
// code path ever calls it -- M7A's extraction call genuinely does call
// createChatCompletion, so its test double must be able to return a
// configured result. Every automated M7A test injects this (or a mocked
// fetch) instead of RealOpenRouterProvider -- no automated test reaches
// the real network.

import { ProviderError } from "../openrouter/errors";
import type {
  OpenRouterProvider,
  ProviderChatRequest,
  ProviderChatResult
} from "../openrouter/provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "../openrouter/schemas";

export class FakeExtractionProvider implements OpenRouterProvider {
  listModelsResult: RawOpenRouterModel[] = [];
  listEndpointsResult: Record<string, RawOpenRouterEndpoint[]> = {};
  listModelsError: ProviderError | null = null;
  listEndpointsError: ProviderError | null = null;

  createChatCompletionResult: ProviderChatResult | null = null;
  createChatCompletionError: ProviderError | null = null;
  // Optional hook for tests that need to observe/mutate behavior per call
  // (e.g. simulating a slow provider for deadline tests) without
  // subclassing.
  onCreateChatCompletion: ((request: ProviderChatRequest) => Promise<void>) | null =
    null;

  listModelsCallCount = 0;
  listEndpointsCallCount = 0;
  createChatCompletionCallCount = 0;
  lastChatRequest: ProviderChatRequest | null = null;

  async listModels(): Promise<RawOpenRouterModel[]> {
    this.listModelsCallCount += 1;

    if (this.listModelsError) {
      throw this.listModelsError;
    }

    return this.listModelsResult;
  }

  async listEndpoints(
    author: string,
    slug: string
  ): Promise<RawOpenRouterEndpoint[]> {
    this.listEndpointsCallCount += 1;

    if (this.listEndpointsError) {
      throw this.listEndpointsError;
    }

    return this.listEndpointsResult[`${author}/${slug}`] ?? [];
  }

  async createChatCompletion(
    request: ProviderChatRequest
  ): Promise<ProviderChatResult> {
    this.createChatCompletionCallCount += 1;
    this.lastChatRequest = request;

    if (this.onCreateChatCompletion) {
      await this.onCreateChatCompletion(request);
    }

    if (this.createChatCompletionError) {
      throw this.createChatCompletionError;
    }

    if (!this.createChatCompletionResult) {
      throw new ProviderError(
        "UNKNOWN",
        "FakeExtractionProvider.createChatCompletionResult was not configured."
      );
    }

    return this.createChatCompletionResult;
  }
}

// Builds a minimal, schema-valid RawChatCompletionResponse wrapping the
// given structured-output JSON content string -- the shape every real
// createChatCompletion caller receives back from chatCompletionResponseSchema.
export function fakeChatCompletionResult(params: {
  id?: string;
  model?: string;
  contentJson: string;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number; cost?: number };
}): ProviderChatResult {
  return {
    raw: {
      id: params.id ?? "gen-fake-extraction-1",
      model: params.model ?? "fake/extraction-model",
      choices: [
        {
          message: {
            role: "assistant",
            content: params.contentJson
          }
        }
      ],
      usage: params.usage
    }
  };
}
