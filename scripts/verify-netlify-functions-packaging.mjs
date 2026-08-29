// Milestone 7A deployment-packaging correction. `pdfjs-dist` is
// referenced only via a dynamic import() INSIDE AN EVAL'D
// node:worker_threads Worker source string
// (netlify/server/extraction/inputPipeline.ts's PDF_WORKER_SOURCE) --
// esbuild's static dependency tracer cannot discover a require/import
// written inside a string literal, so netlify.toml's [functions] table
// MUST explicitly declare `node_bundler = "esbuild"` and
// `external_node_modules = ["pdfjs-dist"]` (verified against the real
// @netlify/zip-it-and-ship-it packaging engine and a real Node
// worker_threads resolution test -- see PR #16 / Issue #15) or the
// deployed setup-extractions* Netlify Functions could silently ship
// without pdfjs-dist even though everything resolves correctly in local
// dev and in `npm run test`/`npm run build` (neither of which packages
// real Netlify Functions at all).
//
// This is a deliberately small, deterministic regression guard against
// that specific directive being weakened or removed later -- e.g. by an
// unrelated netlify.toml edit -- not a general TOML validator and not a
// replacement for actually running the real packaging gate (see
// PR #16 / Issue #15 for how to do that).

import { readFile } from "node:fs/promises";
import path from "node:path";

const netlifyTomlPath = path.resolve("netlify.toml");

function extractFunctionsTableBody(tomlText) {
  const lines = tomlText.split("\n");
  const startIndex = lines.findIndex((line) => line.trim() === "[functions]");

  if (startIndex === -1) {
    return null;
  }

  const bodyLines = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    // Any other top-level ("[...]") or array-of-tables ("[[...]]")
    // header ends the [functions] table.
    if (/^\s*\[/.test(line)) {
      break;
    }

    bodyLines.push(line);
  }

  return bodyLines.join("\n");
}

async function main() {
  const tomlText = await readFile(netlifyTomlPath, "utf8").catch(() => {
    throw new Error(`Could not read ${netlifyTomlPath}.`);
  });

  const functionsBody = extractFunctionsTableBody(tomlText);

  if (functionsBody === null) {
    throw new Error(
      "netlify.toml has no [functions] table -- expected node_bundler = \"esbuild\" and " +
        'external_node_modules including "pdfjs-dist" (Milestone 7A deployment-packaging fix).'
    );
  }

  if (!/node_bundler\s*=\s*"esbuild"/.test(functionsBody)) {
    throw new Error(
      'netlify.toml\'s [functions] table must set node_bundler = "esbuild" -- ' +
        "external_node_modules is only honored by that bundler."
    );
  }

  const externalNodeModulesMatch = functionsBody.match(
    /external_node_modules\s*=\s*\[([^\]]*)\]/
  );

  if (!externalNodeModulesMatch) {
    throw new Error(
      'netlify.toml\'s [functions] table must set external_node_modules = ["pdfjs-dist", ...] -- ' +
        "pdfjs-dist is otherwise invisible to esbuild's static dependency tracer (it is referenced " +
        "only via a dynamic import() inside an eval'd worker source string) and could be silently " +
        "omitted from the deployed Function artifact."
    );
  }

  const declaredModules = externalNodeModulesMatch[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^["']|["']$/g, ""))
    .filter((entry) => entry.length > 0);

  if (!declaredModules.includes("pdfjs-dist")) {
    throw new Error(
      `netlify.toml's [functions].external_node_modules is missing "pdfjs-dist" (found: ${JSON.stringify(declaredModules)}).`
    );
  }

  console.log("Netlify Functions packaging directive for pdfjs-dist verified in netlify.toml.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
