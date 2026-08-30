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

  // Milestone 8 -- additive, opt-in configuration for tests that DO need
  // createChatCompletion to succeed/fail deterministically (the Tribunal
  // execution worker). Both default to null, which preserves the exact
  // original M7 behavior below (always throw) for every existing test
  // that never sets them. When `createChatCompletionResults` is set, each
  // call consumes the next entry in order (supporting a test that wants
  // attempt #1 to fail and attempt #2 to succeed, for example); it falls
  // back to `createChatCompletionResult` when exhausted.
  createChatCompletionResult: ProviderChatResult | null = null;
  createChatCompletionResults: Array<ProviderChatResult | ProviderError> | null = null;
  createChatCompletionError: ProviderError | null = null;

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

  // Never used by any M7 application code path -- M7 tests rely on the
  // default (no configuration set) throwing, which is preserved exactly.
  // Milestone 8's execution worker is the first real consumer; its tests
  // configure one of the fields above first.
  async createChatCompletion(): Promise<ProviderChatResult> {
    this.createChatCompletionCallCount += 1;

    if (this.createChatCompletionResults) {
      const index = this.createChatCompletionCallCount - 1;
      const next =
        this.createChatCompletionResults[index] ??
        this.createChatCompletionResults[this.createChatCompletionResults.length - 1];

      if (next instanceof ProviderError) {
        throw next;
      }

      return next;
    }

    if (this.createChatCompletionError) {
      throw this.createChatCompletionError;
    }

    if (this.createChatCompletionResult) {
      return this.createChatCompletionResult;
    }

    throw new ProviderError(
      "UNKNOWN",
      "createChatCompletion must never be invoked by Milestone 7 application code."
    );
  }
}
