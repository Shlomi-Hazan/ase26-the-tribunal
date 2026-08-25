import { z } from "zod";

const supabaseServerConfigSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1)
});

export type ServerEnvironment = Partial<Record<keyof z.infer<typeof supabaseServerConfigSchema>, string>>;

export type SupabaseServerConfig = z.infer<typeof supabaseServerConfigSchema>;

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
