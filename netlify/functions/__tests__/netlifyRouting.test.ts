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
//
// Milestone 15 (M15 production routing correction) -- the four dynamic
// rewrites below (/api/cases/:id/runs, /api/cases/:id, /api/runs/:id,
// /api/setup-extractions/:id/retry) previously targeted
// ".../<function>?id=:id", relying on a Netlify path placeholder being
// substituted into the rewrite target's QUERY STRING -- documented as
// unsupported ("A placeholder either matches a path segment from one `/`
// to the next `/`... but excluding a query string" --
// https://docs.netlify.com/manage/routing/redirects/redirect-options/)
// and confirmed broken live in production. The corrected rewrites carry
// no query string at all; the Functions themselves now extract the
// dynamic id from the original request path
// (netlify/server/routing.ts's resolveRouteId). This suite now proves
// all four corrected rules directly and guards against the specific
// `?id=:id` pattern ever being reintroduced for any Function target.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const netlifyTomlPath = path.resolve(__dirname, "../../../netlify.toml");

function readNetlifyToml(): string {
  return readFileSync(netlifyTomlPath, "utf8");
}

function getRedirectBlocks(toml: string): string[] {
  return toml
    .split("[[redirects]]")
    .slice(1)
    .map((block) => block.split(/\n\[\[/)[0]);
}

describe("netlify.toml routing (Milestone 11, Issue #27 / Milestone 15 routing correction)", () => {
  const dynamicApiRules: Array<{ from: string; to: string }> = [
    { from: "/api/cases/:id/runs", to: "/.netlify/functions/case-runs" },
    { from: "/api/cases/:id", to: "/.netlify/functions/case-by-id" },
    { from: "/api/runs/:id", to: "/.netlify/functions/run-by-id" },
    {
      from: "/api/setup-extractions/:id/retry",
      to: "/.netlify/functions/setup-extractions-retry"
    }
  ];

  it.each(dynamicApiRules)(
    "declares $from as a status = 200 rewrite/proxy targeting $to with no query string",
    ({ from, to }) => {
      const toml = readNetlifyToml();
      const escapedFrom = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const escapedTo = to.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const ruleMatch = toml.match(
        new RegExp(
          `\\[\\[redirects\\]\\]\\s*\\n\\s*from\\s*=\\s*"${escapedFrom}"\\s*\\n\\s*to\\s*=\\s*"${escapedTo}"\\s*\\n\\s*status\\s*=\\s*200`
        )
      );

      expect(ruleMatch).not.toBeNull();
    }
  );

  it("never reintroduces a `?id=:id` (or any `?...=:...`) path-placeholder-into-query-string interpolation for a Function target", () => {
    const toml = readNetlifyToml();
    const functionTargets = [...toml.matchAll(/to\s*=\s*"(\/\.netlify\/functions\/[^"]*)"/g)].map(
      (match) => match[1]
    );

    expect(functionTargets.length).toBeGreaterThan(0);

    for (const target of functionTargets) {
      expect(target).not.toMatch(/\?.*:[A-Za-z_]/);
    }
  });

  it("precedes the more generic /api/cases/:id rule (Netlify matches redirects in file order)", () => {
    const toml = readNetlifyToml();
    const caseRunsIndex = toml.indexOf('from = "/api/cases/:id/runs"');
    const caseByIdIndex = toml.indexOf('from = "/api/cases/:id"');

    expect(caseRunsIndex).toBeGreaterThan(-1);
    expect(caseByIdIndex).toBeGreaterThan(-1);
    expect(caseRunsIndex).toBeLessThan(caseByIdIndex);
  });

  it("keeps every other /api rewrite rule unaffected: still exactly 15 explicit /api/... rules, every one status = 200", () => {
    const toml = readNetlifyToml();
    const apiBlocks = getRedirectBlocks(toml).filter((block) => /from\s*=\s*"\/api\//.test(block));

    expect(apiBlocks).toHaveLength(15);

    for (const block of apiBlocks) {
      expect(block).toMatch(/status\s*=\s*200/);
    }
  });

  it("keeps exactly one SPA catch-all rule after every /api rule", () => {
    const toml = readNetlifyToml();
    const blocks = getRedirectBlocks(toml);
    const catchAllBlocks = blocks.filter((block) => /from\s*=\s*"\/\*"/.test(block));

    expect(catchAllBlocks).toHaveLength(1);
    expect(blocks).toHaveLength(16);
    expect(blocks.at(-1)).toMatch(/from\s*=\s*"\/\*"/);
  });
});
