import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppRoutes } from "../../app/App";
import { renderWithAppProviders } from "../../test/renderWithAppProviders";

describe("mock deliberation states", () => {
  it("shows participant statuses and a retrying state", () => {
    renderWithAppProviders(<AppRoutes />, "/demo/deliberation?scenario=retry");

    expect(screen.getByRole("heading", { name: /the tribunal is in session/i })).toBeVisible();
    expect(screen.getByText("PRO I")).toBeVisible();
    expect(screen.getByText("CON II")).toBeVisible();
    expect(screen.getByLabelText("Status: Retrying")).toBeVisible();
  });

  it("shows the judge phase with barrier copy", () => {
    renderWithAppProviders(<AppRoutes />, "/demo/deliberation?scenario=judge");

    expect(screen.getByText(/all arguments received/i)).toBeVisible();
    expect(screen.getByText("Judge I")).toBeVisible();
    expect(screen.getByText("Judge II")).toBeVisible();
    expect(screen.getByText("Judge III")).toBeVisible();
  });

  it("keeps advocate terminal failure distinct from verdicts", () => {
    renderWithAppProviders(
      <AppRoutes />,
      "/demo/deliberation?scenario=advocate-failure"
    );

    expect(screen.getByRole("heading", { name: /tribunal could not complete/i })).toBeVisible();
    expect(screen.getByText(/judges were not started/i)).toBeVisible();
    expect(screen.queryByText("TRIBUNAL VERDICT")).not.toBeInTheDocument();
  });

  it("keeps judge terminal failure from producing a majority", () => {
    renderWithAppProviders(
      <AppRoutes />,
      "/demo/deliberation?scenario=judge-failure"
    );

    expect(screen.getByText(/no majority verdict was calculated/i)).toBeVisible();
    expect(screen.queryByText("TRIBUNAL VERDICT")).not.toBeInTheDocument();
  });

  it("renders budget blocked as a pre-execution state", () => {
    renderWithAppProviders(
      <AppRoutes />,
      "/demo/deliberation?scenario=budget-blocked"
    );

    expect(
      screen.getByRole("heading", { name: /configuration cannot be convened/i })
    ).toBeVisible();
    expect(screen.getByText(/policy limit: \$5.00/i)).toBeVisible();
    expect(screen.queryByLabelText("Status: Failed")).not.toBeInTheDocument();
  });
});
