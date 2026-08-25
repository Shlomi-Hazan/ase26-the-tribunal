import type { HandlerContext, HandlerEvent, HandlerResponse } from "@netlify/functions";
import { describe, expect, it } from "vitest";
import { handler } from "./health";

async function callHealth(method: string): Promise<HandlerResponse> {
  const result = await handler(
    { httpMethod: method } as HandlerEvent,
    {} as HandlerContext
  );

  if (!result) {
    throw new Error("Health handler did not return a response.");
  }

  return result;
}

describe("health function", () => {
  it("returns a safe successful response", async () => {
    const response = await callHealth("GET");

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8"
    });
    expect(JSON.parse(response.body ?? "")).toEqual({
      status: "ok",
      service: "the-tribunal"
    });
    expect(response.body).not.toContain("OPENROUTER_API_KEY");
    expect(response.body).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(response.body).not.toContain("INTERNAL_FUNCTION_SECRET");
  });

  it("rejects unsupported methods without secret material", async () => {
    const response = await callHealth("POST");

    expect(response.statusCode).toBe(405);
    expect(response.body).not.toContain("SUPABASE");
  });
});
