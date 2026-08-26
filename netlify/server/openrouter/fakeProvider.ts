// Milestone 7 -- deterministic fake OpenRouterProvider (ADR Decision 1).
// Every normal automated test injects this (or a mocked fetch) instead of
// RealOpenRouterProvider -- no automated test reaches the real network.

import { ProviderError } from "./errors";
import type { OpenRouterProvider, ProviderChatResult } from "./provider";
import type { RawOpenRouterEndpoint, RawOpenRouterModel } from "./schemas";

export class FakeOpenRouterProvider implements OpenRouterProvider {
  listModelsResult: RawOpenRouterModel[] = [];
  listEndpointsResult: Record<string, RawOpenRouterEndpoint[]> = {};
  listModelsError: ProviderError | null = null;
  listEndpointsError: ProviderError | null = null;

  listModelsCallCount = 0;
  listEndpointsCallCount = 0;
  createChatCompletionCallCount = 0;

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

  // Intentionally never used by any M7 application code path -- present
  // only so route-construction/request-builder tests can assert
  // createChatCompletion is never invoked (Section 44 test guard). The
  // request parameter is part of the OpenRouterProvider contract but
  // unused here -- omitted rather than named-and-ignored.
  async createChatCompletion(): Promise<ProviderChatResult> {
    this.createChatCompletionCallCount += 1;

    throw new ProviderError(
      "UNKNOWN",
      "createChatCompletion must never be invoked by Milestone 7 application code."
    );
  }
}
