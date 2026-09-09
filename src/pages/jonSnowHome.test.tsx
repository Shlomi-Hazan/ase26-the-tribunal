import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../app/App";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";
import { renderWithAppProviders } from "../test/renderWithAppProviders";

const DEMO_ACCESS_TOKEN = "fake-lecturer-capability";

const ELIGIBLE_DEFAULT = {
  id: JON_SNOW_DEFAULT_MODEL_ID,
  canonicalModelId: `${JON_SNOW_DEFAULT_MODEL_ID}-20260101`,
  name: "OpenAI: GPT-4o mini",
  providerName: "Azure",
  contextLength: 128_000,
  promptPricePerMillion: "0.15",
  completionPricePerMillion: "0.6",
  isFree: false,
  priceTier: "BUDGET",
  conservativeFullTribunalEstimateUsd: "0.06",
  supportsStructuredOutput: true
};

const OVER_POLICY_DEFAULT = {
  ...ELIGIBLE_DEFAULT,
  priceTier: "PREMIUM",
  conservativeFullTribunalEstimateUsd: "0.90"
};

let modelsCatalog: unknown[] = [ELIGIBLE_DEFAULT];

beforeEach(() => {
  modelsCatalog = [ELIGIBLE_DEFAULT];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/models") {
      return new Response(JSON.stringify({ models: modelsCatalog }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    throw new Error(`Unhandled fetch in test: ${url}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("Home -- Jon Snow featured demo card", () => {
  it("links the dark featured card to the existing Jon Snow settings route and keeps access state subordinate", async () => {
    renderWithAppProviders(<AppRoutes />, "/");

    const card = await screen.findByRole("link", { name: /open the realm v\. jon snow demo/i });

    expect(card).toHaveAttribute("href", "/demo/jon-snow");
    expect(screen.getByText(/lecturer access is required to run/i)).toBeVisible();
  });

  it("keeps over-ceiling default-model state truthful without enabling a Home run action", async () => {
    modelsCatalog = [OVER_POLICY_DEFAULT];
    sessionStorage.setItem("tribunal.jonSnowDemoAccess", DEMO_ACCESS_TOKEN);

    renderWithAppProviders(<AppRoutes />, "/");

    await screen.findByRole("link", { name: /open the realm v\. jon snow demo/i });

    expect(screen.getByText(/outside the demo ceiling/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: /run jon snow demo/i })).not.toBeInTheDocument();
  });

  it("opens the Jon Snow settings route without calling the dedicated run endpoint", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("tribunal.jonSnowDemoAccess", DEMO_ACCESS_TOKEN);

    renderWithAppProviders(<AppRoutes />, "/");

    const card = await screen.findByRole("link", { name: /open the realm v\. jon snow demo/i });

    await user.click(card);

    // Milestone 14 cinematic redesign (PR #40): "Model & economics" was
    // the old dashboard card's heading; the settings/economics content
    // now lives in the redesigned page's "Run Configuration" section, so
    // the page-load anchor here is the page's own h1 instead.
    expect(await screen.findByRole("heading", { name: /the realm v\. jon snow/i })).toBeVisible();
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some(([url]) => url === "/api/demo/jon-snow/runs")
    ).toBe(false);
  });
});
