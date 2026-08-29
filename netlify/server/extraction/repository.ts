// Milestone 7A -- Supabase repository wrapping the atomic-claim RPCs
// (ADR 0004 Decision 15). Mirrors netlify/server/runs.ts's
// SupabaseRunRepository pattern: thin, typed wrappers over `.rpc(...)`
// calls, a dedicated IdempotencyConflictError mapped from the RPC's
// `hint = 'idempotency_conflict'`, and a fakeable interface
// (ExtractionRepository) every service/test uses instead of a real
// Supabase client.

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createServerSupabaseClient } from "../supabase";
import type { ExtractionAttemptStatus } from "./errors";
import type { PackageExtractionResult } from "../../../src/schemas/packageExtraction";

export class ExtractionIdempotencyConflictError extends Error {
  constructor() {
    super("A different dossier was already submitted for this extraction request.");
    this.name = "ExtractionIdempotencyConflictError";
  }
}

// New this pass (second independent pre-live re-audit, Section 5):
// mapped from block_setup_extraction's `hint = 'attempt_already_claimed'`
// -- a pre-claim block lost a race against a concurrent request for the
// SAME logical id that already claimed (or completed) attempt #1.
// final_status was NOT overwritten; the caller must resolve through the
// normal attempt/replay state machine (loadAttemptOutcome) instead of
// returning its own now-stale pre-claim failure reason.
export class ExtractionAttemptAlreadyClaimedError extends Error {
  constructor() {
    super("An attempt was already claimed for this extraction request.");
    this.name = "ExtractionAttemptAlreadyClaimedError";
  }
}

export class ExtractionPersistenceError extends Error {
  constructor(message = "Extraction persistence failed.") {
    super(message);
    this.name = "ExtractionPersistenceError";
  }
}

export type SetupExtractionRow = {
  id: string;
  requestFingerprint: string;
  promptVersion: string;
  configuredModelId: string;
  finalStatus: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type SetupExtractionAttemptRow = {
  id: string;
  extractionRequestId: string;
  attemptNumber: 1 | 2;
  status: ExtractionAttemptStatus;
  canonicalModelId: string;
  providerEndpointTag: string;
  conservativeMaxCostUsd: string;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCostUsd: string | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  errorCode: string | null;
  validatedResult: PackageExtractionResult | null;
  createdAt: string;
  completedAt: string | null;
};

export type ClaimAttemptOneInput = {
  extractionId: string;
  sourceType: string;
  requestFingerprint: string;
  promptVersion: string;
  configuredModelId: string;
  canonicalModelId: string;
  providerEndpointTag: string;
  // Corrected this pass (independent pre-live audit, Section 2): this is
  // the PER-ATTEMPT conservative maximum -- never the whole two-attempt
  // logical maximum. See netlify/server/extraction/preflight.ts.
  perAttemptConservativeMaxCostUsd: string;
};

export type ClaimAttemptTwoInput = {
  extractionId: string;
  requestFingerprint: string;
  canonicalModelId: string;
  providerEndpointTag: string;
  perAttemptConservativeMaxCostUsd: string;
  // Corrected this pass (independent pre-live audit, Section 3): the
  // retry-budget guard is now enforced INSIDE the atomic claim RPC
  // itself, not only in TypeScript beforehand -- the RPC needs the hard
  // ceiling to compare against, passed explicitly rather than
  // hard-coded a second time in SQL (asserted equal to
  // EXTRACTION_HARD_CEILING_USD by migrationConsistency.test.ts).
  hardCeilingUsd: string;
};

export type ClaimResult =
  | { wonClaim: true; attemptId: string }
  | { wonClaim: false; attemptStatus: ExtractionAttemptStatus | null; blockReason?: string };

export type TerminalizeInput = {
  extractionId: string;
  attemptNumber: 1 | 2;
  status: ExtractionAttemptStatus;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  actualCostUsd: string | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  errorCode: string | null;
  validatedResult: PackageExtractionResult | null;
};

export type BlockInput = {
  extractionId: string;
  sourceType: string;
  requestFingerprint: string;
  promptVersion: string;
  configuredModelId: string;
  status: string;
  // Second independent pre-live re-audit, Section 5: the highest attempt
  // number this pre-claim block EXPECTS to already exist for this
  // logical id -- 0 for submitInitialExtraction's own pre-claim guards
  // (which only ever run before any attempt has been claimed), 1 for
  // submitExtractionRetry's pre-claim guard (attempt #1 is guaranteed to
  // already exist by the time retry runs; only attempt #2 must not yet
  // exist). If the ACTUAL highest existing attempt number exceeds this,
  // a concurrent request already claimed further than this caller
  // expected, and the block is no longer authoritative -- it mutates
  // nothing and the caller resolves through the attempt/replay state
  // machine instead.
  expectedMaxAttemptNumber: 0 | 1;
};

export type ExtractionRepository = {
  getExtraction(extractionId: string): Promise<SetupExtractionRow | null>;
  getAttempt(
    extractionId: string,
    attemptNumber: 1 | 2
  ): Promise<SetupExtractionAttemptRow | null>;
  claimAttemptOne(input: ClaimAttemptOneInput): Promise<ClaimResult>;
  claimAttemptTwo(input: ClaimAttemptTwoInput): Promise<ClaimResult>;
  terminalize(input: TerminalizeInput): Promise<void>;
  block(input: BlockInput): Promise<void>;
  // New this pass (independent pre-live audit, Section 9): opportunistic
  // stale-claim reconciliation reachable from a plain read/replay path,
  // not only from inside the two claim RPCs -- ADR 0004 explicitly
  // allows/expects reconciliation on "later server-authoritative
  // requests," which includes an idempotent-replay status load.
  reconcileAttempts(extractionId: string): Promise<void>;
  // New this pass (Section 4): the authoritative, cross-process admission
  // check for the "3 accepted NEW logical-extraction starts per 180s per
  // source IP" target -- a single-process in-memory counter cannot
  // enforce this across Netlify Functions' ephemeral, horizontally-scaled
  // runtimes. `bucket` is already a privacy-conscious, pre-hashed
  // representation of (namespace, source) -- this method never receives
  // a raw source IP.
  //
  // `extractionRequestId` (second independent pre-live re-audit, Section
  // 3): the caller's logical request id, so the SAME logical request
  // (e.g. two concurrent submissions of a brand-new extractionRequestId
  // that raced ahead of any persisted row) can never consume more than
  // one admission slot. Pass `null` for callers with no such identity
  // (preflight, which runs before any id exists) -- every call now also
  // doubles as the authoritative gate for preflight/retry (Section 9),
  // each under its own bucket namespace and threshold, not only new-start.
  checkAndRecordAdmission(
    bucket: string,
    extractionRequestId: string | null,
    windowSeconds: number,
    maxRequests: number
  ): Promise<boolean>;
};

const extractionRowSchema = z.object({
  id: z.string().uuid(),
  request_fingerprint: z.string(),
  prompt_version: z.string(),
  configured_model_id: z.string(),
  final_status: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable()
});

const attemptRowSchema = z.object({
  id: z.string().uuid(),
  extraction_request_id: z.string().uuid(),
  attempt_number: z.union([z.literal(1), z.literal(2)]),
  status: z.string(),
  canonical_model_id: z.string(),
  provider_endpoint_tag: z.string(),
  conservative_max_cost_usd: z.union([z.string(), z.number()]),
  actual_input_tokens: z.number().nullable(),
  actual_output_tokens: z.number().nullable(),
  actual_cost_usd: z.union([z.string(), z.number()]).nullable(),
  latency_ms: z.number().nullable(),
  provider_request_id: z.string().nullable(),
  error_code: z.string().nullable(),
  validated_result: z.unknown().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable()
});

function fromExtractionRow(row: z.infer<typeof extractionRowSchema>): SetupExtractionRow {
  return {
    id: row.id,
    requestFingerprint: row.request_fingerprint,
    promptVersion: row.prompt_version,
    configuredModelId: row.configured_model_id,
    finalStatus: row.final_status,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

function fromAttemptRow(
  row: z.infer<typeof attemptRowSchema>
): SetupExtractionAttemptRow {
  return {
    id: row.id,
    extractionRequestId: row.extraction_request_id,
    attemptNumber: row.attempt_number,
    status: row.status as ExtractionAttemptStatus,
    canonicalModelId: row.canonical_model_id,
    providerEndpointTag: row.provider_endpoint_tag,
    conservativeMaxCostUsd: String(row.conservative_max_cost_usd),
    actualInputTokens: row.actual_input_tokens,
    actualOutputTokens: row.actual_output_tokens,
    actualCostUsd: row.actual_cost_usd === null ? null : String(row.actual_cost_usd),
    latencyMs: row.latency_ms,
    providerRequestId: row.provider_request_id,
    errorCode: row.error_code,
    validatedResult: (row.validated_result as PackageExtractionResult | null) ?? null,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

export function createSupabaseExtractionRepository(): ExtractionRepository {
  return new SupabaseExtractionRepository(createServerSupabaseClient());
}

export class SupabaseExtractionRepository implements ExtractionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getExtraction(extractionId: string): Promise<SetupExtractionRow | null> {
    const { data, error } = await this.client
      .from("setup_extractions")
      .select(
        "id,request_fingerprint,prompt_version,configured_model_id,final_status,created_at,completed_at"
      )
      .eq("id", extractionId)
      .maybeSingle();

    if (error) {
      throw new ExtractionPersistenceError();
    }

    if (!data) {
      return null;
    }

    const result = extractionRowSchema.safeParse(data);

    if (!result.success) {
      throw new ExtractionPersistenceError("Stored extraction record is invalid.");
    }

    return fromExtractionRow(result.data);
  }

  async getAttempt(
    extractionId: string,
    attemptNumber: 1 | 2
  ): Promise<SetupExtractionAttemptRow | null> {
    const { data, error } = await this.client
      .from("setup_extraction_attempts")
      .select(
        "id,extraction_request_id,attempt_number,status,canonical_model_id,provider_endpoint_tag,conservative_max_cost_usd,actual_input_tokens,actual_output_tokens,actual_cost_usd,latency_ms,provider_request_id,error_code,validated_result,created_at,completed_at"
      )
      .eq("extraction_request_id", extractionId)
      .eq("attempt_number", attemptNumber)
      .maybeSingle();

    if (error) {
      throw new ExtractionPersistenceError();
    }

    if (!data) {
      return null;
    }

    const result = attemptRowSchema.safeParse(data);

    if (!result.success) {
      throw new ExtractionPersistenceError("Stored attempt record is invalid.");
    }

    return fromAttemptRow(result.data);
  }

  async claimAttemptOne(input: ClaimAttemptOneInput): Promise<ClaimResult> {
    const { data, error } = await this.client.rpc("claim_setup_extraction_attempt_one", {
      p_extraction_id: input.extractionId,
      p_source_type: input.sourceType,
      p_request_fingerprint: input.requestFingerprint,
      p_prompt_version: input.promptVersion,
      p_configured_model_id: input.configuredModelId,
      p_canonical_model_id: input.canonicalModelId,
      p_provider_endpoint_tag: input.providerEndpointTag,
      p_conservative_max_cost_usd: input.perAttemptConservativeMaxCostUsd
    });

    if (error) {
      if (error.hint === "idempotency_conflict") {
        throw new ExtractionIdempotencyConflictError();
      }

      throw new ExtractionPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      throw new ExtractionPersistenceError("Claim RPC returned no row.");
    }

    if (row.won_claim) {
      return { wonClaim: true, attemptId: row.attempt_id };
    }

    return { wonClaim: false, attemptStatus: row.attempt_status ?? null };
  }

  async claimAttemptTwo(input: ClaimAttemptTwoInput): Promise<ClaimResult> {
    const { data, error } = await this.client.rpc("claim_setup_extraction_attempt_two", {
      p_extraction_id: input.extractionId,
      p_request_fingerprint: input.requestFingerprint,
      p_canonical_model_id: input.canonicalModelId,
      p_provider_endpoint_tag: input.providerEndpointTag,
      p_attempt_two_conservative_max_cost_usd: input.perAttemptConservativeMaxCostUsd,
      p_hard_ceiling_usd: input.hardCeilingUsd
    });

    if (error) {
      if (error.hint === "idempotency_conflict") {
        throw new ExtractionIdempotencyConflictError();
      }

      throw new ExtractionPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    if (!row) {
      throw new ExtractionPersistenceError("Claim RPC returned no row.");
    }

    if (row.won_claim) {
      return { wonClaim: true, attemptId: row.attempt_id };
    }

    return {
      wonClaim: false,
      attemptStatus: row.attempt_status ?? null,
      blockReason: row.block_reason ?? undefined
    };
  }

  async terminalize(input: TerminalizeInput): Promise<void> {
    const { error } = await this.client.rpc("terminalize_setup_extraction_attempt", {
      p_extraction_id: input.extractionId,
      p_attempt_number: input.attemptNumber,
      p_status: input.status,
      p_actual_input_tokens: input.actualInputTokens,
      p_actual_output_tokens: input.actualOutputTokens,
      p_actual_cost_usd: input.actualCostUsd,
      p_latency_ms: input.latencyMs,
      p_provider_request_id: input.providerRequestId,
      p_error_code: input.errorCode,
      p_validated_result: input.validatedResult
    });

    if (error) {
      throw new ExtractionPersistenceError();
    }
  }

  async block(input: BlockInput): Promise<void> {
    const { error } = await this.client.rpc("block_setup_extraction", {
      p_extraction_id: input.extractionId,
      p_source_type: input.sourceType,
      p_request_fingerprint: input.requestFingerprint,
      p_prompt_version: input.promptVersion,
      p_configured_model_id: input.configuredModelId,
      p_status: input.status,
      p_max_existing_attempt_number: input.expectedMaxAttemptNumber
    });

    if (error) {
      if (error.hint === "idempotency_conflict") {
        throw new ExtractionIdempotencyConflictError();
      }

      if (error.hint === "attempt_already_claimed") {
        throw new ExtractionAttemptAlreadyClaimedError();
      }

      throw new ExtractionPersistenceError();
    }
  }

  async reconcileAttempts(extractionId: string): Promise<void> {
    const { error } = await this.client.rpc("reconcile_setup_extraction_attempts", {
      p_extraction_id: extractionId
    });

    if (error) {
      throw new ExtractionPersistenceError();
    }
  }

  async checkAndRecordAdmission(
    bucket: string,
    extractionRequestId: string | null,
    windowSeconds: number,
    maxRequests: number
  ): Promise<boolean> {
    const { data, error } = await this.client.rpc("check_and_record_admission", {
      p_bucket: bucket,
      p_extraction_request_id: extractionRequestId,
      p_window_seconds: windowSeconds,
      p_max_requests: maxRequests
    });

    if (error) {
      throw new ExtractionPersistenceError();
    }

    return Boolean(data);
  }
}
