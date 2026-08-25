import { describe, expect, it, vi } from "vitest";
import { ServerConfigError } from "./env";
import { createServerSupabaseClient } from "./supabase";

const validTestEnvironment = {
  SUPABASE_URL: "https://project-ref.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-placeholder"
};

describe("server Supabase client foundation", () => {
  it("constructs a server client from injected config without a network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const client = createServerSupabaseClient(validTestEnvironment);

    expect(client).toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });

  it("rejects missing or invalid configuration", () => {
    expect(() =>
      createServerSupabaseClient({
        SUPABASE_URL: "not-a-url",
        SUPABASE_SERVICE_ROLE_KEY: ""
      })
    ).toThrow(ServerConfigError);
  });

  it("uses non-secret test fixture values", () => {
    expect(Object.values(validTestEnvironment).join(" ")).not.toMatch(
      /eyJ|service_role|sk-|secret/i
    );
  });
});
