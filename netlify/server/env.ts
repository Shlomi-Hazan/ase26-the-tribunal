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

export type ServerEnvironment = Partial<
  Record<
    | keyof z.infer<typeof supabaseServerConfigSchema>
    | keyof z.infer<typeof openRouterServerConfigSchema>,
    string
  >
>;

export type SupabaseServerConfig = z.infer<typeof supabaseServerConfigSchema>;
export type OpenRouterServerConfig = z.infer<typeof openRouterServerConfigSchema>;

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
