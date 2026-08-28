// Milestone 7A -- deterministic in-memory ExtractionRepository fake for
// tests (ADR 0004 Decision 15). Reproduces the real RPCs' atomic-claim,
// idempotency-conflict, and stale-claim-reconciliation semantics
// synchronously (no real database, no real race window) -- every
// automated M7A test injects this instead of SupabaseExtractionRepository.

import type { ExtractionAttemptStatus } from "./errors";
import { STALE_EXTRACTION_CLAIM_AFTER_MS } from "./constants";
import {
  ExtractionIdempotencyConflictError,
  type BlockInput,
  type ClaimAttemptOneInput,
  type ClaimAttemptTwoInput,
  type ClaimResult,
  type ExtractionRepository,
  type SetupExtractionAttemptRow,
  type SetupExtractionRow,
  type TerminalizeInput
} from "./repository";

const RETRYABLE_ATTEMPT_ONE_STATUSES: ReadonlySet<string> = new Set([
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "INVALID_STRUCTURED_OUTPUT",
  "UNKNOWN_OUTCOME"
]);

export class FakeExtractionRepository implements ExtractionRepository {
  extractions = new Map<string, SetupExtractionRow>();
  attempts = new Map<string, SetupExtractionAttemptRow>(); // key: `${extractionId}:${attemptNumber}`

  constructor(private readonly clock: () => number = Date.now) {}

  private attemptKey(extractionId: string, attemptNumber: 1 | 2) {
    return `${extractionId}:${attemptNumber}`;
  }

  private reconcileStale(extractionId: string, attemptNumber: 1 | 2) {
    const key = this.attemptKey(extractionId, attemptNumber);
    const attempt = this.attempts.get(key);

    if (!attempt || attempt.status !== "CLAIMED") {
      return;
    }

    const createdAtMs = new Date(attempt.createdAt).getTime();

    if (this.clock() - createdAtMs >= STALE_EXTRACTION_CLAIM_AFTER_MS) {
      this.attempts.set(key, {
        ...attempt,
        status: "UNKNOWN_OUTCOME",
        completedAt: new Date(this.clock()).toISOString()
      });
    }
  }

  async getExtraction(extractionId: string): Promise<SetupExtractionRow | null> {
    return this.extractions.get(extractionId) ?? null;
  }

  async getAttempt(
    extractionId: string,
    attemptNumber: 1 | 2
  ): Promise<SetupExtractionAttemptRow | null> {
    this.reconcileStale(extractionId, attemptNumber);

    return this.attempts.get(this.attemptKey(extractionId, attemptNumber)) ?? null;
  }

  async claimAttemptOne(input: ClaimAttemptOneInput): Promise<ClaimResult> {
    let extraction = this.extractions.get(input.extractionId);

    if (!extraction) {
      extraction = {
        id: input.extractionId,
        requestFingerprint: input.requestFingerprint,
        promptVersion: input.promptVersion,
        configuredModelId: input.configuredModelId,
        finalStatus: null,
        createdAt: new Date(this.clock()).toISOString(),
        completedAt: null
      };
      this.extractions.set(input.extractionId, extraction);
    }

    this.reconcileStale(input.extractionId, 1);

    if (extraction.requestFingerprint !== input.requestFingerprint) {
      throw new ExtractionIdempotencyConflictError();
    }

    const key = this.attemptKey(input.extractionId, 1);
    const existing = this.attempts.get(key);

    if (existing) {
      return { wonClaim: false, attemptStatus: existing.status };
    }

    const attemptId = `attempt-${input.extractionId}-1`;

    this.attempts.set(key, {
      id: attemptId,
      extractionRequestId: input.extractionId,
      attemptNumber: 1,
      status: "CLAIMED",
      canonicalModelId: input.canonicalModelId,
      providerEndpointTag: input.providerEndpointTag,
      conservativeMaxCostUsd: input.conservativeMaxCostUsd,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostUsd: null,
      latencyMs: null,
      providerRequestId: null,
      errorCode: null,
      validatedResult: null,
      createdAt: new Date(this.clock()).toISOString(),
      completedAt: null
    });

    return { wonClaim: true, attemptId };
  }

  async claimAttemptTwo(input: ClaimAttemptTwoInput): Promise<ClaimResult> {
    const extraction = this.extractions.get(input.extractionId);

    if (!extraction) {
      return { wonClaim: false, attemptStatus: null, blockReason: "NOT_FOUND" };
    }

    if (extraction.requestFingerprint !== input.requestFingerprint) {
      throw new ExtractionIdempotencyConflictError();
    }

    this.reconcileStale(input.extractionId, 1);

    const attemptOne = this.attempts.get(this.attemptKey(input.extractionId, 1));

    if (!attemptOne || attemptOne.status === "CLAIMED") {
      return { wonClaim: false, attemptStatus: null, blockReason: "ATTEMPT_ONE_NOT_TERMINAL" };
    }

    if (!RETRYABLE_ATTEMPT_ONE_STATUSES.has(attemptOne.status)) {
      return { wonClaim: false, attemptStatus: null, blockReason: "ATTEMPT_ONE_NOT_RETRYABLE" };
    }

    const key = this.attemptKey(input.extractionId, 2);
    const existingTwo = this.attempts.get(key);

    if (existingTwo) {
      return {
        wonClaim: false,
        attemptStatus: existingTwo.status,
        blockReason: "ALREADY_CLAIMED_OR_TERMINAL"
      };
    }

    const attemptId = `attempt-${input.extractionId}-2`;

    this.attempts.set(key, {
      id: attemptId,
      extractionRequestId: input.extractionId,
      attemptNumber: 2,
      status: "CLAIMED",
      canonicalModelId: input.canonicalModelId,
      providerEndpointTag: input.providerEndpointTag,
      conservativeMaxCostUsd: input.conservativeMaxCostUsd,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCostUsd: null,
      latencyMs: null,
      providerRequestId: null,
      errorCode: null,
      validatedResult: null,
      createdAt: new Date(this.clock()).toISOString(),
      completedAt: null
    });

    return { wonClaim: true, attemptId };
  }

  async terminalize(input: TerminalizeInput): Promise<void> {
    const key = this.attemptKey(input.extractionId, input.attemptNumber);
    const attempt = this.attempts.get(key);

    if (!attempt || attempt.status !== "CLAIMED") {
      // Late finalization after a concurrent reconciliation already
      // transitioned this row -- silently no-op (Decision 13).
      return;
    }

    this.attempts.set(key, {
      ...attempt,
      status: input.status as ExtractionAttemptStatus,
      actualInputTokens: input.actualInputTokens,
      actualOutputTokens: input.actualOutputTokens,
      actualCostUsd: input.actualCostUsd,
      latencyMs: input.latencyMs,
      providerRequestId: input.providerRequestId,
      errorCode: input.errorCode,
      validatedResult: input.validatedResult,
      completedAt: new Date(this.clock()).toISOString()
    });

    const extraction = this.extractions.get(input.extractionId);

    if (extraction) {
      this.extractions.set(input.extractionId, {
        ...extraction,
        finalStatus: input.status,
        completedAt: new Date(this.clock()).toISOString()
      });
    }
  }

  async block(input: BlockInput): Promise<void> {
    const existing = this.extractions.get(input.extractionId);

    this.extractions.set(input.extractionId, {
      id: input.extractionId,
      requestFingerprint: input.requestFingerprint,
      promptVersion: input.promptVersion,
      configuredModelId: input.configuredModelId,
      finalStatus: input.status,
      createdAt: existing?.createdAt ?? new Date(this.clock()).toISOString(),
      completedAt: new Date(this.clock()).toISOString()
    });
  }
}
