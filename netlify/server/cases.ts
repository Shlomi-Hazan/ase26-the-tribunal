import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  chargeSheetSchema,
  sourceTypeSchema,
  type CaseSourceType
} from "../../src/schemas/tribunalSetup";
import { createServerSupabaseClient } from "./supabase";

// Mirrors the safe-filename rules the deterministic import boundary already
// enforces (netlify/server/importParsers.ts: sanitizeFilename), plus the
// .txt/.md extension requirement, so a file-backed case can never be
// persisted with a filename the import boundary itself would have rejected.
// Exported so Milestone 6 (netlify/server/runs.ts) can reuse the exact same
// rule for participant personality source filenames instead of forking a
// second, possibly-inconsistent copy.
export const fileSourceFilenameSchema = z
  .string()
  .trim()
  .min(1, "Source filename is required.")
  .max(255, "Source filename exceeds 255 characters.")
  .refine((value) => value !== "." && value !== "..", {
    message: 'Source filename must not be "." or "..".'
  })
  .refine((value) => !value.includes("/") && !value.includes("\\"), {
    message: "Source filename must not include path separators."
  })
  .refine((value) => !value.includes("\0"), {
    message: "Source filename must not include a NUL character."
  })
  .refine((value) => /\.(txt|md)$/i.test(value), {
    message: "Source filename must be a .txt or .md file."
  });

const caseChargeFields = {
  defendant: chargeSheetSchema.shape.defendant,
  act: chargeSheetSchema.shape.act,
  exactQuestion: chargeSheetSchema.shape.exactQuestion
};

// A discriminated union keeps sourceFilename cross-field-valid instead of a
// single optional field: MANUAL cases cannot carry a filename at all (an
// extra key is rejected by strictObject), while CHARGE_SHEET_FILE/
// TRIBUNAL_PACKAGE_FILE cases require one that passes the safe-filename
// rules above. This runs before any repository/DB call, so malformed
// metadata is always a 400 invalid_case, never a DB-constraint failure.
// Exported so Milestone 6 can reuse this exact contract for the
// "kind: new" branch of a Convene request instead of forking a looser
// version.
export const createCaseInputSchema = z.discriminatedUnion("sourceType", [
  z.strictObject({
    ...caseChargeFields,
    sourceType: z.literal("MANUAL")
  }),
  z.strictObject({
    ...caseChargeFields,
    sourceType: z.literal("CHARGE_SHEET_FILE"),
    sourceFilename: fileSourceFilenameSchema
  }),
  z.strictObject({
    ...caseChargeFields,
    sourceType: z.literal("TRIBUNAL_PACKAGE_FILE"),
    sourceFilename: fileSourceFilenameSchema
  })
]);

const persistedCaseSchema = z.object({
  id: z.string().uuid(),
  defendant: z.string(),
  act: z.string(),
  exactQuestion: z.string(),
  sourceType: sourceTypeSchema,
  sourceFilename: z.string().nullable(),
  createdAt: z.string()
});

type CaseRow = {
  id: string;
  defendant: string;
  act: string;
  exact_question: string;
  source_type: CaseSourceType;
  source_filename: string | null;
  created_at: string;
};

export type CreateCaseInput = z.infer<typeof createCaseInputSchema>;
export type PersistedCase = z.infer<typeof persistedCaseSchema>;

export type CaseRepository = {
  create(input: CreateCaseInput): Promise<PersistedCase>;
  list(): Promise<PersistedCase[]>;
  getById(id: string): Promise<PersistedCase | null>;
};

// Milestone 6 addition: a Convene "kind: new" request must be idempotent
// under a lost-response retry without introducing a second database
// function (ADR 0002 Decision 9). This is a distinct, narrower interface
// from CaseRepository so M5 code/tests are untouched.
export type IdempotentCaseRepository = CaseRepository & {
  createIdempotent(
    input: CreateCaseInput,
    conveneRequestId: string
  ): Promise<PersistedCase>;
};

export class CaseValidationError extends Error {
  readonly errors: string[];

  constructor(errors: string[]) {
    super("Case validation failed.");
    this.name = "CaseValidationError";
    this.errors = errors;
  }
}

export class CasePersistenceError extends Error {
  constructor(message = "Case persistence failed.") {
    super(message);
    this.name = "CasePersistenceError";
  }
}

// Distinguishable from CasePersistenceError so callers can map it to a
// stable idempotency_conflict category instead of a generic 500.
export class IdempotencyConflictError extends Error {
  constructor(message = "Idempotency conflict.") {
    super(message);
    this.name = "IdempotencyConflictError";
  }
}

export function validateCreateCaseInput(input: unknown): CreateCaseInput {
  const result = createCaseInputSchema.safeParse(input);

  if (!result.success) {
    throw new CaseValidationError(
      result.error.issues.map((issue) => issue.message)
    );
  }

  return result.data;
}

export function validateCaseId(id: string) {
  const result = z.string().uuid().safeParse(id);

  if (!result.success) {
    throw new CaseValidationError(["Case id must be a valid UUID."]);
  }

  return result.data;
}

export function createSupabaseCaseRepository(): CaseRepository {
  return new SupabaseCaseRepository(createServerSupabaseClient());
}

export function createSupabaseIdempotentCaseRepository(): IdempotentCaseRepository {
  return new SupabaseCaseRepository(createServerSupabaseClient());
}

export class SupabaseCaseRepository implements IdempotentCaseRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(input: CreateCaseInput): Promise<PersistedCase> {
    const { data, error } = await this.client
      .from("cases")
      .insert(toCaseRowInput(input))
      .select(caseSelectColumns)
      .single();

    if (error || !data) {
      throw new CasePersistenceError();
    }

    return parseCaseRow(data);
  }

  async list(): Promise<PersistedCase[]> {
    const { data, error } = await this.client
      .from("cases")
      .select(caseSelectColumns)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (error || !data) {
      throw new CasePersistenceError();
    }

    return sortCasesDeterministically(data.map((row) => parseCaseRow(row)));
  }

  async getById(id: string): Promise<PersistedCase | null> {
    const { data, error } = await this.client
      .from("cases")
      .select(caseSelectColumns)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      throw new CasePersistenceError();
    }

    return data ? parseCaseRow(data) : null;
  }

  // Milestone 6: idempotent get-or-create for Convene "kind: new" cases,
  // keyed by the internal convene_request_id column (never exposed in any
  // public response -- see caseSelectColumns below). Race-safe by
  // construction: relies on the UNIQUE(convene_request_id) constraint to
  // arbitrate concurrent identical requests rather than a SELECT-then-
  // INSERT check. Never UPDATEs an existing case (this repository has no
  // update method at all, matching the unchanged M5 cases grants).
  async createIdempotent(
    input: CreateCaseInput,
    conveneRequestId: string
  ): Promise<PersistedCase> {
    const { data, error } = await this.client
      .from("cases")
      .insert({ ...toCaseRowInput(input), convene_request_id: conveneRequestId })
      .select(caseSelectColumns)
      .single();

    if (!error && data) {
      return parseCaseRow(data);
    }

    // Only a unique-violation on convene_request_id is treated as an
    // idempotent retry; every other insert failure remains a genuine
    // persistence failure. Postgres unique_violation is SQLSTATE 23505.
    const isConveneRequestIdConflict =
      error?.code === "23505" &&
      typeof error.message === "string" &&
      error.message.includes("convene_request_id");

    if (!isConveneRequestIdConflict) {
      throw new CasePersistenceError();
    }

    const { data: existing, error: selectError } = await this.client
      .from("cases")
      .select(`${caseSelectColumns},convene_request_id`)
      .eq("convene_request_id", conveneRequestId)
      .maybeSingle();

    if (selectError || !existing) {
      throw new CasePersistenceError();
    }

    const existingCase = parseCaseRow(existing);

    const contentMatches =
      existingCase.defendant === input.defendant &&
      existingCase.act === input.act &&
      existingCase.exactQuestion === input.exactQuestion &&
      existingCase.sourceType === input.sourceType &&
      existingCase.sourceFilename ===
        (input.sourceType === "MANUAL" ? null : input.sourceFilename);

    if (!contentMatches) {
      throw new IdempotencyConflictError();
    }

    return existingCase;
  }
}

const caseSelectColumns = [
  "id",
  "defendant",
  "act",
  "exact_question",
  "source_type",
  "source_filename",
  "created_at"
].join(",");

function toCaseRowInput(input: CreateCaseInput) {
  return {
    defendant: input.defendant,
    act: input.act,
    exact_question: input.exactQuestion,
    source_type: input.sourceType,
    source_filename: input.sourceType === "MANUAL" ? null : input.sourceFilename
  };
}

// Milestone 11 (Issue #27) -- deterministic total ordering:
// cases.created_at is NOT NULL but not UNIQUE, so two cases can
// legitimately share a timestamp and created_at DESC alone is not
// deterministic. Applied in-memory as a defense-in-depth guarantee
// alongside the equivalent ORDER BY list() also requests from Postgres
// -- pure and exported so the tie-break itself is directly
// unit-testable without mocking the Supabase query builder. The id
// comparison is a stability device only, never a chronological claim.
export function sortCasesDeterministically(cases: PersistedCase[]): PersistedCase[] {
  return [...cases].sort((a, b) => {
    const createdDelta = Date.parse(b.createdAt) - Date.parse(a.createdAt);

    if (createdDelta !== 0) {
      return createdDelta;
    }

    return b.id.localeCompare(a.id);
  });
}

function parseCaseRow(row: unknown): PersistedCase {
  const result = persistedCaseSchema.safeParse(fromCaseRow(row as CaseRow));

  if (!result.success) {
    throw new CasePersistenceError("Stored case record is invalid.");
  }

  return result.data;
}

function fromCaseRow(row: CaseRow) {
  return {
    id: row.id,
    defendant: row.defendant,
    act: row.act,
    exactQuestion: row.exact_question,
    sourceType: row.source_type,
    sourceFilename: row.source_filename,
    createdAt: row.created_at
  };
}
