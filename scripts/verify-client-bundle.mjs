import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const distDirectory = path.resolve("dist");
const forbiddenIdentifiers = [
  "OPENROUTER_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "INTERNAL_FUNCTION_SECRET",
  // Milestone 7A (docs/adr/0004-smart-package-extraction.md Decision 10):
  // server-only configuration, never browser-authoritative or
  // dossier-selected -- same treatment as OPENROUTER_API_KEY above.
  "PACKAGE_EXTRACTION_MODEL_ID"
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return collectFiles(entryPath);
      }

      if (entry.isFile()) {
        return [entryPath];
      }

      return [];
    })
  );

  return files.flat();
}

async function main() {
  const stats = await stat(distDirectory).catch(() => null);

  if (!stats?.isDirectory()) {
    throw new Error("dist/ does not exist. Run npm run build first.");
  }

  const files = await collectFiles(distDirectory);
  const findings = [];

  for (const file of files) {
    const content = await readFile(file, "utf8").catch(() => "");

    for (const identifier of forbiddenIdentifiers) {
      if (content.includes(identifier)) {
        findings.push(`${path.relative(process.cwd(), file)} contains ${identifier}`);
      }
    }
  }

  if (findings.length > 0) {
    throw new Error(
      `Client bundle contains privileged server-only identifiers:\n${findings.join("\n")}`
    );
  }

  console.log("Client bundle secret-boundary check passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
