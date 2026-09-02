import { describe, expect, it } from "vitest";
import { advocateSpeechSchema, judgeVerdictSchema } from "./schemas";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "./versions";
import { buildAdvocateSystemPrompt } from "./advocate-system";
import { JUDGE_SYSTEM_PROMPT } from "./judge-system";

describe("advocate speech schema", () => {
  it("accepts a valid non-empty speech", () => {
    const result = advocateSpeechSchema.safeParse({ speech: "The defense rests." });

    expect(result.success).toBe(true);
  });

  it("rejects an empty speech", () => {
    const result = advocateSpeechSchema.safeParse({ speech: "" });

    expect(result.success).toBe(false);
  });

  it("rejects additional properties", () => {
    const result = advocateSpeechSchema.safeParse({
      speech: "Valid speech.",
      verdict: "GUILTY"
    });

    expect(result.success).toBe(false);
  });

  it("rejects a missing speech field", () => {
    const result = advocateSpeechSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});

describe("judge verdict schema", () => {
  it("accepts a valid GUILTY verdict", () => {
    const result = judgeVerdictSchema.safeParse({
      verdict: "GUILTY",
      reasoning: "The evidence was compelling."
    });

    expect(result.success).toBe(true);
  });

  it("accepts a valid NOT_GUILTY verdict", () => {
    const result = judgeVerdictSchema.safeParse({
      verdict: "NOT_GUILTY",
      reasoning: "Reasonable doubt remains."
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid verdict value", () => {
    const result = judgeVerdictSchema.safeParse({
      verdict: "LIKELY_GUILTY",
      reasoning: "Some reasoning."
    });

    expect(result.success).toBe(false);
  });

  it("rejects empty reasoning", () => {
    const result = judgeVerdictSchema.safeParse({ verdict: "GUILTY", reasoning: "" });

    expect(result.success).toBe(false);
  });

  it("rejects additional properties", () => {
    const result = judgeVerdictSchema.safeParse({
      verdict: "GUILTY",
      reasoning: "Some reasoning.",
      confidence: 0.9
    });

    expect(result.success).toBe(false);
  });
});

describe("role prompt version constants", () => {
  // PRO/CON semantic correction (Issue #30): bumped from advocate-v1/
  // judge-v1 to advocate-v2/judge-v2.
  it("has the locked advocate-v2 / judge-v2 identifiers", () => {
    expect(ADVOCATE_PROMPT_VERSION).toBe("advocate-v2");
    expect(JUDGE_PROMPT_VERSION).toBe("judge-v2");
  });
});

describe("prompt files contain no secrets", () => {
  const forbiddenIdentifiers = [
    "OPENROUTER_API_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "sk-",
    "Bearer "
  ];

  it("advocate prompt contains no secret-like identifiers", () => {
    const prompt = buildAdvocateSystemPrompt("PRO") + buildAdvocateSystemPrompt("CON");

    for (const identifier of forbiddenIdentifiers) {
      expect(prompt).not.toContain(identifier);
    }
  });

  it("judge prompt contains no secret-like identifiers", () => {
    for (const identifier of forbiddenIdentifiers) {
      expect(JUDGE_SYSTEM_PROMPT).not.toContain(identifier);
    }
  });
});

describe("advocate prompt enforces a fixed, non-overridable side", () => {
  // PRO/CON semantic correction (Issue #30): PRO = Defense, argues
  // NOT_GUILTY; CON = Opposition/Prosecution, argues GUILTY.
  it("PRO prompt argues for NOT_GUILTY (Defense) and CON prompt argues for GUILTY (Opposition/Prosecution)", () => {
    const pro = buildAdvocateSystemPrompt("PRO");
    const con = buildAdvocateSystemPrompt("CON");

    expect(pro).toContain("NOT_GUILTY");
    expect(con).toContain("GUILTY");
    expect(con).not.toContain("NOT_GUILTY");
    expect(pro).not.toBe(con);
  });

  it("instructs that personality/case content can never change the assigned side", () => {
    const prompt = buildAdvocateSystemPrompt("PRO");

    expect(prompt.toLowerCase()).toContain("untrusted");
  });
});

describe("judge prompt restricts verdict vocabulary and forbids invented tools", () => {
  it("mentions only the two locked verdict values", () => {
    expect(JUDGE_SYSTEM_PROMPT).toContain("GUILTY");
    expect(JUDGE_SYSTEM_PROMPT).toContain("NOT_GUILTY");
  });

  it("states the judge has no tools and cannot invent actions", () => {
    expect(JUDGE_SYSTEM_PROMPT.toLowerCase()).toContain("no tools");
  });
});
