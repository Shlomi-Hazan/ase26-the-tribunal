// Milestone 7 -- prompt-version anti-drift check (ADR Decision 17). SQL
// cannot import TypeScript constants, so src/prompts/versions.ts and the
// freeze function's embedded literals can silently drift apart over
// time. This test is the reviewable mechanism that fails if they ever
// do -- it reads the actual migration source (never a copy of the
// expected values maintained separately) and asserts its embedded
// literals equal the current exported constants exactly.
//
// PRO/CON semantic correction (Issue #30), migration-discovery
// correction: the prior "expect exactly one *_prompt_version_bridge.sql
// file" assumption could not survive a second function-redefining
// migration (this correction adds exactly that second migration,
// 20260903120000_prompt_version_bridge_v2.sql). The discovery rule below
// is now robust to that and to any future v3/v4/... migration: it finds
// every migration file whose SQL actually contains the
// `create or replace function public.freeze_participant_configuration(`
// signature (not filename-pattern-dependent), sorts by filename (this
// repository's migrations are UTC-timestamp-prefixed and applied in
// filename-sort order), and treats the chronologically latest match as
// the single current, authoritative function definition.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ADVOCATE_PROMPT_VERSION, JUDGE_PROMPT_VERSION } from "./versions";
import { buildAdvocateSystemPrompt } from "./advocate-system";
import { JUDGE_SYSTEM_PROMPT } from "./judge-system";
import { ADVOCATE_SYSTEM_PROMPT_V1_PRO, ADVOCATE_SYSTEM_PROMPT_V1_CON } from "./advocate/v1";
import { JUDGE_SYSTEM_PROMPT_V1 } from "./judge/v1";

const migrationsDir = path.resolve(process.cwd(), "supabase", "migrations");

const FREEZE_FUNCTION_SIGNATURE =
  "create or replace function public.freeze_participant_configuration(";

// Every migration file whose SQL contains the freeze function's
// CREATE OR REPLACE signature, sorted by filename ascending. The last
// entry is the chronologically latest -- the current, authoritative
// definition. Historical migrations that predate the function's
// existence, or that touch unrelated tables/functions, never match and
// are correctly ignored.
function findFreezeFunctionMigrations(): Array<{ filename: string; source: string }> {
  const matches = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .map((filename) => ({
      filename,
      source: readFileSync(path.join(migrationsDir, filename), "utf8")
    }))
    .filter(({ source }) => source.includes(FREEZE_FUNCTION_SIGNATURE))
    .sort((a, b) => a.filename.localeCompare(b.filename));

  if (matches.length === 0) {
    throw new Error(
      "No migration defines public.freeze_participant_configuration -- expected at least one."
    );
  }

  return matches;
}

function currentFreezeFunctionMigration(): string {
  const matches = findFreezeFunctionMigrations();

  return matches[matches.length - 1].source;
}

describe("prompt-version anti-drift check", () => {
  it("embeds the current ADVOCATE_PROMPT_VERSION literal in the latest freeze function definition", () => {
    const migrationSource = currentFreezeFunctionMigration();
    const match = migrationSource.match(
      /when v_role = 'ADVOCATE' then '([^']*)'/
    );

    expect(match).not.toBeNull();
    expect(match?.[1]).toBe(ADVOCATE_PROMPT_VERSION);
  });

  it("embeds the current JUDGE_PROMPT_VERSION literal in the latest freeze function definition", () => {
    const migrationSource = currentFreezeFunctionMigration();
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

  it("at least two migrations now define the freeze function -- the discovery rule is exercising its multi-file path, not a single-file coincidence", () => {
    const matches = findFreezeFunctionMigrations();

    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(matches[matches.length - 1].filename).toBe(
      "20260903120000_prompt_version_bridge_v2.sql"
    );
  });

  it("every migration defining the freeze function never mutates historical participant_configs rows (no UPDATE statement)", () => {
    for (const { filename, source } of findFreezeFunctionMigrations()) {
      expect(
        /\bupdate\s+public\.participant_configs\b/i.test(source),
        `${filename} must not contain an UPDATE of public.participant_configs`
      ).toBe(false);
    }
  });

  // Correction (independent review, pre-live gate, Section 23): this
  // test proves only that the M6 migration file's content still contains
  // its original placeholder literal, as a quick sanity check -- it is
  // NOT, and never claims to be, proof that the file is byte-identical
  // to its already-applied historical state. That authoritative check is
  // `git diff --check main -- supabase/migrations/`, run separately as
  // part of this correction's own verification.
  it("the M6 migration file still contains its original placeholder literal (a sanity check, not a byte-identity proof)", () => {
    const m6Migration = readFileSync(
      path.join(migrationsDir, "20260825214212_participant_configuration.sql"),
      "utf8"
    );

    expect(m6Migration).toContain("'unassigned-pre-m7'");
  });

  it("the M7 prompt-version-bridge migration file still contains its original advocate-v1/judge-v1 literals (a sanity check, not a byte-identity proof)", () => {
    const m7Migration = readFileSync(
      path.join(migrationsDir, "20260826173253_prompt_version_bridge.sql"),
      "utf8"
    );

    expect(m7Migration).toContain("'advocate-v1'");
    expect(m7Migration).toContain("'judge-v1'");
  });

  it("does not introduce a caller-controlled prompt-version parameter", () => {
    const migrationSource = currentFreezeFunctionMigration();

    expect(migrationSource).toContain(
      "create or replace function public.freeze_participant_configuration(\n  p_case_id uuid,\n  p_client_request_id text,\n  p_request_fingerprint text,\n  p_execution_mode text,\n  p_participants jsonb\n)"
    );
  });

  // Section 23 strengthening: the SQL-vs-TypeScript check alone is not
  // the complete current contract -- the application's own idempotency
  // fingerprint (netlify/server/runs.ts) must also use these same
  // current role-specific constants, not a stale hardcoded string. This
  // reads that source file directly (never a separately maintained copy
  // of the expected code) and asserts it imports and actually passes
  // both constants into computeRequestFingerprint's promptVersions
  // argument, and no longer references the retired placeholder there.
  it("netlify/server/runs.ts's fingerprint computation uses the current role-specific constants, not the retired placeholder", () => {
    const runsSource = readFileSync(
      path.resolve(process.cwd(), "netlify", "server", "runs.ts"),
      "utf8"
    );

    expect(runsSource).toContain("ADVOCATE_PROMPT_VERSION");
    expect(runsSource).toContain("JUDGE_PROMPT_VERSION");
    expect(runsSource).toMatch(
      /promptVersions:\s*{\s*advocate:\s*ADVOCATE_PROMPT_VERSION,\s*judge:\s*JUDGE_PROMPT_VERSION/
    );
    expect(runsSource).not.toMatch(
      /computeRequestFingerprint\(\{[\s\S]*?promptVersion:\s*PROMPT_VERSION_PLACEHOLDER/
    );
  });
});

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// PRO/CON semantic correction (Issue #30) -- exact SHA-256 fingerprints
// for BOTH the archived historical version and the live/current version
// of every Advocate/Judge rendered prompt. A weaker "live text differs
// from v1 text" check cannot detect a later accidental edit to the
// CURRENT version's own text while its version constant stays
// unchanged -- two different "current" texts would both still satisfy
// that weaker check. Exact hashes close that gap: any edit to any of
// these six rendered prompts -- historical or current -- fails this
// file until the fixture below is deliberately updated, which is itself
// the review checkpoint.
//
// Historical hashes computed via a real `node`/tsx execution against
// src/prompts/advocate-system.ts / judge-system.ts at commit
// 85aec6bb34fc30496297ad9d1dae183f884c1b08 (main, immediately before
// this correction), before either file was edited -- not estimated, not
// retyped from memory.
const ADVOCATE_V1_PRO_SHA256 =
  "27291a1ef332536a5143eac72ec5ff53978daf825a5299500fe2b8bc26e23272";
const ADVOCATE_V1_CON_SHA256 =
  "2f55ba0f74f41f87854ff12faf950466e5ffd6bf488bf931529bd74f3b65b155";
const JUDGE_V1_SHA256 =
  "464fe4c7033ffb8846a0219758944f6a180bbcda7b1fcc47c0ae2000f85dfb52";

// Current (v2) hashes computed the same way against the real, reviewed
// post-correction advocate-system.ts / judge-system.ts.
const ADVOCATE_V2_PRO_SHA256 =
  "12b16351d46f8a2640990ea6ccbaa987bee987c44f7a63b8ab766dfc7370f42c";
const ADVOCATE_V2_CON_SHA256 =
  "aa4130c297479c5e8284513ec275247d03058e4b1e7ea17234b9a35b4ae5b88e";
const JUDGE_V2_SHA256 =
  "5a51fb5bfec38cfe390b987223be0eb53552ef84aa597ce5469dde70cd846b36";

describe("advocate-v1 archival immutability (Issue #30 -- rendered-text SHA lock)", () => {
  it("PRO matches its locked SHA-256 content hash", () => {
    expect(sha256(ADVOCATE_SYSTEM_PROMPT_V1_PRO)).toBe(ADVOCATE_V1_PRO_SHA256);
  });

  it("CON matches its locked SHA-256 content hash", () => {
    expect(sha256(ADVOCATE_SYSTEM_PROMPT_V1_CON)).toBe(ADVOCATE_V1_CON_SHA256);
  });

  it("preserves the reversed historical meaning verbatim -- PRO argued for the charge (GUILTY), CON argued against it (NOT_GUILTY)", () => {
    expect(ADVOCATE_SYSTEM_PROMPT_V1_PRO).toMatch(/in favor of the charge \(arguing the defendant is GUILTY\)/);
    expect(ADVOCATE_SYSTEM_PROMPT_V1_CON).toMatch(/against the charge \(arguing the defendant is NOT_GUILTY\)/);
  });

  it("is never imported by preflight.ts, tokenEstimation.ts, or execution.ts", () => {
    const liveSources = [
      "netlify/server/openrouter/preflight.ts",
      "netlify/server/openrouter/tokenEstimation.ts",
      "netlify/server/tribunal/execution.ts"
    ].map((relativePath) =>
      readFileSync(path.resolve(process.cwd(), relativePath), "utf8")
    );

    for (const source of liveSources) {
      expect(source).not.toMatch(/from\s+["'][^"']*\/advocate\/v1["']/);
    }
  });
});

describe("advocate-v2 current-text lock (Issue #30 -- exact hash, not merely 'differs from v1')", () => {
  it("PRO matches its locked, reviewed SHA-256 content hash", () => {
    expect(sha256(buildAdvocateSystemPrompt("PRO"))).toBe(ADVOCATE_V2_PRO_SHA256);
  });

  it("CON matches its locked, reviewed SHA-256 content hash", () => {
    expect(sha256(buildAdvocateSystemPrompt("CON"))).toBe(ADVOCATE_V2_CON_SHA256);
  });

  it("ADVOCATE_PROMPT_VERSION currently equals advocate-v2", () => {
    expect(ADVOCATE_PROMPT_VERSION).toBe("advocate-v2");
  });

  it("states the corrected semantics -- PRO is Defense/NOT_GUILTY, CON is Opposition-Prosecution/GUILTY", () => {
    expect(buildAdvocateSystemPrompt("PRO")).toMatch(/Defense \(arguing the defendant is NOT_GUILTY\)/);
    expect(buildAdvocateSystemPrompt("CON")).toMatch(/Opposition\/Prosecution against the defendant \(arguing the defendant is GUILTY\)/);
  });

  it("differs from the archived v1 text -- the correction actually took effect", () => {
    expect(buildAdvocateSystemPrompt("PRO")).not.toBe(ADVOCATE_SYSTEM_PROMPT_V1_PRO);
    expect(buildAdvocateSystemPrompt("CON")).not.toBe(ADVOCATE_SYSTEM_PROMPT_V1_CON);
  });
});

describe("judge-v1 archival immutability (Issue #30 -- rendered-text SHA lock)", () => {
  it("matches its locked SHA-256 content hash", () => {
    expect(sha256(JUDGE_SYSTEM_PROMPT_V1)).toBe(JUDGE_V1_SHA256);
  });

  it("never mentions PRO or CON at all -- the historical text carried no semantic label claim", () => {
    expect(JUDGE_SYSTEM_PROMPT_V1).not.toMatch(/\bPRO\b/);
    expect(JUDGE_SYSTEM_PROMPT_V1).not.toMatch(/\bCON\b/);
  });

  it("is never imported by preflight.ts, tokenEstimation.ts, or execution.ts", () => {
    const liveSources = [
      "netlify/server/openrouter/preflight.ts",
      "netlify/server/openrouter/tokenEstimation.ts",
      "netlify/server/tribunal/execution.ts"
    ].map((relativePath) =>
      readFileSync(path.resolve(process.cwd(), relativePath), "utf8")
    );

    for (const source of liveSources) {
      expect(source).not.toMatch(/from\s+["'][^"']*\/judge\/v1["']/);
    }
  });
});

describe("judge-v2 current-text lock (Issue #30 -- exact hash, not merely 'differs from v1')", () => {
  it("matches its locked, reviewed SHA-256 content hash", () => {
    expect(sha256(JUDGE_SYSTEM_PROMPT)).toBe(JUDGE_V2_SHA256);
  });

  it("JUDGE_PROMPT_VERSION currently equals judge-v2", () => {
    expect(JUDGE_PROMPT_VERSION).toBe("judge-v2");
  });

  it("explicitly defines PRO = Defense/NOT_GUILTY, CON = Opposition-Prosecution/GUILTY", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/PRO participants are the defendant's Defense/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/CON participants are the Opposition\/Prosecution/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/NOT_GUILTY verdict/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/GUILTY verdict/);
  });

  it("preserves Judge independence -- never instructed which verdict to choose", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/You have no assigned side/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/not instructions about how to rule/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/predetermined verdict/);
  });

  it("preserves the verdict output schema -- GUILTY or NOT_GUILTY, plus non-empty reasoning", () => {
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/verdict.*field that is exactly "GUILTY" or "NOT_GUILTY"/);
    expect(JUDGE_SYSTEM_PROMPT).toMatch(/non-empty `reasoning` string field/);
  });

  it("differs from the archived v1 text -- the correction actually took effect", () => {
    expect(JUDGE_SYSTEM_PROMPT).not.toBe(JUDGE_SYSTEM_PROMPT_V1);
  });
});
