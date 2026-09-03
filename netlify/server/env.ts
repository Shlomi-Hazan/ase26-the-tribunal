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

// Milestone 12 (human product override, PR #34 -- SECURITY.md Sec 3.1.1):
// the canonical Jon Snow lecturer demo is a narrow, explicit exception to
// the generic BYOK boundary. Both values below are server-only and never
// exposed to the browser (verify-client-bundle.mjs treats both as
// forbidden client-bundle identifiers, alongside OPENROUTER_API_KEY).
//
// - JON_SNOW_DEMO_OPENROUTER_API_KEY: the OpenRouter provider credential
//   used ONLY for the dedicated, canonical-only POST /api/demo/jon-snow/
//   runs endpoint (netlify/server/tribunal/jonSnowDemoRun.ts). It is
//   passed into the exact same triggerExecutionIfEligible every other
//   Tribunal run already uses -- never a second execution path -- and it
//   can never become a fallback for generic /api/runs (that endpoint
//   never reads this value at all).
// - JON_SNOW_DEMO_ACCESS_TOKEN: NOT an OpenRouter credential -- a
//   revocable capability that gates who may invoke the operator-funded
//   demo endpoint at all, checked against the request's
//   X-Jon-Snow-Demo-Access header (netlify/server/tribunal/demoAccess.ts)
//   before any case/run/provider work happens.
const jonSnowDemoServerConfigSchema = z.object({
  JON_SNOW_DEMO_OPENROUTER_API_KEY: z.string().min(1),
  JON_SNOW_DEMO_ACCESS_TOKEN: z.string().min(1)
});

export type ServerEnvironment = Partial<
  Record<
    | keyof z.infer<typeof supabaseServerConfigSchema>
    | keyof z.infer<typeof openRouterServerConfigSchema>
    | keyof z.infer<typeof packageExtractionServerConfigSchema>
    | keyof z.infer<typeof internalFunctionSecretConfigSchema>
    | keyof z.infer<typeof jonSnowDemoServerConfigSchema>,
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
export type JonSnowDemoServerConfig = z.infer<typeof jonSnowDemoServerConfigSchema>;

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

// Mirrors readInternalFunctionSecretConfig exactly. Missing/invalid
// config fails safely -- the dedicated demo endpoint must refuse the
// entire request (netlify/functions/demo-jon-snow-runs.ts calls this
// before touching Supabase/creating any run row) rather than silently
// treating a misconfigured operator demo as "no credential" the way the
// generic BYOK flow treats an unconnected user.
export function readJonSnowDemoServerConfig(
  environment: ServerEnvironment = process.env
): JonSnowDemoServerConfig {
  const result = jonSnowDemoServerConfigSchema.safeParse(environment);

  if (!result.success) {
    throw new ServerConfigError(
      "Missing or invalid Jon Snow demo server configuration."
    );
  }

  return result.data;
}

// Milestone 8 (independent audit correction, Issue #17 blocker 7): the
// server-to-server Background Function invocation destination MUST come
// from trusted server-side configuration, never from caller-supplied
// request headers (Host/X-Forwarded-Proto) -- both
// INTERNAL_FUNCTION_SECRET and the user's OpenRouter key are sent to
// wherever this resolves, so an attacker-controlled Host could otherwise
// redirect both secrets to a different origin. `URL` is Netlify's own
// documented read-only runtime variable for "the main URL of the site"
// -- populated automatically in every real Netlify context (production,
// deploy previews, and `netlify dev`, which sets it to the local dev
// server's own origin). No secret, so unlike the schemas above this is a
// plain accessor with a documented local-fallback default, not a
// throwing required-config check -- a missing value only arises outside
// any real Netlify runtime (e.g. a bare `vitest run`), where the caller
// is expected to inject an explicit override instead of relying on this
// fallback at all.
export function readBackgroundFunctionBaseUrl(
  environment: ServerEnvironment = process.env
): string {
  const raw = (environment as Record<string, string | undefined>).URL;

  return (raw && raw.trim().length > 0 ? raw : "http://localhost:8888").replace(/\/+$/, "");
}
