import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../app/App";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";
import { renderWithAppProviders } from "../test/renderWithAppProviders";

const CHEAP_DEFAULT = {
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

const CHEAP_ALTERNATE = {
  id: "openai/gpt-4.1-nano",
  canonicalModelId: "openai/gpt-4.1-nano-20260101",
  name: "OpenAI: GPT-4.1 nano",
  providerName: "Azure",
  contextLength: 1_047_576,
  promptPricePerMillion: "0.1",
  completionPricePerMillion: "0.4",
  isFree: false,
  priceTier: "BUDGET",
  conservativeFullTribunalEstimateUsd: "0.04",
  supportsStructuredOutput: true
};

const OVER_POLICY_MODEL = {
  id: "anthropic/claude-sonnet-5",
  canonicalModelId: "anthropic/claude-sonnet-5-20260101",
  name: "Anthropic: Claude Sonnet 5",
  providerName: "Azure",
  contextLength: 1_000_000,
  promptPricePerMillion: "2",
  completionPricePerMillion: "10",
  isFree: false,
  priceTier: "PREMIUM",
  conservativeFullTribunalEstimateUsd: "0.91",
  supportsStructuredOutput: true
};

let modelsCatalog: unknown[] = [CHEAP_DEFAULT, CHEAP_ALTERNATE, OVER_POLICY_MODEL];
let fetchResponseQueue: Array<Response | Promise<Response>> = [];

function queueFetchResponse(response: Response | Promise<Response>) {
  fetchResponseQueue.push(response);
}

beforeEach(() => {
  modelsCatalog = [CHEAP_DEFAULT, CHEAP_ALTERNATE, OVER_POLICY_MODEL];
  fetchResponseQueue = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    if (url === "/api/models") {
      return new Response(JSON.stringify({ models: modelsCatalog }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }

    const next = fetchResponseQueue.shift();

    if (next === undefined) {
      throw new Error(`Unhandled fetch in test: ${url}`);
    }

    return next;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  sessionStorage.clear();
});

describe("/demo/jon-snow -- Modify settings / models", () => {
  it("shows the canonical case, seat mapping, and the dossier's actual global disclaimer -- with no OpenRouterConnect", async () => {
    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    expect(
      await screen.findByRole("heading", { name: /jon snow demo settings/i })
    ).toBeVisible();
    expect(
      screen.getByText(
        "Fictional proceeding. The profiles adapt judicial methods; they do not impersonate the judges or predict a real court."
      )
    ).toBeVisible();
    expect(screen.queryByText(/openrouter connection/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/openrouter api key/i)).not.toBeInTheDocument();
  });

  it("restricts the model chooser to eligible models within the $0.13 operator-funded demo ceiling -- omitting an expensive model entirely", async () => {
    const user = userEvent.setup();

    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    await screen.findByRole("heading", { name: /jon snow demo settings/i });
    await user.click(screen.getByLabelText("Model"));

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    const optionText = options.map((option) => option.textContent);

    expect(optionText.some((text) => text?.includes("GPT-4o mini"))).toBe(true);
    expect(optionText.some((text) => text?.includes("GPT-4.1 nano"))).toBe(true);
    expect(optionText.some((text) => text?.includes("Claude Sonnet 5"))).toBe(false);
  });

  it("running from Settings uses the same dedicated canonical demo endpoint and navigates to the themed run route", async () => {
    const user = userEvent.setup();

    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "56565656-5656-4565-8565-565656565656",
            caseId: "78787878-7878-4787-8787-787878787878",
            executionMode: "shared",
            status: "READY",
            createdAt: "2026-09-03T10:00:00.000Z",
            participants: []
          },
          executionTriggered: true
        }),
        { status: 201 }
      )
    );
    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "56565656-5656-4565-8565-565656565656",
            caseId: "78787878-7878-4787-8787-787878787878",
            executionMode: "shared",
            status: "ADVOCATES_RUNNING",
            createdAt: "2026-09-03T10:00:00.000Z",
            startedAt: "2026-09-03T10:00:01.000Z",
            completedAt: null,
            majorityVerdict: null,
            failureCode: null,
            failureMessage: null,
            totalCostUsd: null,
            advocateCostUsd: null,
            judgeCostUsd: null,
            totalInputTokens: null,
            totalOutputTokens: null,
            totalTokens: null,
            logicalCallCount: 0,
            providerAttemptCount: 0,
            wallClockMs: null,
            partialSpend: null,
            admission: null,
            attempts: [],
            protocol: null,
            participants: []
          }
        }),
        { status: 200 }
      )
    );

    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);

    expect(await screen.findByText(/this is the real tribunal engine/i)).toBeVisible();

    const demoCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => url === "/api/demo/jon-snow/runs");

    expect(demoCall).toBeDefined();
  });
});
