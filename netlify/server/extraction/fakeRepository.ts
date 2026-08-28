// Milestone 7A -- deterministic in-memory ExtractionRepository fake for
// tests (ADR 0004 Decision 15). Reproduces the real RPCs' atomic-claim,
// idempotency-conflict, retry-budget-guard, and stale-claim-
// reconciliation semantics synchronously (no real database, no real race
// window) -- every automated M7A test injects this instead of
// SupabaseExtractionRepository. Kept in parity with
// supabase/migrations/20260828180000_setup_extractions.sql's actual SQL
// -- independent pre-live audit, Section 3/19 -- so this fake is never
// "more lenient" than what the real RPCs enforce.

import Decimal from "decimal.js";
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
  private readonly admissionEvents = new Map<string, number[]>(); // bucket -> timestamps

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

  // Mirrors reconcile_setup_extraction_attempts (Section 9): reconciles
  // BOTH attempt slots for this id, callable from a plain read/replay
  // path, not only from inside a claim attempt.
  async reconcileAttempts(extractionId: string): Promise<void> {
    this.reconcileStale(extractionId, 1);
    this.reconcileStale(extractionId, 2);
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
      conservativeMaxCostUsd: input.perAttemptConservativeMaxCostUsd,
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

    // Authoritative retry-budget guard, mirroring
    // claim_setup_extraction_attempt_two's SQL exactly (Section 3):
    // GREATEST(COALESCE(actual, conservative), conservative) + attempt2
    // per-attempt conservative maximum <= hard ceiling.
    const attempt1Debit = Decimal.max(
      new Decimal(attemptOne.actualCostUsd ?? attemptOne.conservativeMaxCostUsd),
      new Decimal(attemptOne.conservativeMaxCostUsd)
    );
    const totalDebit = attempt1Debit.plus(new Decimal(input.perAttemptConservativeMaxCostUsd));

    if (totalDebit.gt(new Decimal(input.hardCeilingUsd))) {
      return { wonClaim: false, attemptStatus: null, blockReason: "BLOCKED_BUDGET" };
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
      conservativeMaxCostUsd: input.perAttemptConservativeMaxCostUsd,
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

  // Corrected this pass (independent pre-live audit, Section 12):
  // mirrors block_setup_extraction's SQL exactly -- a genuinely new id
  // is created unconditionally; an EXISTING id is only updated
  // idempotently if its stored semantic identity (fingerprint,
  // prompt_version, configured_model_id) matches exactly, otherwise this
  // throws ExtractionIdempotencyConflictError and mutates nothing. A
  // concurrent different request can never overwrite another logical
  // extraction's terminal state merely by reusing its UUID.
  async block(input: BlockInput): Promise<void> {
    const existing = this.extractions.get(input.extractionId);

    if (!existing) {
      this.extractions.set(input.extractionId, {
        id: input.extractionId,
        requestFingerprint: input.requestFingerprint,
        promptVersion: input.promptVersion,
        configuredModelId: input.configuredModelId,
        finalStatus: input.status,
        createdAt: new Date(this.clock()).toISOString(),
        completedAt: new Date(this.clock()).toISOString()
      });
      return;
    }

    if (
      existing.requestFingerprint !== input.requestFingerprint ||
      existing.promptVersion !== input.promptVersion ||
      existing.configuredModelId !== input.configuredModelId
    ) {
      throw new ExtractionIdempotencyConflictError();
    }

    this.extractions.set(input.extractionId, {
      ...existing,
      finalStatus: input.status,
      completedAt: new Date(this.clock()).toISOString()
    });
  }

  // In-memory analogue of check_and_record_admission (Section 4) --
  // real production admission control uses the Supabase-backed RPC
  // (SupabaseExtractionRepository); this fake exists only so tests never
  // need a real database. Same sliding-window semantics as
  // netlify/server/extraction/rateLimit.ts's SlidingWindowRateLimiter.
  async checkAndRecordAdmission(
    bucket: string,
    windowSeconds: number,
    maxRequests: number
  ): Promise<boolean> {
    const now = this.clock();
    const windowStart = now - windowSeconds * 1000;
    const existing = (this.admissionEvents.get(bucket) ?? []).filter(
      (timestamp) => timestamp > windowStart
    );

    if (existing.length >= maxRequests) {
      this.admissionEvents.set(bucket, existing);
      return false;
    }

    existing.push(now);
    this.admissionEvents.set(bucket, existing);

    return true;
  }
}
