// Milestone 7 -- prompt-version anti-drift check (ADR Decision 17). SQL
// cannot import TypeScript constants, so src/prompts/versions.ts and the
// prompt-version bridge migration's embedded literals can silently drift
// apart over time. This test is the reviewable mechanism that fails if
// they ever do -- it reads the actual migration source (never a copy of
// the expected values maintained separately) and asserts its embedded
// literals equal the current exported constants exactly.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "./versions";

const migrationsDir = path.resolve(process.cwd(), "supabase", "migrations");

function findPromptVersionBridgeMigration(): string {
  const files = readdirSync(migrationsDir).filter((name) =>
    name.endsWith("_prompt_version_bridge.sql")
  );

  if (files.length !== 1) {
    throw new Error(
      `Expected exactly one *_prompt_version_bridge.sql migration, found ${files.length}: ${files.join(", ")}`
    );
  }

  return readFileSync(path.join(migrationsDir, files[0]), "utf8");
}

describe("prompt-version anti-drift check", () => {
  it("embeds the current ADVOCATE_PROMPT_VERSION literal in the freeze function", () => {
    const migrationSource = findPromptVersionBridgeMigration();
    const match = migrationSource.match(
      /when v_role = 'ADVOCATE' then '([^']*)'/
    );

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(ADVOCATE_PROMPT_VERSION);
  });

  it("embeds the current JUDGE_PROMPT_VERSION literal in the freeze function", () => {
    const migrationSource = findPromptVersionBridgeMigration();
    // The migration's CASE expression uses ADVOCATE as the explicit WHEN
    // branch and JUDGE as the ELSE fallback (mirroring the existing
    // v_role/v_side derivation pattern already used for role/side) -- so
    // the judge literal is the `else '...'` branch of the same
    // v_prompt_version assignment, not a second WHEN.
    const match = migrationSource.match(
      /v_prompt_version := case[\s\S]*?else '([^']*)'\s*end;/
    );

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(JUDGE_PROMPT_VERSION);
  });

  it("never mutates historical participant_configs rows (no UPDATE statement)", () => {
    const migrationSource = findPromptVersionBridgeMigration();

    expect(/\bupdate\s+public\.participant_configs\b/i.test(migrationSource)).toBe(
      false
    );
  });

  it("never edits the already-applied Milestone 6 migration file", () => {
    const m6Migration = readFileSync(
      path.join(migrationsDir, "20260825214212_participant_configuration.sql"),
      "utf8"
    );

    expect(m6Migration).toContain("'unassigned-pre-m7'");
  });

  it("does not introduce a caller-controlled prompt-version parameter", () => {
    const migrationSource = findPromptVersionBridgeMigration();

    expect(migrationSource).toContain(
      "create or replace function public.freeze_participant_configuration(\n  p_case_id uuid,\n  p_client_request_id text,\n  p_request_fingerprint text,\n  p_execution_mode text,\n  p_participants jsonb\n)"
    );
  });
});
