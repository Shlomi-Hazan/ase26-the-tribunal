// Milestone 7A -- migration/constant anti-drift check, mirroring
// src/prompts/promptVersionDrift.test.ts's discipline: reads the actual
// migration source (never a separately maintained copy) and asserts its
// embedded literals match the current exported TypeScript constants.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_EXTRACTION_CLAIM_AFTER_MS } from "./constants";

const migrationPath = path.resolve(
  process.cwd(),
  "supabase",
  "migrations",
  "20260828180000_setup_extractions.sql"
);

function readMigration(): string {
  return readFileSync(migrationPath, "utf8");
}

describe("setup_extractions migration anti-drift check", () => {
  it("embeds the current STALE_EXTRACTION_CLAIM_AFTER_MS as an equivalent interval literal", () => {
    const migration = readMigration();
    const expectedSeconds = STALE_EXTRACTION_CLAIM_AFTER_MS / 1000;

    expect(Number.isInteger(expectedSeconds)).toBe(true);
    expect(migration).toContain(`interval '${expectedSeconds} seconds'`);
  });

  it("this migration is not applied to any linked remote Supabase project by this task (documented, not executed)", () => {
    const migration = readMigration();

    expect(migration).toMatch(/NOT applied to any linked remote Supabase project/);
  });

  it("does not modify either existing historical migration file", () => {
    const migrationsDir = path.dirname(migrationPath);
    const m5 = readFileSync(
      path.join(migrationsDir, "20260825000000_create_cases.sql"),
      "utf8"
    );
    const m6 = readFileSync(
      path.join(migrationsDir, "20260825214212_participant_configuration.sql"),
      "utf8"
    );

    // Sanity checks only (matching promptVersionDrift.test.ts's own
    // caveat) -- proves these files still contain their original,
    // recognizable content; the authoritative check is `git diff --check
    // origin/main...HEAD` over these exact paths, run separately as part
    // of verification.
    expect(m5).toContain("create table public.cases");
    expect(m6).toContain("freeze_participant_configuration");
  });

  it("never mutates historical setup_extraction_attempts rows outside the one permitted CLAIMED -> terminal transition (no bare UPDATE without a status = 'CLAIMED' guard on the terminalize/reconcile statements)", () => {
    const migration = readMigration();
    const updateStatements = migration.match(/update public\.setup_extraction_attempts[\s\S]*?;/g) ?? [];

    expect(updateStatements.length).toBeGreaterThan(0);

    for (const statement of updateStatements) {
      expect(statement).toMatch(/status = 'CLAIMED'/);
    }
  });

  it("grants EXECUTE on every write RPC to service_role only, never to public/anon/authenticated", () => {
    const migration = readMigration();
    const grantStatements = migration.match(/grant execute on function[\s\S]*?;/g) ?? [];

    expect(grantStatements.length).toBe(4);

    for (const statement of grantStatements) {
      expect(statement).toContain("to service_role");
      expect(statement).not.toMatch(/to (public|anon|authenticated)/);
    }
  });
});
