// Milestone 7A -- user-funded OpenRouter BYOK correction tests.
// Zero real OpenRouter calls: every network-touching assertion here
// mocks global fetch and inspects the request it would have sent,
// never actually reaching the network.

import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUserScopedProviders,
  OPENROUTER_NOT_CONNECTED,
  readUserOpenRouterKey,
  USER_OPENROUTER_KEY_HEADER
} from "./userOpenRouterKey";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("readUserOpenRouterKey", () => {
  function fakeEvent(headers: Record<string, string | undefined>) {
    return { headers } as Parameters<typeof readUserOpenRouterKey>[0];
  }

  it("returns null when the header is absent", () => {
    expect(readUserOpenRouterKey(fakeEvent({}))).toBeNull();
  });

  it("returns the trimmed key when present", () => {
    expect(readUserOpenRouterKey(fakeEvent({ [USER_OPENROUTER_KEY_HEADER]: "  sk-or-v1-abc123  " }))).toBe(
      "sk-or-v1-abc123"
    );
  });

  it("is case-insensitive (a real HTTP client may send any header casing)", () => {
    expect(readUserOpenRouterKey(fakeEvent({ "X-User-OpenRouter-Key": "sk-or-v1-abc123" }))).toBe(
      "sk-or-v1-abc123"
    );
  });

  it("returns null for a blank/whitespace-only value", () => {
    expect(readUserOpenRouterKey(fakeEvent({ [USER_OPENROUTER_KEY_HEADER]: "   " }))).toBeNull();
  });

  it("returns null for an implausibly short value", () => {
    expect(readUserOpenRouterKey(fakeEvent({ [USER_OPENROUTER_KEY_HEADER]: "short" }))).toBeNull();
  });
});

// Second independent live-gate correction (product/economics decision):
// the developer/operator must spend $0 on runtime model inference.
// buildUserScopedProviders is the ONE place both paid endpoints
// (setup-extractions.ts, setup-extractions-retry.ts) construct their
// providers from -- these tests are the direct, real proof that a
// supplied user key actually reaches the request-scoped provider (not
// merely that the header is read), and that absence yields a provider
// that can never silently do anything, let alone fall back to any
// other credential.
describe("buildUserScopedProviders", () => {
  it("a supplied user key reaches the request-scoped provider -- the real Authorization header sent on a call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    vi.stubGlobal("fetch", fetchMock);

    const { provider } = buildUserScopedProviders("sk-or-v1-the-users-own-key", "test");

    await provider.listModels();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;

    expect(headers.Authorization).toBe("Bearer sk-or-v1-the-users-own-key");
  });

  it("createTimedProvider/createTimedMetadataProvider also carry the user's key, never the operator's", async () => {
    // A fresh Response per call -- a Response body can only be read
    // (.json()) once, and this test makes two real calls against the
    // same mock.
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ data: [] }), { status: 200 })));

    vi.stubGlobal("fetch", fetchMock);

    const deps = buildUserScopedProviders("sk-or-v1-the-users-own-key", "test");

    await deps.createTimedProvider?.(5000).listModels();
    await deps.createTimedMetadataProvider?.(5000).listModels();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const [, init] = call as [string, RequestInit];
      const headers = init.headers as Record<string, string>;

      expect(headers.Authorization).toBe("Bearer sk-or-v1-the-users-own-key");
    }
  });

  it("with no user key: the provider throws on every method rather than silently using any other credential -- zero fetch calls", async () => {
    const fetchMock = vi.fn();

    vi.stubGlobal("fetch", fetchMock);

    const { provider, createTimedProvider, createTimedMetadataProvider } = buildUserScopedProviders(
      null,
      "test-caller"
    );

    await expect(provider.listModels()).rejects.toThrow(/OPENROUTER_NOT_CONNECTED/);
    await expect(provider.createChatCompletion({} as never)).rejects.toThrow(/OPENROUTER_NOT_CONNECTED/);
    expect(createTimedProvider).toBeUndefined();
    expect(createTimedMetadataProvider).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("the not-connected provider's error names the caller, not a generic message", async () => {
    const { provider } = buildUserScopedProviders(null, "handleSetupExtractionsRequest");

    await expect(provider.listModels()).rejects.toThrow(/handleSetupExtractionsRequest/);
  });
});

describe("OPENROUTER_NOT_CONNECTED", () => {
  it("is not part of the persistable extraction hard-failure taxonomy", async () => {
    const { EXTRACTION_HARD_FAILURE_CODES } = await import("./errors");

    expect((EXTRACTION_HARD_FAILURE_CODES as readonly string[]).includes(OPENROUTER_NOT_CONNECTED)).toBe(
      false
    );
  });
});

// User-funded OpenRouter BYOK correction: a deterministic, source-level
// regression guard -- mirrors scripts/verify-client-bundle.mjs's own
// "scan the real shipped source for a forbidden identifier" idiom,
// applied here to the two paid Netlify Functions instead of the client
// bundle. Proves readOpenRouterServerConfig (the ONLY way these files
// could read the operator's OPENROUTER_API_KEY) is not merely unused at
// runtime today, but is not even IMPORTED -- there is no fallback code
// path here to regress into.
describe("no fallback to the operator's OPENROUTER_API_KEY (source-level guard)", () => {
  const paidEndpointFiles = [
    "../../functions/setup-extractions.ts",
    "../../functions/setup-extractions-retry.ts"
  ];

  it.each(paidEndpointFiles)("%s never references readOpenRouterServerConfig in real code (only comments, if at all)", (relativePath) => {
    const filePath = path.resolve(__dirname, relativePath);
    const source = readFileSync(filePath, "utf8");
    const codeLines = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"));
    const codeOnly = codeLines.join("\n");

    expect(codeOnly).not.toContain("readOpenRouterServerConfig");
  });
});
