import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";
import { z } from "zod";
import {
  participantIds,
  personalityLimit,
  profileNameLimit,
  type ParticipantId,
  type PersonalitySource
} from "../../src/schemas/tribunalSetup";
import {
  createCaseInputSchema,
  fileSourceFilenameSchema,
  IdempotencyConflictError,
  SupabaseCaseRepository,
  validateCaseId,
  type CaseRepository,
  type IdempotentCaseRepository,
  type PersistedCase
} from "./cases";
import { createServerSupabaseClient } from "./supabase";
import {
  ADVOCATE_PROMPT_VERSION,
  JUDGE_PROMPT_VERSION
} from "../../src/prompts/versions";
import {
  reconstructCompletedRunAdmission,
  type AdmissionReconstructionResult,
  type AdmissionReserveEvidence
} from "./tribunal/admissionReconstruction";
import { resolveProtocol, type ResolvedProtocol } from "./tribunal/protocolResolution";

export { IdempotencyConflictError };

// Historical M6 placeholder. The already-applied M6 freeze function
// literally writes this value for every row; Milestone 7's forward
// migration (supabase/migrations/20260826173253_prompt_version_bridge.sql,
// not yet applied) replaces that literal with the role-specific
// ADVOCATE_PROMPT_VERSION/JUDGE_PROMPT_VERSION below once it ships. Still
// used to recognize an already-frozen M6 run as forever execution-
// ineligible (SPEC.md MODEL-006) -- never written by any code path here.
export const PROMPT_VERSION_PLACEHOLDER = "unassigned-pre-m7";

const EXECUTION_MODE_TO_DB = {
  shared: "SHARED",
  separate: "SEPARATE"
} as const;

const EXECUTION_MODE_FROM_DB: Record<string, "shared" | "separate"> = {
  SHARED: "shared",
  SEPARATE: "separate"
};

export const ROLE_BY_PARTICIPANT_ID: Record<ParticipantId, "ADVOCATE" | "JUDGE"> = {
  "advocate-pro-1": "ADVOCATE",
  "advocate-pro-2": "ADVOCATE",
  "advocate-con-1": "ADVOCATE",
  "advocate-con-2": "ADVOCATE",
  "judge-1": "JUDGE",
  "judge-2": "JUDGE",
  "judge-3": "JUDGE"
};

export const SIDE_BY_PARTICIPANT_ID: Record<ParticipantId, "PRO" | "CON" | null> = {
  "advocate-pro-1": "PRO",
  "advocate-pro-2": "PRO",
  "advocate-con-1": "CON",
  "advocate-con-2": "CON",
  "judge-1": null,
  "judge-2": null,
  "judge-3": null
};

// ---------------------------------------------------------------------
// Request validation. Participant entries never allow the caller to set
// role/side/promptVersion at all (z.strictObject rejects the extra key
// outright) -- the freeze function derives those internally.
// ---------------------------------------------------------------------

// C0 control characters (0x00-0x1F) + DEL (0x7F). A char-code loop is
// used instead of a control-character regex literal purely to keep the
// lint rule against embedding raw control characters in source happy;
// this is an ordinary JS string scan, not a SQL value-construction
// expression -- unrelated to the Postgres NUL-construction defect this
// project hit in Milestone 5 (a JS/TS string can hold any char code).
function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }

  return false;
}

const modelIdSchema = z
  .string()
  .trim()
  .min(1, "Model ID is required.")
  .max(256, "Model ID exceeds 256 characters.")
  .refine((value) => !containsControlCharacter(value), {
    message: "Model ID must not contain control characters."
  });

const participantConfigBaseFields = {
  participantId: z.enum(participantIds),
  profileName: z
    .string()
    .trim()
    .max(profileNameLimit, `Profile name exceeds ${profileNameLimit} characters.`)
    .optional(),
  personality: z
    .string()
    .trim()
    .min(1, "Personality is required.")
    .max(personalityLimit, `Personality exceeds ${personalityLimit} characters.`),
  modelId: modelIdSchema
};

// Mirrors netlify/server/cases.ts's createCaseInputSchema pattern exactly:
// a discriminated union keeps personalitySourceFilename cross-field-valid
// (manual carries none; individual_file/tribunal_package require the same
// safe .txt/.md filename rule already established in Milestone 5) instead
// of a single optional field that a browser could set inconsistently.
const participantConfigInputSchema = z.discriminatedUnion("personalitySource", [
  z.strictObject({
    ...participantConfigBaseFields,
    personalitySource: z.literal("manual")
  }),
  z.strictObject({
    ...participantConfigBaseFields,
    personalitySource: z.literal("individual_file"),
    personalitySourceFilename: fileSourceFilenameSchema
  }),
  z.strictObject({
    ...participantConfigBaseFields,
    personalitySource: z.literal("tribunal_package"),
    personalitySourceFilename: fileSourceFilenameSchema
  })
]);

export type ParticipantConfigInput = z.infer<typeof participantConfigInputSchema>;

const participantConfigArraySchema = z
  .array(participantConfigInputSchema)
  .length(7, "Exactly seven participant configurations are required.")
  .superRefine((entries, ctx) => {
    const seen = new Set<ParticipantId>();

    for (const entry of entries) {
      if (seen.has(entry.participantId)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate participant configuration for ${entry.participantId}.`
        });
      }
      seen.add(entry.participantId);
    }

    for (const id of participantIds) {
      if (!seen.has(id)) {
        ctx.addIssue({
          code: "custom",
          message: `Missing participant configuration for ${id}.`
        });
      }
    }
  });

const runCaseInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("existing"),
    caseId: z.string().uuid("caseId must be a valid UUID.")
  }),
  z.strictObject({
    kind: z.literal("new"),
    case: createCaseInputSchema
  })
]);

export type RunCaseInput = z.infer<typeof runCaseInputSchema>;

const createRunInputSchema = z
  .strictObject({
    clientRequestId: z.string().uuid("clientRequestId must be a valid UUID."),
    case: runCaseInputSchema,
    executionMode: z.enum(["shared", "separate"]),
    participants: participantConfigArraySchema
  })
  .superRefine((value, ctx) => {
    if (value.executionMode !== "shared") {
      return;
    }

    const modelIds = new Set(value.participants.map((entry) => entry.modelId));

    if (modelIds.size > 1) {
      ctx.addIssue({
        code: "custom",
        path: ["participants"],
        message:
          "Shared-Model Mode requires all seven participants to use the same model ID."
      });
    }
  });

export type CreateRunInput = z.infer<typeof createRunInputSchema>;

export class RunValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super("Run validation failed.");
    this.name = "RunValidationError";
    this.errors = errors;
  }
}

export class RunPersistenceError extends Error {
  constructor(message = "Run persistence failed.") {
    super(message);
    this.name = "RunPersistenceError";
  }
}

export function validateCreateRunInput(input: unknown): CreateRunInput {
  const result = createRunInputSchema.safeParse(input);

  if (!result.success) {
    throw new RunValidationError(result.error.issues.map((issue) => issue.message));
  }

  return result.data;
}

export function validateRunId(id: string) {
  const result = z.string().uuid().safeParse(id);

  if (!result.success) {
    throw new RunValidationError(["Run id must be a valid UUID."]);
  }

  return result.data;
}

// ---------------------------------------------------------------------
// Deterministic semantic fingerprint (ADR 0002 Decision 11). Computed
// from the canonical *semantic* case input -- never a generated case
// UUID -- so a lost-response retry of an identical request reproduces
// the same fingerprint regardless of whether case resolution has run
// yet. Server-only; the browser never supplies or overrides this value.
// ---------------------------------------------------------------------

export type CaseFingerprintInput =
  | { kind: "existing"; caseId: string }
  | {
      kind: "new";
      defendant: string;
      act: string;
      exactQuestion: string;
      sourceType: string;
      sourceFilename: string | null;
    };

export type ParticipantFingerprintInput = {
  participantId: ParticipantId;
  profileName: string;
  personality: string;
  personalitySource: PersonalitySource;
  personalitySourceFilename: string;
  modelId: string;
};

export function toCaseFingerprintInput(caseInput: RunCaseInput): CaseFingerprintInput {
  if (caseInput.kind === "existing") {
    return { kind: "existing", caseId: caseInput.caseId };
  }

  return {
    kind: "new",
    defendant: caseInput.case.defendant,
    act: caseInput.case.act,
    exactQuestion: caseInput.case.exactQuestion,
    sourceType: caseInput.case.sourceType,
    sourceFilename:
      caseInput.case.sourceType === "MANUAL"
        ? null
        : caseInput.case.sourceFilename
  };
}

export function toParticipantFingerprintInputs(
  participants: ParticipantConfigInput[]
): ParticipantFingerprintInput[] {
  return participants.map((entry) => ({
    participantId: entry.participantId,
    profileName: entry.profileName ?? "",
    personality: entry.personality,
    personalitySource: entry.personalitySource,
    personalitySourceFilename:
      entry.personalitySource === "manual"
        ? ""
        : entry.personalitySourceFilename,
    modelId: entry.modelId
  }));
}

// Correction (independent review, pre-live gate): `prompt_version` is
// per-participant and role-specific (ADR 0003 Decision 16) -- a single
// singular `promptVersion: string` field did not represent that, and
// hardcoding the M6 placeholder here meant the fingerprint no longer
// matched what the M7 bridge migration will actually freeze for a new
// run (advocate-v1 for advocates, judge-v1 for judges). The application-
// owned, never-caller-controlled current values live in
// src/prompts/versions.ts; acceptRun (below) supplies them here, exactly
// as it already supplies the application-owned executionMode. Changing
// either current role version changes the fingerprint for otherwise-
// identical future requests -- intentional: it IS a materially different
// semantic configuration once frozen.
export function computeRequestFingerprint(input: {
  caseInput: CaseFingerprintInput;
  executionMode: "SHARED" | "SEPARATE";
  participants: ParticipantFingerprintInput[];
  promptVersions: { advocate: string; judge: string };
}): string {
  const byParticipantId = new Map(
    input.participants.map((entry) => [entry.participantId, entry])
  );

  const canonicalParticipants = participantIds.map((id) => {
    const entry = byParticipantId.get(id);

    if (!entry) {
      throw new Error(`Missing participant fingerprint input for ${id}.`);
    }

    return {
      modelId: entry.modelId,
      participantId: entry.participantId,
      personality: entry.personality,
      personalitySource: entry.personalitySource,
      personalitySourceFilename: entry.personalitySourceFilename,
      profileName: entry.profileName
    };
  });

  const canonical = {
    case: input.caseInput,
    executionMode: input.executionMode,
    participants: canonicalParticipants,
    // Deterministic, role-specific -- never depends on object key
    // insertion order (canonicalStringify below sorts keys anyway, but
    // this literal is already written in a fixed, reviewed order).
    promptVersions: {
      advocate: input.promptVersions.advocate,
      judge: input.promptVersions.judge
    }
  };

  return createHash("sha256")
    .update(canonicalStringify(canonical), "utf8")
    .digest("hex");
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`
  );

  return `{${entries.join(",")}}`;
}

// ---------------------------------------------------------------------
// Repository boundary: fakeable so tests never need a real database or
// spend money, matching the Milestone 5 CaseRepository pattern.
// ---------------------------------------------------------------------

export type PersistedParticipantConfig = {
  // Milestone 8: the participant_configs row's own primary key -- needed
  // as the participant_config_id foreign key on model_call_attempts/
  // advocate_speeches/judge_verdicts. Never exposed in a public API
  // response by itself (toRunResponse continues to key by participantId).
  id: string;
  participantId: ParticipantId;
  role: "ADVOCATE" | "JUDGE";
  side: "PRO" | "CON" | null;
  profileName: string | null;
  personality: string;
  personalitySource: PersonalitySource;
  personalitySourceFilename: string | null;
  modelId: string;
  promptVersion: string;
  // Milestone 8 -- derived from the latest model_call_attempts row for
  // this participant (never a fabricated default): PENDING when no
  // attempt row exists yet, RUNNING/RETRYING while attempt 1/2 is
  // CLAIMED, SUCCESS/FAILED once terminal. Populated by getById's own
  // enrichment query; always "PENDING" immediately after freeze (zero
  // attempts can exist yet).
  attemptStatus: "PENDING" | "RUNNING" | "RETRYING" | "SUCCESS" | "FAILED";
  speech: string | null;
  verdict: "GUILTY" | "NOT_GUILTY" | null;
  reasoning: string | null;
};

// Milestone 10 -- one persisted model_call_attempts row, fully exposed
// (Issue #23 Sec 9/"Missing M10 Work"). Deterministically ordered by the
// repository (canonical participant order, then attemptNumber ascending)
// before ever reaching a caller -- Postgres promises no row order without
// an explicit ORDER BY, and this table has none applied. Every monetary/
// pricing field stays a decimal-safe string, never a JS number; every
// field the underlying attempt genuinely lacks telemetry for stays
// `null`, never a fabricated zero (docs/economics.md Sec 7).
export type AttemptAudit = {
  participantId: ParticipantId;
  role: "ADVOCATE" | "JUDGE";
  side: "PRO" | "CON" | null;
  attemptNumber: number;
  status: string;
  configuredModelId: string;
  canonicalModelId: string | null;
  providerEndpointTag: string | null;
  promptVersion: string;
  // The persisted admission/preflight reserve this exact attempt was
  // claimed under (Issue #23 Finding 3) -- never recomputed from current
  // pricing.
  conservativeMaxCostUsd: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  inputPricePerMillion: string | null;
  outputPricePerMillion: string | null;
  requestPriceUsd: string | null;
  pricingObservedAt: string | null;
  actualCostUsd: string | null;
  derivedCostUsd: string | null;
  latencyMs: number | null;
  providerRequestId: string | null;
  errorCategory: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

// Milestone 10 -- honest partial-spend semantics (Issue #23 Finding 2).
// `null` means zero provider attempts exist at all (BLOCKED_BUDGET, or
// any run that never reached a claim) -- a factually different state
// from "$0 known cost," which `hasUnknownCost`/`knownCostUsd` never
// collapse into. `hasUnknownCost` is true the instant any attempt with a
// real provider call has both `actualCostUsd`/`derivedCostUsd` null --
// `knownCostUsd` is still the Decimal-safe sum of whatever IS known, and
// callers must never present it as if it were the complete total when
// `hasUnknownCost` is true.
export type PartialSpend = { knownCostUsd: string; hasUnknownCost: boolean } | null;

export type PersistedRun = {
  id: string;
  caseId: string;
  clientRequestId: string;
  executionMode: "shared" | "separate";
  status: string;
  createdAt: string;
  // Milestone 8 execution/economics -- all null on a still-READY run.
  startedAt: string | null;
  completedAt: string | null;
  majorityVerdict: "GUILTY" | "NOT_GUILTY" | null;
  failureCode: string | null;
  failureMessage: string | null;
  totalCostUsd: string | null;
  advocateCostUsd: string | null;
  judgeCostUsd: string | null;
  // Milestone 10 -- the run-level persisted aggregate token totals
  // (tribunal_runs.total_input_tokens/total_output_tokens/total_tokens),
  // already written by complete_tribunal_run at COMPLETED time -- read
  // and exposed, never recomputed (Issue #23 Sec 6/8: these columns
  // already existed since M8, they were simply never selected).
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalTokens: number | null;
  // Milestone 10 -- deterministically derived from the attempt rows
  // below: providerAttemptCount = every model_call_attempts row;
  // logicalCallCount = distinct participant_config_ids among them. A
  // retry is 1 logical call / 2 provider attempts, never 2 logical calls
  // (Issue #23 Finding 4).
  logicalCallCount: number;
  providerAttemptCount: number;
  // Milestone 10 -- derived once, server-side, from startedAt/completedAt
  // only -- never client/browser time, never for a still-in-progress or
  // anomalous-timestamp run (Issue #23 Sec 6/9).
  wallClockMs: number | null;
  partialSpend: PartialSpend;
  // Milestone 10 -- COMPLETED-run historical admission reconstruction
  // (Issue #23 Finding 3/8's focused audit). `null` when not applicable
  // (non-COMPLETED, or no protocol row exists to select a historical
  // policy version from) -- `{ available: false, reason }` when it WAS
  // attempted but the persisted evidence was incomplete/inconsistent.
  admission: AdmissionReconstructionResult | null;
  attempts: AttemptAudit[];
  // Milestone 10 -- the read-time-resolved protocol view (Issue #23 Sec
  // 11). `null` when no protocol row exists for this run (every non-
  // COMPLETED run today) or when validation/consistency checks fail --
  // never a partially-rendered/repaired protocol.
  protocol: ResolvedProtocol | null;
  participants: PersistedParticipantConfig[];
};

export type FreezeRunInput = {
  caseId: string;
  clientRequestId: string;
  requestFingerprint: string;
  executionMode: "SHARED" | "SEPARATE";
  participants: Array<{
    participantId: ParticipantId;
    profileName: string | null;
    personality: string;
    personalitySource: PersonalitySource;
    personalitySourceFilename: string | null;
    modelId: string;
  }>;
};

export type RunRepository = {
  freeze(input: FreezeRunInput): Promise<PersistedRun>;
  getById(id: string): Promise<PersistedRun | null>;
};

const runRowSchema = z.object({
  id: z.string().uuid(),
  case_id: z.string().uuid(),
  client_request_id: z.string(),
  execution_mode: z.string(),
  status: z.string(),
  created_at: z.string(),
  started_at: z.string().nullable().optional(),
  completed_at: z.string().nullable().optional(),
  majority_verdict: z.string().nullable().optional(),
  failure_code: z.string().nullable().optional(),
  failure_message: z.string().nullable().optional(),
  total_cost_usd: z.union([z.string(), z.number()]).nullable().optional(),
  advocate_cost_usd: z.union([z.string(), z.number()]).nullable().optional(),
  judge_cost_usd: z.union([z.string(), z.number()]).nullable().optional(),
  // Milestone 10 -- already existed on tribunal_runs since the M8
  // migration, simply never selected/exposed until now (Issue #23).
  total_input_tokens: z.union([z.string(), z.number()]).nullable().optional(),
  total_output_tokens: z.union([z.string(), z.number()]).nullable().optional(),
  total_tokens: z.union([z.string(), z.number()]).nullable().optional()
});

const participantRowSchema = z.object({
  id: z.string().uuid(),
  participant_key: z.string(),
  role: z.string(),
  side: z.string().nullable(),
  profile_name: z.string().nullable(),
  personality_text: z.string(),
  personality_source: z.string(),
  personality_source_filename: z.string().nullable(),
  model_id: z.string(),
  prompt_version: z.string()
});

// Milestone 10 -- the full model_call_attempts audit column set (Issue
// #23 Sec 6/9), replacing the previous narrow
// "participant_config_id,attempt_number,status" selection with everything
// the Attempt Audit / partial-spend / admission-reconstruction read path
// needs -- one query, reused for all three, never a second round trip to
// the same table.
const attemptRowSchema = z.object({
  participant_config_id: z.string().uuid(),
  attempt_number: z.number(),
  status: z.string(),
  configured_model_id: z.string(),
  canonical_model_id: z.string().nullable(),
  provider_endpoint_tag: z.string().nullable(),
  prompt_version: z.string(),
  conservative_max_cost_usd: z.union([z.string(), z.number()]).nullable(),
  provider_request_id: z.string().nullable(),
  input_tokens: z.number().nullable(),
  output_tokens: z.number().nullable(),
  total_tokens: z.number().nullable(),
  input_price_per_million: z.union([z.string(), z.number()]).nullable(),
  output_price_per_million: z.union([z.string(), z.number()]).nullable(),
  request_price_usd: z.union([z.string(), z.number()]).nullable(),
  actual_cost_usd: z.union([z.string(), z.number()]).nullable(),
  derived_cost_usd: z.union([z.string(), z.number()]).nullable(),
  pricing_observed_at: z.string().nullable(),
  latency_ms: z.number().nullable(),
  error_category: z.string().nullable(),
  error_message: z.string().nullable(),
  started_at: z.string(),
  completed_at: z.string().nullable()
});

export type AttemptRow = z.infer<typeof attemptRowSchema>;

// Milestone 10 -- the persisted protocol row (Issue #23 Sec 11). Only
// `schema_version` and `protocol_json` are read; `protocol_json` itself
// is validated by protocolResolution.ts's strict schema before any of it
// is exposed -- this Zod layer only proves the two columns exist.
const protocolRowSchema = z.object({
  schema_version: z.string(),
  protocol_json: z.unknown()
});

export function createSupabaseRunRepository(): RunRepository {
  const client = createServerSupabaseClient();

  return new SupabaseRunRepository(client, new SupabaseCaseRepository(client));
}

export class SupabaseRunRepository implements RunRepository {
  // Milestone 10 -- an optional injected CaseRepository (defaulting to a
  // SupabaseCaseRepository built from the same client) resolves the
  // canonical Charge Sheet a resolved protocol view references, reusing
  // the existing case read path (cases.ts) rather than a second,
  // duplicated case-storage query (Issue #23 Sec "Slice 2.D").
  private readonly caseRepository: CaseRepository;

  constructor(private readonly client: SupabaseClient, caseRepository?: CaseRepository) {
    this.caseRepository = caseRepository ?? new SupabaseCaseRepository(client);
  }

  async freeze(input: FreezeRunInput): Promise<PersistedRun> {
    const { data, error } = await this.client.rpc(
      "freeze_participant_configuration",
      {
        p_case_id: input.caseId,
        p_client_request_id: input.clientRequestId,
        p_request_fingerprint: input.requestFingerprint,
        p_execution_mode: input.executionMode,
        p_participants: input.participants.map((entry) => ({
          participant_key: entry.participantId,
          profile_name: entry.profileName ?? "",
          personality_text: entry.personality,
          personality_source: entry.personalitySource,
          personality_source_filename: entry.personalitySourceFilename ?? "",
          model_id: entry.modelId
        }))
      }
    );

    if (error) {
      if (error.hint === "idempotency_conflict") {
        throw new IdempotencyConflictError();
      }

      throw new RunPersistenceError();
    }

    const row = Array.isArray(data) ? data[0] : data;
    const runResult = runRowSchema.safeParse(row);

    if (!runResult.success) {
      throw new RunPersistenceError("Stored run record is invalid.");
    }

    return this.loadRun(runResult.data);
  }

  async getById(id: string): Promise<PersistedRun | null> {
    const { data, error } = await this.client
      .from("tribunal_runs")
      .select(runSelectColumns)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new RunPersistenceError();
    }

    if (!data) {
      return null;
    }

    const runResult = runRowSchema.safeParse(data);

    if (!runResult.success) {
      throw new RunPersistenceError("Stored run record is invalid.");
    }

    return this.loadRun(runResult.data);
  }

  private async loadRun(
    run: z.infer<typeof runRowSchema>
  ): Promise<PersistedRun> {
    const { data, error } = await this.client
      .from("participant_configs")
      .select(participantSelectColumns)
      .eq("run_id", run.id);

    if (error || !data) {
      throw new RunPersistenceError();
    }

    const baseParticipants = data.map((row) => {
      const result = participantRowSchema.safeParse(row);

      if (!result.success) {
        throw new RunPersistenceError("Stored participant record is invalid.");
      }

      return fromParticipantRow(result.data);
    });

    const sortedParticipants = sortParticipantsCanonically(baseParticipants);
    const participantConfigIds = sortedParticipants.map((participant) => participant.id);

    // Milestone 8/10: one full-column attempts query, plus speeches,
    // verdicts, and the protocol row -- all in parallel. Cheap and
    // harmless on a still-READY run (every query returns an empty/absent
    // result, and every derived field below stays at its PENDING/null
    // default).
    const [attemptRows, speechByParticipant, verdictByParticipant, protocolRow] =
      participantConfigIds.length === 0
        ? [[], new Map(), new Map(), null]
        : await this.loadRunEvidence(run.id, participantConfigIds);

    const participantById = new Map(sortedParticipants.map((participant) => [participant.id, participant]));

    const enrichedParticipants = sortedParticipants.map((participant) => {
      const speech = speechByParticipant.get(participant.id) ?? null;
      const verdictRow = verdictByParticipant.get(participant.id) ?? null;

      return {
        ...participant,
        attemptStatus: deriveAttemptStatus(latestAttemptFor(participant.id, attemptRows)),
        speech,
        verdict: (verdictRow?.verdict as "GUILTY" | "NOT_GUILTY" | undefined) ?? null,
        reasoning: verdictRow?.reasoning ?? null
      };
    });

    const executionMode = EXECUTION_MODE_FROM_DB[run.execution_mode];

    if (!executionMode) {
      throw new RunPersistenceError("Stored run has an unknown execution mode.");
    }

    const attempts = buildAttemptAudits(attemptRows, participantById);
    const providerAttemptCount = attemptRows.length;
    const logicalCallCount = new Set(attemptRows.map((row) => row.participant_config_id)).size;
    const partialSpend = computePartialSpend(attemptRows);
    const majorityVerdict = (run.majority_verdict as "GUILTY" | "NOT_GUILTY" | null | undefined) ?? null;

    let admission: AdmissionReconstructionResult | null = null;
    let protocol: ResolvedProtocol | null = null;

    if (protocolRow) {
      // Admission reconstruction only ever attempted when a protocol row
      // exists (today: COMPLETED runs only -- fail_tribunal_run never
      // inserts one, Issue #23 Sec 10/13) -- otherwise `admission` stays
      // `null` ("not applicable"), never a fabricated Unavailable for a
      // run that was never even eligible for reconstruction.
      admission = reconstructCompletedRunAdmission(
        protocolRow.schema_version,
        buildAdmissionReserveEvidence(attemptRows, participantById)
      );

      const resolvedCase = await this.caseRepository.getById(run.case_id);

      if (resolvedCase) {
        const protocolResult = resolveProtocol({
          storedSchemaVersion: protocolRow.schema_version,
          protocolJsonRaw: protocolRow.protocol_json,
          run: {
            id: run.id,
            caseId: run.case_id,
            executionMode,
            majorityVerdict
          },
          chargeSheet: {
            defendant: resolvedCase.defendant,
            act: resolvedCase.act,
            exactQuestion: resolvedCase.exactQuestion
          },
          // Corrected (final source re-review, "Frozen Participant
          // Micro-Correction"): the full frozen row -- role/side/
          // modelId/promptVersion, not only profileName/personality --
          // already loaded above (sortedParticipants), never re-queried.
          participantsByParticipantId: new Map(
            sortedParticipants.map((participant) => [
              participant.participantId,
              {
                role: participant.role,
                side: participant.side,
                profileName: participant.profileName,
                personality: participant.personality,
                modelId: participant.modelId,
                promptVersion: participant.promptVersion
              }
            ])
          ),
          // Corrected (independent source audit, Finding 1): carries the
          // persisted verdict alongside the reasoning so resolveProtocol
          // can cross-check it against the protocol's own recorded
          // verdict, not merely supply display text.
          judgeEvidenceByParticipantId: new Map(
            [...verdictByParticipant.entries()]
              .map(([participantConfigId, entry]) => {
                const participant = participantById.get(participantConfigId);

                return participant
                  ? ([
                      participant.participantId,
                      { verdict: entry.verdict as "GUILTY" | "NOT_GUILTY", reasoning: entry.reasoning }
                    ] as const)
                  : null;
              })
              .filter(
                (
                  entry
                ): entry is readonly [ParticipantId, { verdict: "GUILTY" | "NOT_GUILTY"; reasoning: string }] =>
                  entry !== null
              )
          ),
          economics: {
            logicalCallCount,
            providerAttemptCount,
            totalTokens: toNullableInt(run.total_tokens),
            totalCostUsd: toNullableDecimalString(run.total_cost_usd)
          }
        });

        protocol = protocolResult.ok ? protocolResult.protocol : null;
      }
    }

    return {
      id: run.id,
      caseId: run.case_id,
      clientRequestId: run.client_request_id,
      executionMode,
      status: run.status,
      createdAt: run.created_at,
      startedAt: run.started_at ?? null,
      completedAt: run.completed_at ?? null,
      majorityVerdict,
      failureCode: run.failure_code ?? null,
      failureMessage: run.failure_message ?? null,
      totalCostUsd: toNullableDecimalString(run.total_cost_usd),
      advocateCostUsd: toNullableDecimalString(run.advocate_cost_usd),
      judgeCostUsd: toNullableDecimalString(run.judge_cost_usd),
      totalInputTokens: toNullableInt(run.total_input_tokens),
      totalOutputTokens: toNullableInt(run.total_output_tokens),
      totalTokens: toNullableInt(run.total_tokens),
      logicalCallCount,
      providerAttemptCount,
      wallClockMs: computeWallClockMs(run.started_at ?? null, run.completed_at ?? null),
      partialSpend,
      admission,
      attempts,
      protocol,
      participants: enrichedParticipants
    };
  }

  // Milestone 10 -- one parallel batch fetching everything loadRun needs
  // beyond the participant_configs rows themselves: the full attempt
  // audit columns (used for attemptStatus, the Attempt Audit array,
  // partial spend, and admission reconstruction alike -- never queried
  // twice), speeches, verdicts, and the protocol row.
  private async loadRunEvidence(
    runId: string,
    participantConfigIds: string[]
  ): Promise<
    [
      AttemptRow[],
      Map<string, string>,
      Map<string, { verdict: string; reasoning: string }>,
      z.infer<typeof protocolRowSchema> | null
    ]
  > {
    const [attemptsResult, speechesResult, verdictsResult, protocolResult] = await Promise.all([
      this.client
        .from("model_call_attempts")
        .select(attemptSelectColumns)
        .in("participant_config_id", participantConfigIds),
      this.client
        .from("advocate_speeches")
        .select("participant_config_id,speech")
        .in("participant_config_id", participantConfigIds),
      this.client
        .from("judge_verdicts")
        .select("participant_config_id,verdict,reasoning")
        .in("participant_config_id", participantConfigIds),
      this.client.from("protocols").select("schema_version,protocol_json").eq("run_id", runId).maybeSingle()
    ]);

    if (attemptsResult.error || speechesResult.error || verdictsResult.error || protocolResult.error) {
      throw new RunPersistenceError();
    }

    const attemptRows = (attemptsResult.data ?? []).map((row) => {
      const result = attemptRowSchema.safeParse(row);

      if (!result.success) {
        throw new RunPersistenceError("Stored attempt record is invalid.");
      }

      return result.data;
    });

    const speechByParticipant = new Map(
      ((speechesResult.data ?? []) as Array<{ participant_config_id: string; speech: string }>).map(
        (row) => [row.participant_config_id, row.speech]
      )
    );

    const verdictByParticipant = new Map(
      (
        (verdictsResult.data ?? []) as Array<{
          participant_config_id: string;
          verdict: string;
          reasoning: string;
        }>
      ).map((row) => [row.participant_config_id, { verdict: row.verdict, reasoning: row.reasoning }])
    );

    let protocolRow: z.infer<typeof protocolRowSchema> | null = null;

    if (protocolResult.data) {
      const parsed = protocolRowSchema.safeParse(protocolResult.data);

      if (!parsed.success) {
        throw new RunPersistenceError("Stored protocol record is invalid.");
      }

      protocolRow = parsed.data;
    }

    return [attemptRows, speechByParticipant, verdictByParticipant, protocolRow];
  }
}

function latestAttemptFor(
  participantConfigId: string,
  attempts: AttemptRow[]
): { attemptNumber: number; status: string } | undefined {
  let latest: { attemptNumber: number; status: string } | undefined;

  for (const row of attempts) {
    if (row.participant_config_id !== participantConfigId) {
      continue;
    }

    if (!latest || row.attempt_number > latest.attemptNumber) {
      latest = { attemptNumber: row.attempt_number, status: row.status };
    }
  }

  return latest;
}

// Milestone 10 -- deterministic ordering (Issue #23 Finding 4): canonical
// participant order first (the same participantIds order used everywhere
// else in this application), then attemptNumber ascending within each
// participant. Postgres promises no row order without an explicit
// ORDER BY, and none is applied to the query above.
export function buildAttemptAudits(
  attempts: AttemptRow[],
  participantById: Map<string, PersistedParticipantConfig>
): AttemptAudit[] {
  return [...attempts]
    .sort((a, b) => {
      const participantA = participantById.get(a.participant_config_id);
      const participantB = participantById.get(b.participant_config_id);
      const orderA = participantA ? participantIds.indexOf(participantA.participantId) : Number.MAX_SAFE_INTEGER;
      const orderB = participantB ? participantIds.indexOf(participantB.participantId) : Number.MAX_SAFE_INTEGER;

      if (orderA !== orderB) {
        return orderA - orderB;
      }

      return a.attempt_number - b.attempt_number;
    })
    .flatMap((row) => {
      const participant = participantById.get(row.participant_config_id);

      if (!participant) {
        return [];
      }

      return [
        {
          participantId: participant.participantId,
          role: participant.role,
          side: participant.side,
          attemptNumber: row.attempt_number,
          status: row.status,
          configuredModelId: row.configured_model_id,
          canonicalModelId: row.canonical_model_id,
          providerEndpointTag: row.provider_endpoint_tag,
          promptVersion: row.prompt_version,
          conservativeMaxCostUsd: toNullableDecimalString(row.conservative_max_cost_usd),
          inputTokens: row.input_tokens,
          outputTokens: row.output_tokens,
          totalTokens: row.total_tokens,
          inputPricePerMillion: toNullableDecimalString(row.input_price_per_million),
          outputPricePerMillion: toNullableDecimalString(row.output_price_per_million),
          requestPriceUsd: toNullableDecimalString(row.request_price_usd),
          pricingObservedAt: row.pricing_observed_at,
          actualCostUsd: toNullableDecimalString(row.actual_cost_usd),
          derivedCostUsd: toNullableDecimalString(row.derived_cost_usd),
          latencyMs: row.latency_ms,
          providerRequestId: row.provider_request_id,
          errorCategory: row.error_category,
          errorMessage: row.error_message,
          startedAt: row.started_at,
          completedAt: row.completed_at
        } satisfies AttemptAudit
      ];
    });
}

// Milestone 10 -- honest partial-spend aggregation (Issue #23 Finding 2).
// Precedence per attempt is `actualCostUsd ?? derivedCostUsd`, matching
// the runtime spend ledger exactly (execution.ts) -- when BOTH are null,
// that attempt's cost is unknown, never folded in as $0.
export function computePartialSpend(attempts: AttemptRow[]): PartialSpend {
  if (attempts.length === 0) {
    return null;
  }

  let knownCostUsd = new Decimal(0);
  let hasUnknownCost = false;

  for (const row of attempts) {
    const effective = row.actual_cost_usd ?? row.derived_cost_usd;

    if (effective === null || effective === undefined) {
      hasUnknownCost = true;
      continue;
    }

    knownCostUsd = knownCostUsd.plus(new Decimal(effective));
  }

  return { knownCostUsd: knownCostUsd.toFixed(), hasUnknownCost };
}

// Milestone 10 -- admission-reconstruction input (Issue #23 Sec 8): every
// attempt row's own conservative_max_cost_usd, grouped by logical
// participant, so admissionReconstruction.ts can itself assert retry
// agreement rather than trusting a pre-deduplicated value. Attempt rows
// whose participant_config_id doesn't resolve to a known participant
// (should be structurally impossible) are skipped rather than crashing.
export function buildAdmissionReserveEvidence(
  attempts: AttemptRow[],
  participantById: Map<string, PersistedParticipantConfig>
): AdmissionReserveEvidence[] {
  const byParticipantId = new Map<ParticipantId, Array<string | null>>();

  for (const row of attempts) {
    const participant = participantById.get(row.participant_config_id);

    if (!participant) {
      continue;
    }

    const existing = byParticipantId.get(participant.participantId) ?? [];

    existing.push(toNullableDecimalString(row.conservative_max_cost_usd));
    byParticipantId.set(participant.participantId, existing);
  }

  return [...byParticipantId.entries()].map(([participantId, conservativeMaxCostUsdByAttempt]) => ({
    participantId,
    conservativeMaxCostUsdByAttempt
  }));
}

export function computeWallClockMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) {
    return null;
  }

  const startedMs = Date.parse(startedAt);
  const completedMs = Date.parse(completedAt);

  if (Number.isNaN(startedMs) || Number.isNaN(completedMs)) {
    return null;
  }

  const durationMs = completedMs - startedMs;

  return durationMs >= 0 ? durationMs : null;
}

function toNullableInt(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number.parseInt(value, 10);

  return Number.isFinite(parsed) ? parsed : null;
}

function deriveAttemptStatus(
  latest: { attemptNumber: number; status: string } | undefined
): PersistedParticipantConfig["attemptStatus"] {
  if (!latest) {
    return "PENDING";
  }

  if (latest.status === "CLAIMED") {
    return latest.attemptNumber >= 2 ? "RETRYING" : "RUNNING";
  }

  return latest.status === "SUCCESS" ? "SUCCESS" : "FAILED";
}

function toNullableDecimalString(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  return String(value);
}

// PostgreSQL does not promise row order without an explicit ORDER BY, and
// none is applied to the participant_configs query above. Normalize into
// the canonical application participant order (participantIds -- the same
// fixed order used everywhere else: fingerprint computation, the freeze
// RPC's known-key check, the UI) before this ever becomes a public
// response, rather than adding a speculative DB ordering column for a
// seven-row, sort-in-memory case. Exported (rather than inlined) so this
// normalization can be unit-tested directly against shuffled input,
// independent of mocking the Supabase query builder.
export function sortParticipantsCanonically(
  participants: PersistedParticipantConfig[]
): PersistedParticipantConfig[] {
  return [...participants].sort(
    (a, b) =>
      participantIds.indexOf(a.participantId) -
      participantIds.indexOf(b.participantId)
  );
}

const runSelectColumns = [
  "id",
  "case_id",
  "client_request_id",
  "execution_mode",
  "status",
  "created_at",
  "started_at",
  "completed_at",
  "majority_verdict",
  "failure_code",
  "failure_message",
  "total_cost_usd",
  "advocate_cost_usd",
  "judge_cost_usd",
  "total_input_tokens",
  "total_output_tokens",
  "total_tokens"
].join(",");

const participantSelectColumns = [
  "id",
  "participant_key",
  "role",
  "side",
  "profile_name",
  "personality_text",
  "personality_source",
  "personality_source_filename",
  "model_id",
  "prompt_version"
].join(",");

// Milestone 10 -- the full model_call_attempts audit column set (matches
// attemptRowSchema exactly).
const attemptSelectColumns = [
  "participant_config_id",
  "attempt_number",
  "status",
  "configured_model_id",
  "canonical_model_id",
  "provider_endpoint_tag",
  "prompt_version",
  "conservative_max_cost_usd",
  "provider_request_id",
  "input_tokens",
  "output_tokens",
  "total_tokens",
  "input_price_per_million",
  "output_price_per_million",
  "request_price_usd",
  "actual_cost_usd",
  "derived_cost_usd",
  "pricing_observed_at",
  "latency_ms",
  "error_category",
  "error_message",
  "started_at",
  "completed_at"
].join(",");

function fromParticipantRow(
  row: z.infer<typeof participantRowSchema>
): PersistedParticipantConfig {
  return {
    id: row.id,
    participantId: row.participant_key as ParticipantId,
    role: row.role as "ADVOCATE" | "JUDGE",
    side: row.side as "PRO" | "CON" | null,
    profileName: row.profile_name,
    personality: row.personality_text,
    personalitySource: row.personality_source as PersonalitySource,
    personalitySourceFilename: row.personality_source_filename,
    modelId: row.model_id,
    promptVersion: row.prompt_version,
    // Milestone 8 defaults -- overwritten by enrichExecutionState's own
    // per-participant lookup immediately after this is called; a
    // freshly-frozen run legitimately has none of these yet.
    attemptStatus: "PENDING",
    speech: null,
    verdict: null,
    reasoning: null
  };
}

// ---------------------------------------------------------------------
// Server processing order (ADR 0002 Decision 10 / SPEC.md CONFIG-009):
// A validate -> B resolve canonical case input -> C normalize
// participants -> D compute fingerprint (before any case creation) ->
// E optional non-authoritative pre-check -> F resolve/create case
// idempotently -> G call freeze -> H freeze is final atomic authority.
// ---------------------------------------------------------------------

export type AcceptRunDeps = {
  caseRepository: IdempotentCaseRepository;
  runRepository: RunRepository;
};

export async function acceptRun(
  rawInput: unknown,
  deps: AcceptRunDeps
): Promise<PersistedRun> {
  // A: strict request validation.
  const input = validateCreateRunInput(rawInput);

  // B: resolve canonical semantic case input -- load-only for "existing"
  // (no write yet for "new").
  let resolvedCase: PersistedCase | null = null;

  if (input.case.kind === "existing") {
    const caseId = validateCaseId(input.case.caseId);
    resolvedCase = await deps.caseRepository.getById(caseId);

    if (!resolvedCase) {
      throw new RunValidationError(["Case not found for the given caseId."]);
    }
  }

  // C: normalize the seven participant configs into fingerprint inputs.
  const participantFingerprintInputs = toParticipantFingerprintInputs(
    input.participants
  );

  // D: compute the semantic fingerprint from the canonical case input --
  // never a generated/resolved case UUID for "new" cases, since that
  // case row does not exist yet at this point.
  const executionModeDb = EXECUTION_MODE_TO_DB[input.executionMode];
  const requestFingerprint = computeRequestFingerprint({
    caseInput: toCaseFingerprintInput(input.case),
    executionMode: executionModeDb,
    participants: participantFingerprintInputs,
    // Correction (independent review, pre-live gate): the M7
    // prompt-version bridge migration freezes role-specific current
    // versions (advocate-v1 / judge-v1), not the M6 placeholder -- the
    // fingerprint must represent what a new run will actually contain.
    // Application-owned, never caller-controlled (the strict participant
    // schema above already rejects any caller-supplied promptVersion
    // key entirely).
    promptVersions: {
      advocate: ADVOCATE_PROMPT_VERSION,
      judge: JUDGE_PROMPT_VERSION
    }
  });

  // E: optional, non-authoritative pre-check. Never trusted as the race
  // guard -- the freeze function (H) remains final authority regardless.
  // Not implemented as a separate round trip in M6: the freeze function
  // itself performs this check atomically, so a dedicated pre-check here
  // would only be a latency optimization, not a correctness requirement.

  // F: resolve/create the case idempotently, now that the fingerprint no
  // longer depends on this step's outcome.
  if (input.case.kind === "new") {
    resolvedCase = await deps.caseRepository.createIdempotent(
      input.case.case,
      input.clientRequestId
    );
  }

  if (!resolvedCase) {
    throw new RunPersistenceError("Case could not be resolved.");
  }

  // G/H: call the freeze function -- the final atomic authority for
  // client_request_id uniqueness, fingerprint match/conflict, and the
  // exactly-seven insert.
  return deps.runRepository.freeze({
    caseId: resolvedCase.id,
    clientRequestId: input.clientRequestId,
    requestFingerprint,
    executionMode: executionModeDb,
    participants: input.participants.map((entry) => ({
      participantId: entry.participantId,
      profileName: entry.profileName ?? null,
      personality: entry.personality,
      personalitySource: entry.personalitySource,
      personalitySourceFilename:
        entry.personalitySource === "manual"
          ? null
          : entry.personalitySourceFilename,
      modelId: entry.modelId
    }))
  });
}
