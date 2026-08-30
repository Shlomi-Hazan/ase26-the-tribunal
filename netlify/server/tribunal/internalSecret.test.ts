import { describe, expect, it } from "vitest";
import { readInternalFunctionSecretHeader, secretsMatch } from "./internalSecret";

function fakeEvent(headers: Record<string, string | undefined>) {
  return { headers } as Parameters<typeof readInternalFunctionSecretHeader>[0];
}

describe("readInternalFunctionSecretHeader", () => {
  it("returns null when absent", () => {
    expect(readInternalFunctionSecretHeader(fakeEvent({}))).toBeNull();
  });

  it("reads the exact value, case-insensitively", () => {
    expect(readInternalFunctionSecretHeader(fakeEvent({ "X-Internal-Function-Secret": "abc" }))).toBe(
      "abc"
    );
  });

  it("returns null for an empty value", () => {
    expect(readInternalFunctionSecretHeader(fakeEvent({ "x-internal-function-secret": "" }))).toBeNull();
  });
});

describe("secretsMatch", () => {
  it("true for identical strings", () => {
    expect(secretsMatch("same-secret", "same-secret")).toBe(true);
  });

  it("false for different strings of the same length", () => {
    expect(secretsMatch("aaaaaaaa", "aaaaaaab")).toBe(false);
  });

  it("false for different-length strings", () => {
    expect(secretsMatch("short", "much-longer-secret")).toBe(false);
  });
});
