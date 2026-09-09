import { CssBaseline, ThemeProvider } from "@mui/material";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { jonSnowTheme } from "../theme/jonSnowTheme";
import { theme } from "../theme/theme";
import { isJonSnowThemedPath } from "./jonSnowThemeRoute";

// Milestone 14 (Ivory & Iron, Issue #39 Phase 4): route-scoped theme
// selection. This component must live INSIDE BrowserRouter (so
// useLocation works) but ABOVE AppShell (so the AppBar itself is
// themed, not just page content rendered below it) -- placing theme
// selection inside individual page components cannot reach the
// shell/AppBar rendered above them.
//
// Theme is a PURE FUNCTION of location.pathname -- never persisted to
// run/case state, never inferred from defendant/case content. Only the
// two dedicated Jon Snow demo routes get the full dark chamber; the
// generic /runs/:runId (reused by History/Case Detail regardless of a
// run's origin, Issue #32 Sec 10) always stays Ivory & Iron, even for
// the exact same canonical Jon Snow run's data.
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <ThemeProvider theme={isJonSnowThemedPath(location.pathname) ? jonSnowTheme : theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}
