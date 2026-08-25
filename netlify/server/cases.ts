import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  chargeSheetSchema,
  sourceTypeSchema,
  type CaseSourceType
} from "../../src/schemas/tribunalSetup";
import { createServerSupabaseClient } from "./supabase";

const sourceFilenameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.includes("/") && !value.includes("\\"), {
    message: "Source filename must not include path separators."
  })
  .optional();

const createCaseInputSchema = z.strictObject({
  defendant: chargeSheetSchema.shape.defendant,
  act: chargeSheetSchema.shape.act,
  exactQuestion: chargeSheetSchema.shape.exactQuestion,
  sourceType: sourceTypeSchema,
  sourceFilename: sourceFilenameSchema
});

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

export class SupabaseCaseRepository implements CaseRepository {
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
      .order("created_at", { ascending: false });

    if (error || !data) {
      throw new CasePersistenceError();
    }

    return data.map((row) => parseCaseRow(row));
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
    source_filename: input.sourceFilename ?? null
  };
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
