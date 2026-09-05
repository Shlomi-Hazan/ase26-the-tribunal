// Milestone 14 (Ivory & Iron, Issue #39 Phase 4): the single source of
// truth for which routes get the Jon Snow dark chamber. Kept in its own
// module (not inside AppThemeProvider.tsx) purely so it can be imported
// by both AppThemeProvider and tests without triggering React Fast
// Refresh's "only export components" rule on a component file.
const JON_SNOW_THEME_ROUTE_PREFIX = "/demo/jon-snow";

export function isJonSnowThemedPath(pathname: string): boolean {
  return pathname.startsWith(JON_SNOW_THEME_ROUTE_PREFIX);
}
