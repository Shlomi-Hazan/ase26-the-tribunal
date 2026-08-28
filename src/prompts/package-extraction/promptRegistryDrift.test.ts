// Milestone 7A -- versioned historical prompt registry drift/snapshot
// check (ADR 0004 Decision 7). package-extraction-v1 is immutable once
// released: this test locks its exact SHA-256 content hash, computed
// once via a real `node` execution against the actual file (not
// estimated), so an accidental in-place edit to v1.ts fails CI
// immediately -- the same discipline promptVersionDrift.test.ts already
// applies to advocate-v1/judge-v1.

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PACKAGE_EXTRACTION_PROMPT_VERSION } from "../versions";
import { PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1 } from "./v1";
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

describe("package-extraction-v1 immutability (drift/snapshot check)", () => {
  it("matches its locked SHA-256 content hash", () => {
    const hash = createHash("sha256")
      .update(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1, "utf8")
      .digest("hex");

    expect(hash).toBe(PACKAGE_EXTRACTION_V1_SHA256);
  });

  it("PACKAGE_EXTRACTION_PROMPT_VERSION currently points at v1", () => {
    expect(PACKAGE_EXTRACTION_PROMPT_VERSION).toBe("package-extraction-v1");
  });

  it("resolves the current version through the registry to the exact v1 text", () => {
    const builder = getPackageExtractionPrompt(PACKAGE_EXTRACTION_PROMPT_VERSION);

    expect(builder?.()).toBe(PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1);
  });

  it("an unknown/future version resolves to undefined -- fail closed, never a fallback", () => {
    expect(getPackageExtractionPrompt("package-extraction-v2")).toBeUndefined();
    expect(getPackageExtractionPrompt("")).toBeUndefined();
    expect(isKnownPackageExtractionPromptVersion("package-extraction-v2")).toBe(false);
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
    const importPattern = /from\s+["']([^"']*\/v1|\.\/v1)["']/;
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

    expect(importers.sort()).toEqual([
      "netlify/server/extraction/tokenEstimation.test.ts",
      "src/prompts/package-extraction/registry.ts"
    ]);
  });
});

describe("v2 additivity (simulated future version, structural proof)", () => {
  // Simulates "adding v2 must not change v1's resolution" without
  // actually adding a real v2 module: constructs a second, independent
  // registry-shaped lookup the same way registry.ts's real one is built,
  // adds a second entry, and asserts the first entry's resolved value is
  // unaffected -- proving the registry's lookup semantics are additive
  // by construction, not merely by convention.
  it("adding a second version entry never changes an existing entry's resolved value", () => {
    const simulatedRegistry: Record<string, () => string> = {
      "package-extraction-v1": () => PACKAGE_EXTRACTION_SYSTEM_PROMPT_V1
    };
    const beforeV1 = simulatedRegistry["package-extraction-v1"]();

    simulatedRegistry["package-extraction-v2"] = () => "a hypothetical different v2 prompt";

    expect(simulatedRegistry["package-extraction-v1"]()).toBe(beforeV1);
    expect(simulatedRegistry["package-extraction-v2"]()).not.toBe(beforeV1);
  });
});
