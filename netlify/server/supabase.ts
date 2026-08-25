import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  readSupabaseServerConfig,
  type ServerEnvironment
} from "./env";

export function createServerSupabaseClient(
  environment?: ServerEnvironment
): SupabaseClient {
  const config = readSupabaseServerConfig(environment);

  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}
