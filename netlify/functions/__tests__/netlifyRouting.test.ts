// Milestone 11 (Issue #27) -- independent-review correction: netlify.toml's
// /api/cases/:id/runs rule was missing `status = 200`, meaning Netlify's
// documented default (a 301 redirect) applied instead of the same-origin
// rewrite/proxy every other internal API route uses. fetch/browsers follow
// a 301 automatically, so the endpoint appeared to work, but it was not
// the same-origin rewrite contract this milestone intended. A deliberately
// small, deterministic regression guard against that rule regressing or
// being reordered behind the more generic /api/cases/:id rule later --
// not a general TOML parser, mirroring
// scripts/verify-netlify-functions-packaging.mjs's own established
// regex-over-raw-text approach for this same config file.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const netlifyTomlPath = path.resolve(__dirname, "../../../netlify.toml");

function readNetlifyToml(): string {
  return readFileSync(netlifyTomlPath, "utf8");
}

describe("netlify.toml routing (Milestone 11, Issue #27)", () => {
  it("declares /api/cases/:id/runs targeting case-runs?id=:id", () => {
    const toml = readNetlifyToml();

    expect(toml).toMatch(
      /from\s*=\s*"\/api\/cases\/:id\/runs"\s*\n\s*to\s*=\s*"\/\.netlify\/functions\/case-runs\?id=:id"/
    );
  });

  it("is a status = 200 rewrite/proxy, not a default 301 redirect", () => {
    const toml = readNetlifyToml();
    const ruleMatch = toml.match(
      /\[\[redirects\]\]\s*\n\s*from\s*=\s*"\/api\/cases\/:id\/runs"\s*\n\s*to\s*=\s*"\/\.netlify\/functions\/case-runs\?id=:id"\s*\n\s*status\s*=\s*200/
    );

    expect(ruleMatch).not.toBeNull();
  });

  it("precedes the more generic /api/cases/:id rule (Netlify matches redirects in file order)", () => {
    const toml = readNetlifyToml();
    const caseRunsIndex = toml.indexOf('from = "/api/cases/:id/runs"');
    const caseByIdIndex = toml.indexOf('from = "/api/cases/:id"');

    expect(caseRunsIndex).toBeGreaterThan(-1);
    expect(caseByIdIndex).toBeGreaterThan(-1);
    expect(caseRunsIndex).toBeLessThan(caseByIdIndex);
  });

  it("does not weaken any other existing /api rewrite rule (every internal API redirect keeps status = 200)", () => {
    const toml = readNetlifyToml();
    const redirectBlocks = toml
      .split("[[redirects]]")
      .slice(1)
      .map((block) => block.split(/\n\[\[/)[0]);
    const apiBlocks = redirectBlocks.filter((block) => /from\s*=\s*"\/api\//.test(block));

    expect(apiBlocks.length).toBeGreaterThan(0);

    for (const block of apiBlocks) {
      expect(block).toMatch(/status\s*=\s*200/);
    }
  });
});
