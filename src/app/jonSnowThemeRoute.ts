// Milestone 14 (Ivory & Iron, Issue #39 Phase 4): the single source of
// truth for which routes get the Jon Snow dark chamber. Kept in its own
// module (not inside AppThemeProvider.tsx) purely so it can be imported
// by both AppThemeProvider and tests without triggering React Fast
// Refresh's "only export components" rule on a component file.
//
// M14 presentation-routing correction (PR #40): narrowed from a
// `startsWith` prefix match to an EXACT match on the settings page
// itself. The dark chamber is a product identity for the Jon Snow
// demo/settings experience only -- once a run starts, it is a real
// Tribunal run and must render through the exact same generic
// Ivory & Iron `/runs/:runId` presentation every other run uses. The
// legacy `/demo/jon-snow/runs/:runId` route (previously also matched by
// the old prefix) now redirects to `/runs/:runId` (see App.tsx) rather
// than rendering its own themed presentation, so this function no
// longer needs to -- or should -- match it.
const JON_SNOW_SETTINGS_ROUTE = "/demo/jon-snow";

export function isJonSnowThemedPath(pathname: string): boolean {
  return pathname === JON_SNOW_SETTINGS_ROUTE || pathname === `${JON_SNOW_SETTINGS_ROUTE}/`;
}
