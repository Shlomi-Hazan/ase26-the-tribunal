// Milestone 7A -- Smart Import shared constants (kept in their own
// module, not exported from SmartImportPage.tsx, so the page file only
// ever exports its component -- react-refresh/only-export-components
// otherwise flags a mixed component+value export file, matching every
// other page in src/pages/).

// Mirrors netlify/server/extraction/errors.ts's RETRYABLE_EXTRACTION_CODES
// exactly (server code cannot be imported into the client bundle -- see
// npm run verify:client-bundle). smartImport.test.tsx asserts this set
// stays byte-for-byte in sync so the two never silently drift apart.
export const RETRYABLE_ERROR_CODES = new Set([
  "PROVIDER_UNAVAILABLE",
  "TIMEOUT",
  "INVALID_STRUCTURED_OUTPUT"
]);

// Corrected this pass (independent pre-live audit, Section 16): the
// existing TribunalSetupDraft provenance enum (sourceTypeSchema /
// personalitySourceSchema, src/schemas/tribunalSetup.ts) is enforced by
// hard CHECK constraints in ALREADY-APPLIED historical migrations
// (20260825000000_create_cases.sql, 20260825214212_participant_
// configuration.sql) -- adding a new "SMART_IMPORT" enum value would
// require altering those live constraints, out of scope for this pass.
// The existing TRIBUNAL_PACKAGE_FILE/tribunal_package values are reused
// as the interim technical mapping (documented in PR #16 / Issue #15),
// but this distinctive filename marker ensures the Review screen's
// existing "(filename)" detail text never lets that reuse read as a
// literal file upload -- see ReviewPage.tsx's formatSourceType/
// formatPersonalitySource, which render the source-type label
// unchanged, immediately followed by this marker in parentheses.
export const SMART_IMPORT_PROVENANCE_MARKER = "AI Smart Import — not a literal file";
