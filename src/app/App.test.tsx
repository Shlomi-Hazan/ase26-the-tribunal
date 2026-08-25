import { CssBaseline, ThemeProvider } from "@mui/material";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "./App";
import { theme } from "../theme/theme";

function renderWithProviders(initialPath = "/") {
  return render(
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <MemoryRouter initialEntries={[initialPath]}>
        <AppRoutes />
      </MemoryRouter>
    </ThemeProvider>
  );
}

describe("App", () => {
  it("renders the root application foundation", () => {
    renderWithProviders();

    expect(
      screen.getByRole("heading", { name: "The Tribunal" })
    ).toBeVisible();
    expect(screen.getByText(/application foundation is running/i)).toBeVisible();
  });

  it("renders a not-found route", () => {
    renderWithProviders("/missing");

    expect(screen.getByRole("heading", { name: /page not found/i })).toBeVisible();
  });
});
