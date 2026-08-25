import { CssBaseline, ThemeProvider } from "@mui/material";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { SetupProvider } from "../features/case-setup/SetupProvider";
import { theme } from "../theme/theme";

export function renderWithAppProviders(
  ui: ReactElement,
  initialPath = "/new/charge-sheet"
) {
  return render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <MemoryRouter initialEntries={[initialPath]}>
        <SetupProvider>{ui}</SetupProvider>
      </MemoryRouter>
    </ThemeProvider>
  );
}
