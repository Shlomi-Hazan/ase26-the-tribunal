// Milestone 7A -- versioned historical prompt registry drift/snapshot
// check (ADR 0004 Decision 7). package-extraction-v1 is immutable once
// released: this test locks its exact SHA-256 content hash, computed
// once via a real `node` execution against the actual file (not
// estimated), so an accidental in-place edit to v1.ts fails CI
// immediately -- the same discipline promptVersionDrift.test.ts already
// applies to advocate/judge.
//
// PRO/CON semantic correction (Issue #30): package-extraction-v2 added
// additively. v2's hash is ALSO locked, not merely proven "different
// from v1" -- an accidental later edit to v2's text, with
// PACKAGE_EXTRACTION_PROMPT_VERSION left unchanged at
// "package-extraction-v2", must fail this test too (the same
// closed-drift-gap discipline applied to the Advocate/Judge locks).

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../versions";
import { PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1 } from "./v1";
import { PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2 } from "./v2";
import {
  getPackageExtractionPrompt,
  isKnownPackageExtractionPromptVersion
} from "./registry";

// Computed via: node -e 'import("./v1.ts").then(m => console.log(
//   require("crypto").createHash("sha256")
//     .update(m.PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1, "utf8").digest("hex")))'
// against the real file -- not a placeholder.
const PACKAGE_EXTRACTION_V1_SHA256 =
  "3bc54f1a6ab8737445afea583f2652661b98babc90af063760c6b9d9756fc311";

// Computed the same way against the real v2.ts file, immediately after
// its text was written and reviewed as part of the Issue #30 correction.
const PACKAGE_EXTRACTION_V2_SHA256 =
  "004d8ed56c74d0ccdeb883f295b6dfec8e98e19e03d17b4a40f75b3c1e882060";

describe("package-extraction-v1 immutability (drift/snapshot check)", () => {
  it("matches its locked SHA-256 content hash", () => {
    const hash = createHash("sha256")
      .update(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1, "utf8")
      .digest("hex");

    expect(hash).toBe(PACKAGE_EXTRACTION_V1_SHA256);
  });

  it("v1 remains resolvable through the registry for historical extraction replay/audit", () => {
    const builder = getPackageExtractionPrompt("package-extraction-v1");

    expect(builder?.()).toBe(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1);
  });

  it("no module outside package-extraction/ imports v1.ts directly, except registry.ts (resolution) and this drift test's own byte-length verification", () => {
    // A structural guard, not exhaustive: registry.ts is the sole
    // RESOLUTION point every application call site uses (Decision 7);
    // this test file itself also imports v1.ts directly to independently
    // verify EXTRACTION_FIXED_PROMPT_OVERHEAD_TOKENS's exact byte-length
    // computation (tokenEstimation.test.ts) -- a test-only exception,
    // never an application code path. Enforced by scanning
    // the source tree directly (Node fs, not a shell grep pipeline,
    // which is significantly more fragile against relative-vs-absolute
    // import path spelling) rather than a runtime check, since "who
    // imports this module" is a static-source property.
    const repoRoot = path.resolve(process.cwd());
    // PRO/CON semantic correction (Issue #30): scoped specifically to
    // package-extraction's own v1.ts -- the earlier, broader
    // "anything ending in /v1" pattern false-positived against the new,
    // unrelated src/prompts/advocate/v1.ts and src/prompts/judge/v1.ts
    // archival modules (imported by src/prompts/promptVersionDrift.test.ts,
    // a completely different drift check).
    const importPattern = /from\s+["']([^"']*package-extraction\/v1|\.\/v1)["']/;
    const importers: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === ".netlify") {
          continue;
        }

        const fullPath = path.join(dir, entry);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
          walk(fullPath);
          continue;
        }

        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) {
          continue;
        }

        if (fullPath.endsWith(path.join("package-extraction", "v1.ts"))) {
          continue; // v1.ts does not import itself.
        }

        if (fullPath.endsWith(path.join("package-extraction", "promptRegistryDrift.test.ts"))) {
          continue; // This test file's own comment/regex text is not an import.
        }

        const content = readFileSync(fullPath, "utf8");

        if (importPattern.test(content)) {
          importers.push(path.relative(repoRoot, fullPath));
        }
      }
    }

    walk(path.join(repoRoot, "src"));
    walk(path.join(repoRoot, "netlify"));

    // PRO/CON semantic correction (Issue #30): tokenEstimation.test.ts's
    // "real" byte-length comparison now tracks the CURRENT version
    // (v2), not v1 -- it no longer imports v1.ts directly.
    expect(importers.sort()).toEqual(["src/prompts/package-extraction/registry.ts"]);
  });
});

describe("package-extraction-v2 (current version, Issue #30 PRO/CON semantic correction)", () => {
  it("matches its locked SHA-256 content hash -- not merely 'differs from v1'", () => {
    // A weaker check (live text != v1 text) cannot detect a later
    // accidental edit to v2's own text while the version constant stays
    // "package-extraction-v2" -- two different v2 texts would both still
    // pass that weaker check. An exact reviewed hash closes that gap.
    const hash = createHash("sha256")
      .update(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2, "utf8")
      .digest("hex");

    expect(hash).toBe(PACKAGE_EXTRACTION_V2_SHA256);
  });

  it("PACKAGE_EXTRACTION_PROMPT_VERSION currently points at v2", () => {
    expect(PACKAGE_EXTRACTION_PROMPT_VERSION).toBe("package-extraction-v2");
  });

  it("resolves the current version through the registry to the exact v2 text", () => {
    const builder = getPackageExtractionPrompt(PACKAGE_EXTRACTION_PROMPT_VERSION);

    expect(builder?.()).toBe(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2);
  });

  it("v2's text differs from v1's -- the correction actually took effect", () => {
    expect(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2).not.toBe(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1);
  });

  it("explicitly defines the PRO/CON seat mapping -- Defense -> PRO_*, Prosecution/Opposition -> CON_*", () => {
    expect(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2).toMatch(/defendant's Defense/i);
    expect(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2).toMatch(/Opposition\/Prosecution/i);
    expect(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V2).toMatch(/never by surface wording similarity/i);
  });

  it("v1's text is unchanged by v2's addition (registry additivity, real modules)", () => {
    const v1Builder = getPackageExtractionPrompt("package-extraction-v1");

    expect(v1Builder?.()).toBe(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1);
  });

  it("an unknown/future version resolves to undefined -- fail closed, never a fallback", () => {
    expect(getPackageExtractionPrompt("package-extraction-v3")).toBeUndefined();
    expect(getPackageExtractionPrompt("")).toBeUndefined();
    expect(isKnownPackageExtractionPromptVersion("package-extraction-v3")).toBe(false);
  });

  it("no module outside package-extraction/ imports v2.ts directly, except registry.ts", () => {
    const repoRoot = path.resolve(process.cwd());
    // Scoped specifically to package-extraction's own v2.ts -- same
    // false-positive rationale as the v1 check above.
    const importPattern = /from\s+["']([^"']*package-extraction\/v2|\.\/v2)["']/;
    const importers: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === "dist" || entry === ".netlify") {
          continue;
        }

        const fullPath = path.join(dir, entry);
        const stats = statSync(fullPath);

        if (stats.isDirectory()) {
          walk(fullPath);
          continue;
        }

        if (!entry.endsWith(".ts") && !entry.endsWith(".tsx")) {
          continue;
        }

        if (fullPath.endsWith(path.join("package-extraction", "v2.ts"))) {
          continue;
        }

        if (fullPath.endsWith(path.join("package-extraction", "promptRegistryDrift.test.ts"))) {
          continue;
        }

        const content = readFileSync(fullPath, "utf8");

        if (importPattern.test(content)) {
          importers.push(path.relative(repoRoot, fullPath));
        }
      }
    }

    walk(path.join(repoRoot, "src"));
    walk(path.join(repoRoot, "netlify"));

    // tokenEstimation.test.ts's "real" byte-length comparison now
    // imports v2.ts directly (the current version).
    expect(importers.sort()).toEqual([
      "netlify/server/extraction/tokenEstimation.test.ts",
      "src/prompts/package-extraction/registry.ts"
    ]);
  });
});
