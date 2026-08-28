// Milestone 7A -- semantic fingerprint (ADR 0004 Decision 15). Mirrors
// netlify/server/runs.ts's computeRequestFingerprint pattern (SHA-256 hex
// digest over a canonical, deterministically ordered structure) --
// conceptually reused, not imported, since the inputs are structurally
// different (no participants/case, a single normalized dossier string).
//
// Computed over exactly: the normalized dossier text, the (frozen)
// prompt version, and the (frozen) configured model identity.
// `source.kind` is deliberately excluded (Decision 15, locked) -- the
// extraction prompt only ever sees normalized text, never source-kind-
// derived context.

import { createHash } from "node:crypto";

export function computeExtractionFingerprint(input: {
  normalizedDossierText: string;
  promptVersion: string;
  configuredModelId: string;
}): string {
  const canonical = {
    dossier: input.normalizedDossierText,
    promptVersion: input.promptVersion,
    configuredModelId: input.configuredModelId
  };

  return createHash("sha256")
    .update(canonicalStringify(canonical), "utf8")
    .digest("hex");
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const entries = keys.map(
    (key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`
  );

  return `{${entries.join(",")}}`;
}
