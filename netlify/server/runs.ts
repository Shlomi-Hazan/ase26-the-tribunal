import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  validateCaseId,
  type IdempotentCaseRepository,
  type PersistedCase
} from "./cases";
import { createServerSupabaseClient } from "./supabase";
import {
  ADVOCATE_PROMPT_VERSION,
  JUDGE_PROMPT_VERSION
} from "../../src/prompts/versions";

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
  participantId: ParticipantId;
  role: "ADVOCATE" | "JUDGE";
  side: "PRO" | "CON" | null;
  profileName: string | null;
  personality: string;
  personalitySource: PersonalitySource;
  personalitySourceFilename: string | null;
  modelId: string;
  promptVersion: string;
};

export type PersistedRun = {
  id: string;
  caseId: string;
  clientRequestId: string;
  executionMode: "shared" | "separate";
  status: string;
  createdAt: string;
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
  created_at: z.string()
});

const participantRowSchema = z.object({
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

export function createSupabaseRunRepository(): RunRepository {
  return new SupabaseRunRepository(createServerSupabaseClient());
}

export class SupabaseRunRepository implements RunRepository {
  constructor(private readonly client: SupabaseClient) {}

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

    const participants = data.map((row) => {
      const result = participantRowSchema.safeParse(row);

      if (!result.success) {
        throw new RunPersistenceError("Stored participant record is invalid.");
      }

      return fromParticipantRow(result.data);
    });

    const executionMode = EXECUTION_MODE_FROM_DB[run.execution_mode];

    if (!executionMode) {
      throw new RunPersistenceError("Stored run has an unknown execution mode.");
    }

    return {
      id: run.id,
      caseId: run.case_id,
      clientRequestId: run.client_request_id,
      executionMode,
      status: run.status,
      createdAt: run.created_at,
      participants: sortParticipantsCanonically(participants)
    };
  }
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
  "created_at"
].join(",");

const participantSelectColumns = [
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

function fromParticipantRow(
  row: z.infer<typeof participantRowSchema>
): PersistedParticipantConfig {
  return {
    participantId: row.participant_key as ParticipantId,
    role: row.role as "ADVOCATE" | "JUDGE",
    side: row.side as "PRO" | "CON" | null,
    profileName: row.profile_name,
    personality: row.personality_text,
    personalitySource: row.personality_source as PersonalitySource,
    personalitySourceFilename: row.personality_source_filename,
    modelId: row.model_id,
    promptVersion: row.prompt_version
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
