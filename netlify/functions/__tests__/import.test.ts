import type {
  HandlerContext,
  HandlerEvent,
  HandlerResponse
} from "@netlify/functions";
import { describe, expect, it } from "vitest";
import { handler as importChargeSheet } from "../import-charge-sheet";
import { handler as importPersonality } from "../import-personality";
import { handler as importTribunalPackage } from "../import-tribunal-package";

const encoder = new TextEncoder();

function body(filename: string, text: string) {
  return JSON.stringify({
    filename,
    contentBase64: Buffer.from(encoder.encode(text)).toString("base64")
  });
}

async function call(
  handler: typeof importChargeSheet,
  request: Partial<HandlerEvent>
): Promise<HandlerResponse> {
  const result = await handler(request as HandlerEvent, {} as HandlerContext);

  if (!result) {
    throw new Error("Import handler did not return a response.");
  }

  return result;
}

function packageText() {
  return [
    "TRIBUNAL_PACKAGE_V1",
    "[CHARGE_SHEET]",
    "DEFENDANT: Alex Rowan",
    "ACT: Entered the restricted lab.",
    "QUESTION: Did Alex knowingly violate the lab protocol?",
    "[PRO_1]",
    "PERSONALITY: Precise.",
    "[PRO_2]",
    "PERSONALITY: Persuasive.",
    "[CON_1]",
    "PERSONALITY: Skeptical.",
    "[CON_2]",
    "PERSONALITY: Practical.",
    "[JUDGE_1]",
    "PERSONALITY: Methodical.",
    "[JUDGE_2]",
    "PERSONALITY: Fair.",
    "[JUDGE_3]",
    "PERSONALITY: Strict."
  ].join("\n");
}

describe("import functions", () => {
  it("returns a safe parsed Charge Sheet response", async () => {
    const response = await call(importChargeSheet, {
      httpMethod: "POST",
      body: body(
        "charge.txt",
        [
          "DEFENDANT: Alex Rowan",
          "ACT: Entered the restricted lab.",
          "QUESTION: Did Alex knowingly violate the lab protocol?"
        ].join("\n")
      )
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body ?? "")).toMatchObject({
      chargeSheet: {
        defendant: "Alex Rowan",
        act: "Entered the restricted lab.",
        exactQuestion: "Did Alex knowingly violate the lab protocol?"
      },
      filename: "charge.txt"
    });
    expect(response.body).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("returns safe validation errors for invalid imports", async () => {
    const response = await call(importPersonality, {
      httpMethod: "POST",
      body: body("personality.txt", "   ")
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "")).toEqual({
      error: "invalid_import",
      errors: ["Personality text is required."]
    });
  });

  it("rejects unsupported methods", async () => {
    const response = await call(importTribunalPackage, {
      httpMethod: "GET"
    });

    expect(response.statusCode).toBe(405);
  });

  it("rejects an oversized encoded payload before decoding it", async () => {
    // Base64 expands raw bytes ~4/3; a request whose encoded length alone
    // already exceeds that bound must fail before the full buffer is
    // allocated/decoded.
    const oversizedBase64 = "A".repeat(4 * 1024 * 1024);
    const response = await call(importPersonality, {
      httpMethod: "POST",
      body: JSON.stringify({
        filename: "personality.txt",
        contentBase64: oversizedBase64
      })
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body ?? "")).toEqual({
      error: "invalid_import",
      errors: ["Uploaded file exceeds 16 KiB."]
    });
  });

  it("returns a complete parsed Tribunal package", async () => {
    const response = await call(importTribunalPackage, {
      httpMethod: "POST",
      body: body("package.md", packageText())
    });
    const payload = JSON.parse(response.body ?? "");

    expect(response.statusCode).toBe(200);
    expect(payload.draft.chargeSheet.defendant).toBe("Alex Rowan");
    expect(Object.keys(payload.draft.participants)).toHaveLength(7);
    expect(payload.draft.participants["judge-3"].personality).toBe("Strict.");
    expect(response.body).not.toContain("OPENROUTER_API_KEY");
  });
});
