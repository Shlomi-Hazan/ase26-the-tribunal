import { z } from "zod";

const supabaseServerConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)
});

// Milestone 7 (docs/adr/0003-openrouter-infrastructure.md): server-only,
// never exposed to the browser -- scripts/verify-client-bundle.mjs already
// treats OPENROUTER_API_KEY as a forbidden client-bundle identifier.
const openRouterServerConfigSchema = z.object({
  OPENROUTER_API_KEY: z.string().min(1)
});

// Milestone 7A (docs/adr/0004-smart-package-extraction.md Decision 10):
// server-only, never a browser/dossier-selected value.
// scripts/verify-client-bundle.mjs treats this as a forbidden client-
// bundle identifier alongside OPENROUTER_API_KEY.
const packageExtractionServerConfigSchema = z.object({
  PACKAGE_EXTRACTION_MODEL_ID: z.string().min(1)
});

// Milestone 8 (ARCHITECTURE.md Sec 4.1): the unguessable server-only token
// that authorizes an invocation of the Tribunal Background Function. The
// browser never receives this value -- it is read only by the synchronous
// POST /api/runs handler (to forward it, server-to-server, to the worker)
// and by the worker itself (to authenticate the invocation before any
// execution work). See netlify/server/tribunal/internalSecret.ts.
const internalFunctionSecretConfigSchema = z.object({
  INTERNAL_FUNCTION_SECRET: z.string().min(1)
});

export type ServerEnvironment = Partial<
  Record<
    | keyof z.infer<typeof supabaseServerConfigSchema>
    | keyof z.infer<typeof openRouterServerConfigSchema>
    | keyof z.infer<typeof packageExtractionServerConfigSchema>
    | keyof z.infer<typeof internalFunctionSecretConfigSchema>,
    string
  >
>;

export type SupabaseServerConfig = z.infer<typeof supabaseServerConfigSchema>;
export type OpenRouterServerConfig = z.infer<typeof openRouterServerConfigSchema>;
export type PackageExtractionServerConfig = z.infer<
  typeof packageExtractionServerConfigSchema
>;
export type InternalFunctionSecretConfig = z.infer<
  typeof internalFunctionSecretConfigSchema
>;

export class ServerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerConfigError";
  }
}

export function readSupabaseServerConfig(
  environment: ServerEnvironment = process.env
): SupabaseServerConfig {
  const result = supabaseServerConfigSchema.safeParse(environment);

  if (!result.success) {
    throw new ServerConfigError(
      "Missing or invalid Supabase server configuration."
    );
  }

  return result.data;
}

// Mirrors readSupabaseServerConfig exactly: injectable environment for
// tests, Zod validation, a typed configuration error that never echoes the
// attempted value (so a missing/invalid key can never leak into a thrown
// message), server-only (this module is never imported from src/).
export function readOpenRouterServerConfig(
  environment: ServerEnvironment = process.env
): OpenRouterServerConfig {
  const result = openRouterServerConfigSchema.safeParse(environment);

  if (!result.success) {
    throw new ServerConfigError(
      "Missing or invalid OpenRouter server configuration."
    );
  }

  return result.data;
}

// Mirrors readOpenRouterServerConfig exactly. Missing/invalid config
// fails safely here rather than falling back to any default model --
// ADR Decision 10's "no silent default to a paid model" rule.
export function readPackageExtractionServerConfig(
  environment: ServerEnvironment = process.env
): PackageExtractionServerConfig {
  const result = packageExtractionServerConfigSchema.safeParse(environment);

  if (!result.success) {
    throw new ServerConfigError(
      "Missing or invalid package-extraction server configuration."
    );
  }

  return result.data;
}

// Mirrors readOpenRouterServerConfig exactly. Missing/invalid config fails
// safely rather than falling back to any default -- an unset secret must
// never be treated as "no secret required."
export function readInternalFunctionSecretConfig(
  environment: ServerEnvironment = process.env
): InternalFunctionSecretConfig {
  const result = internalFunctionSecretConfigSchema.safeParse(environment);

  if (!result.success) {
    throw new ServerConfigError(
      "Missing or invalid internal function secret configuration."
    );
  }

  return result.data;
}
