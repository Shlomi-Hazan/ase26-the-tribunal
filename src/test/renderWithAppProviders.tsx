import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { AppThemeProvider } from "../app/AppThemeProvider";
import { SetupProvider } from "../features/case-setup/SetupProvider";

// Milestone 14 (Ivory & Iron, Issue #39 Phase 4): this helper now wraps
// with the SAME route-scoped AppThemeProvider App.tsx itself uses,
// rather than a fixed light ThemeProvider -- so any test rendering at a
// /demo/jon-snow* path exercises the real production dark-chamber
// wiring, and every other existing test (all other paths) keeps
// getting the same Ivory & Iron theme it always has.
export function renderWithAppProviders(
  ui: ReactElement,
  initialPath = "/new/charge-sheet"
) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AppThemeProvider>
        <SetupProvider>{ui}</SetupProvider>
      </AppThemeProvider>
    </MemoryRouter>
  );
}
