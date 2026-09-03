import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../app/App";
import { JON_SNOW_DEMO_ACCESS_HEADER } from "../services/jonSnowDemoAccess";
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

let fetchResponseQueue: Array<Response | Promise<Response>> = [];
let modelsCatalog: unknown[] = [ELIGIBLE_DEFAULT];

function queueFetchResponse(response: Response | Promise<Response>) {
  fetchResponseQueue.push(response);
}

beforeEach(() => {
  fetchResponseQueue = [];
  modelsCatalog = [ELIGIBLE_DEFAULT];
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

describe("Home -- Jon Snow one-click primary action", () => {
  it("disables Run when no demo access capability is present, even with an eligible default model", async () => {
    renderWithAppProviders(<AppRoutes />, "/");

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    await waitFor(() => expect(runButton).toBeDisabled());
    expect(screen.getByText(/lecturer presentation link/i)).toBeVisible();
  });

  it("disables Run when the default model is not within the operator-funded $0.13 policy, even with a capability present", async () => {
    modelsCatalog = [OVER_POLICY_DEFAULT];
    sessionStorage.setItem("tribunal.jonSnowDemoAccess", DEMO_ACCESS_TOKEN);

    renderWithAppProviders(<AppRoutes />, "/");

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    await waitFor(() => expect(runButton).toBeDisabled());
    expect(screen.getByText(/not currently eligible within the operator-funded/i)).toBeVisible();
  });

  it("one-click Run calls the dedicated demo endpoint directly (no intermediate /demo/jon-snow navigation) and lands on the themed run route", async () => {
    const user = userEvent.setup();
    sessionStorage.setItem("tribunal.jonSnowDemoAccess", DEMO_ACCESS_TOKEN);

    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "12121212-1212-4121-8121-121212121212",
            caseId: "34343434-3434-4343-8343-343434343434",
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
            id: "12121212-1212-4121-8121-121212121212",
            caseId: "34343434-3434-4343-8343-343434343434",
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

    renderWithAppProviders(<AppRoutes />, "/");

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);

    // Reached the themed run route directly -- never an intermediate
    // /demo/jon-snow page render (the Settings page's own "Model &
    // economics" heading never appears). Asserted via the themed
    // banner's own body copy (unique to JonSnowRunPage), not its
    // heading text alone -- Home's own card also renders a same-named
    // "The Realm v. Jon Snow" heading, which would otherwise make an
    // in-flight navigation ambiguous/flaky.
    expect(
      await screen.findByText(/this is the real tribunal engine/i)
    ).toBeVisible();
    expect(screen.queryByText(/model & economics/i)).not.toBeInTheDocument();

    const demoCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => url === "/api/demo/jon-snow/runs");

    expect(demoCall).toBeDefined();
    const [, requestInit] = demoCall!;
    const headers = requestInit!.headers as Record<string, string>;

    expect(headers[JON_SNOW_DEMO_ACCESS_HEADER]).toBe(DEMO_ACCESS_TOKEN);
    const body = JSON.parse(requestInit!.body as string);

    expect(body.modelId).toBe(JON_SNOW_DEFAULT_MODEL_ID);
    expect(typeof body.clientRequestId).toBe("string");

    // No OpenRouterConnect anywhere in this one-click path.
    expect(screen.queryByText(/openrouter connection/i)).not.toBeInTheDocument();
  });
});
