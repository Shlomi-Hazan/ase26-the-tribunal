// Milestone 8 -- the narrowly-scoped write boundary for Tribunal
// execution. One method per RPC in the M8 migration
// (supabase/migrations/20260829120000_shared_tribunal_execution.sql) --
// no generic arbitrary run-update method, matching the migration's own
// discipline. SupabaseTribunalExecutionRepository is the real
// implementation; FakeTribunalExecutionRepository (below) drives every
// automated test with zero network/database access.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Verdict } from "./majority";

export type ClaimAttemptInput = {
  runId: string;
  participantConfigId: string;
  attemptNumber: 1 | 2;
  configuredModelId: string;
  canonicalModelId: string;
  providerEndpointTag: string;
  promptVersion: string;
  conservativeMaxCostUsd: string;
  // Audit correction (Issue #17 blocker 4): the exact pricing snapshot
  // authorizing this attempt, persisted at claim time. inputPricePerMillion
  // is the cache-write-aware effective input price (never the raw,
  // possibly-lower prompt rate).
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  requestPriceUsd: string;
  pricingObservedAt: string;
};

export type TerminalizeAttemptInput = {
  attemptId: string;
  status:
    | "SUCCESS"
    | "INVALID_STRUCTURED_OUTPUT"
    | "TIMEOUT"
    | "PROVIDER_UNAVAILABLE"
    | "UNKNOWN_OUTCOME"
    // Independent audit correction (Issue #17 blocker 5): schema-valid
    // output whose usage/economics could not be reliably established --
    // never accepted as SUCCESS, regardless of how well-formed the
    // speech/verdict JSON itself was.
    | "TELEMETRY_UNAVAILABLE";
  inputTokens: number | null;
  outputTokens: number | null;
  actualCostUsd: string | null;
  // Audit correction (Issue #17 blockers 4/5): application-derived cost
  // (native token counts x the claimed pricing snapshot) when the
  // provider did not report usage.cost -- kept structurally distinct
  // from actualCostUsd, never used to overwrite it.
  derivedCostUsd: string | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
};

export type CompleteRunInput = {
  runId: string;
  majorityVerdict: Verdict;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  advocateCostUsd: string | null;
  judgeCostUsd: string | null;
  totalCostUsd: string | null;
  schemaVersion: string;
  protocolJson: Record<string, unknown>;
};

export class TribunalPersistenceError extends Error {
  constructor(message = "Tribunal execution persistence failed.") {
    super(message);
    this.name = "TribunalPersistenceError";
  }
}

export type TribunalExecutionRepository = {
  // READY -> BLOCKED_BUDGET. Returns false only when the run was not in
  // READY at all (e.g. already claimed by a concurrent invocation) --
  // true both for "just blocked" and "already blocked" (idempotent).
  blockBudget(runId: string, reasonCode: string, reasonDetail: string): Promise<boolean>;
  // READY -> ADVOCATES_RUNNING. True only for the invocation that won.
  claimForExecution(runId: string): Promise<boolean>;
  transitionToJudges(runId: string): Promise<boolean>;
  failRun(runId: string, failureCode: string, failureMessage: string): Promise<boolean>;
  completeRun(input: CompleteRunInput): Promise<boolean>;
  claimAttempt(
    input: ClaimAttemptInput
  ): Promise<{ wonClaim: boolean; attemptId: string | null }>;
  terminalizeAttempt(input: TerminalizeAttemptInput): Promise<boolean>;
  persistSpeech(runId: string, participantConfigId: string, speech: string): Promise<void>;
  persistVerdict(
    runId: string,
    participantConfigId: string,
    verdict: Verdict,
    reasoning: string
  ): Promise<void>;
};

export function createSupabaseTribunalExecutionRepository(
  client: SupabaseClient
): TribunalExecutionRepository {
  return new SupabaseTribunalExecutionRepository(client);
}

export class SupabaseTribunalExecutionRepository implements TribunalExecutionRepository {
  constructor(private readonly client: SupabaseClient) {}

  async blockBudget(runId: string, reasonCode: string, reasonDetail: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("block_tribunal_run_budget", {
      p_run_id: runId,
      p_reason_code: reasonCode,
      p_reason_detail: reasonDetail
    });

    if (error) {
      throw new TribunalPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    return Boolean(row?.blocked);
  }

  async claimForExecution(runId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_tribunal_run_for_execution", {
      p_run_id: runId
    });

    if (error) {
      throw new TribunalPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    return Boolean(row?.won_claim);
  }

  async transitionToJudges(runId: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("transition_tribunal_run_to_judges", {
      p_run_id: runId
    });

    if (error) {
      throw new TribunalPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    return Boolean(row?.transitioned);
  }

  async failRun(runId: string, failureCode: string, failureMessage: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("fail_tribunal_run", {
      p_run_id: runId,
      p_failure_code: failureCode,
      p_failure_message: failureMessage
    });

    if (error) {
      throw new TribunalPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    return Boolean(row?.transitioned);
  }

  async completeRun(input: CompleteRunInput): Promise<boolean> {
    const { data, error } = await this.client.rpc("complete_tribunal_run", {
      p_run_id: input.runId,
      p_majority_verdict: input.majorityVerdict,
      p_total_input_tokens: input.totalInputTokens,
      p_total_output_tokens: input.totalOutputTokens,
      p_total_tokens: input.totalTokens,
      p_advocate_cost_usd: input.advocateCostUsd,
      p_judge_cost_usd: input.judgeCostUsd,
      p_total_cost_usd: input.totalCostUsd,
      p_schema_version: input.schemaVersion,
      p_protocol_json: input.protocolJson
    });

    if (error) {
      throw new TribunalPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    return Boolean(row?.transitioned);
  }

  async claimAttempt(
    input: ClaimAttemptInput
  ): Promise<{ wonClaim: boolean; attemptId: string | null }> {
    const { data, error } = await this.client.rpc("claim_tribunal_attempt", {
      p_run_id: input.runId,
      p_participant_config_id: input.participantConfigId,
      p_attempt_number: input.attemptNumber,
      p_configured_model_id: input.configuredModelId,
      p_canonical_model_id: input.canonicalModelId,
      p_provider_endpoint_tag: input.providerEndpointTag,
      p_prompt_version: input.promptVersion,
      p_conservative_max_cost_usd: input.conservativeMaxCostUsd,
      p_input_price_per_million: input.inputPricePerMillion,
      p_output_price_per_million: input.outputPricePerMillion,
      p_request_price_usd: input.requestPriceUsd,
      p_pricing_observed_at: input.pricingObservedAt
    });

    if (error) {
      throw new TribunalPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    return { wonClaim: Boolean(row?.won_claim), attemptId: row?.attempt_id ?? null };
  }

  async terminalizeAttempt(input: TerminalizeAttemptInput): Promise<boolean> {
    const { data, error } = await this.client.rpc("terminalize_tribunal_attempt", {
      p_attempt_id: input.attemptId,
      p_status: input.status,
      p_input_tokens: input.inputTokens,
      p_output_tokens: input.outputTokens,
      p_actual_cost_usd: input.actualCostUsd,
      p_derived_cost_usd: input.derivedCostUsd,
      p_latency_ms: input.latencyMs,
      p_provider_request_id: input.providerRequestId,
      p_error_category: input.errorCategory,
      p_error_message: input.errorMessage
    });

    if (error) {
      throw new TribunalPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;

    return Boolean(row?.transitioned);
  }

  async persistSpeech(runId: string, participantConfigId: string, speech: string): Promise<void> {
    const { error } = await this.client.rpc("persist_advocate_speech", {
      p_run_id: runId,
      p_participant_config_id: participantConfigId,
      p_speech: speech
    });

    if (error) {
      throw new TribunalPersistenceError();
    }
  }

  async persistVerdict(
    runId: string,
    participantConfigId: string,
    verdict: Verdict,
    reasoning: string
  ): Promise<void> {
    const { error } = await this.client.rpc("persist_judge_verdict", {
      p_run_id: runId,
      p_participant_config_id: participantConfigId,
      p_verdict: verdict,
      p_reasoning: reasoning
    });

    if (error) {
      throw new TribunalPersistenceError();
    }
  }
}

// ---------------------------------------------------------------------
// Fake -- deterministic, in-memory, race-aware (Map.has/set is
// synchronous, so two "concurrent" Promise.allSettled calls in one test
// process still resolve the claim races correctly, matching the real
// atomic UPDATE ... WHERE semantics without needing a real database).
// ---------------------------------------------------------------------
export class FakeTribunalExecutionRepository implements TribunalExecutionRepository {
  runStatus = new Map<string, string>();
  runFailure = new Map<string, { code: string; message: string }>();
  completedRuns = new Map<string, CompleteRunInput>();
  attempts = new Map<string, TerminalizeAttemptInput & ClaimAttemptInput & { attemptId: string }>();
  speeches = new Map<string, string>();
  verdicts = new Map<string, { verdict: Verdict; reasoning: string }>();

  setRunStatus(runId: string, status: string) {
    this.runStatus.set(runId, status);
  }

  async blockBudget(runId: string, reasonCode: string, reasonDetail: string): Promise<boolean> {
    const current = this.runStatus.get(runId);

    if (current === "BLOCKED_BUDGET") {
      return true;
    }

    if (current !== "READY") {
      return false;
    }

    this.runStatus.set(runId, "BLOCKED_BUDGET");
    this.runFailure.set(runId, { code: reasonCode, message: reasonDetail });

    return true;
  }

  async claimForExecution(runId: string): Promise<boolean> {
    if (this.runStatus.get(runId) !== "READY") {
      return false;
    }

    this.runStatus.set(runId, "ADVOCATES_RUNNING");

    return true;
  }

  async transitionToJudges(runId: string): Promise<boolean> {
    if (this.runStatus.get(runId) !== "ADVOCATES_RUNNING") {
      return false;
    }

    this.runStatus.set(runId, "JUDGES_RUNNING");

    return true;
  }

  async failRun(runId: string, failureCode: string, failureMessage: string): Promise<boolean> {
    const current = this.runStatus.get(runId);

    if (current !== "ADVOCATES_RUNNING" && current !== "JUDGES_RUNNING") {
      return false;
    }

    this.runStatus.set(runId, "FAILED");
    this.runFailure.set(runId, { code: failureCode, message: failureMessage });

    return true;
  }

  async completeRun(input: CompleteRunInput): Promise<boolean> {
    if (this.runStatus.get(input.runId) !== "JUDGES_RUNNING") {
      return false;
    }

    this.runStatus.set(input.runId, "COMPLETED");
    this.completedRuns.set(input.runId, input);

    return true;
  }

  async claimAttempt(
    input: ClaimAttemptInput
  ): Promise<{ wonClaim: boolean; attemptId: string | null }> {
    const key = `${input.participantConfigId}:${input.attemptNumber}`;

    if (this.attempts.has(key)) {
      return { wonClaim: false, attemptId: null };
    }

    const attemptId = `attempt-${key}`;

    this.attempts.set(key, {
      ...input,
      attemptId,
      status: "SUCCESS",
      inputTokens: null,
      outputTokens: null,
      actualCostUsd: null,
      derivedCostUsd: null,
      latencyMs: null,
      providerRequestId: null,
      errorCategory: null,
      errorMessage: null
    });

    return { wonClaim: true, attemptId };
  }

  async terminalizeAttempt(input: TerminalizeAttemptInput): Promise<boolean> {
    for (const [key, attempt] of this.attempts.entries()) {
      if (attempt.attemptId === input.attemptId) {
        this.attempts.set(key, { ...attempt, ...input });

        return true;
      }
    }

    return false;
  }

  async persistSpeech(runId: string, participantConfigId: string, speech: string): Promise<void> {
    if (!this.speeches.has(participantConfigId)) {
      this.speeches.set(participantConfigId, speech);
    }
  }

  async persistVerdict(
    runId: string,
    participantConfigId: string,
    verdict: Verdict,
    reasoning: string
  ): Promise<void> {
    if (!this.verdicts.has(participantConfigId)) {
      this.verdicts.set(participantConfigId, { verdict, reasoning });
    }
  }
}
