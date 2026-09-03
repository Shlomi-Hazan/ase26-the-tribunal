import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithAppProviders } from "../test/renderWithAppProviders";
import { AppRoutes } from "../app/App";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";

const FAKE_USER_OPENROUTER_KEY = "sk-or-v1-test-fake-user-key-jon-snow-demo";

async function connectOpenRouter(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/openrouter api key/i), FAKE_USER_OPENROUTER_KEY);
  await user.click(screen.getByRole("button", { name: /^connect$/i }));
}

const ELIGIBLE_MODEL_CATALOG_WITH_DEFAULT = [
  {
    id: JON_SNOW_DEFAULT_MODEL_ID,
    canonicalModelId: `${JON_SNOW_DEFAULT_MODEL_ID}-20260630`,
    name: "Anthropic: Claude Sonnet 5",
    providerName: "Azure",
    contextLength: 1_000_000,
    promptPricePerMillion: "2",
    completionPricePerMillion: "10",
    isFree: false,
    priceTier: "PREMIUM",
    conservativeFullTribunalEstimateUsd: "0.914408",
    supportsStructuredOutput: true
  },
  {
    id: "openai/gpt-5-nano",
    canonicalModelId: "openai/gpt-5-nano",
    name: "OpenAI: GPT-5 Nano",
    providerName: "Azure",
    contextLength: 400_000,
    promptPricePerMillion: "0.05",
    completionPricePerMillion: "0.4",
    isFree: false,
    priceTier: "BUDGET",
    conservativeFullTribunalEstimateUsd: "0.02",
    supportsStructuredOutput: true
  }
];

const ELIGIBLE_MODEL_CATALOG_WITHOUT_DEFAULT = ELIGIBLE_MODEL_CATALOG_WITH_DEFAULT.filter(
  (model) => model.id !== JON_SNOW_DEFAULT_MODEL_ID
);

let fetchResponseQueue: Array<Response | Promise<Response>> = [];
let modelsCatalog = ELIGIBLE_MODEL_CATALOG_WITH_DEFAULT;

function queueFetchResponse(response: Response | Promise<Response>) {
  fetchResponseQueue.push(response);
}

function nonModelsFetchCalls(): Array<[string, RequestInit | undefined]> {
  return (vi.mocked(globalThis.fetch).mock.calls as Array<[string, RequestInit | undefined]>).filter(
    ([url]) => !url.startsWith("/api/models") && !url.startsWith("/api/runs/")
  );
}

beforeEach(() => {
  fetchResponseQueue = [];
  modelsCatalog = ELIGIBLE_MODEL_CATALOG_WITH_DEFAULT;
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

describe("Jon Snow demo launcher", () => {
  it("presents the canonical case and seat mapping", async () => {
    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    expect(await screen.findByRole("heading", { name: /the jon snow demo/i })).toBeVisible();

    const seatSection = screen.getByText("Seven-participant configuration").closest("div")!;

    expect(within(seatSection).getByText("Jon Snow")).toBeVisible();
    expect(within(seatSection).getByText("Tyrion Lannister")).toBeVisible();
    expect(within(seatSection).getByText("Daenerys Targaryen")).toBeVisible();
    expect(within(seatSection).getByText("Grey Worm")).toBeVisible();
    expect(within(seatSection).getByText("Aharon Barak")).toBeVisible();
    expect(within(seatSection).getByText("Menachem Elon")).toBeVisible();
    expect(within(seatSection).getByText("Meir Shamgar")).toBeVisible();
  });

  it("keeps Run disabled until an OpenRouter credential is connected", async () => {
    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    await waitFor(() => expect(runButton).toBeDisabled());
  });

  it("submits a SHARED-mode request with the default model and all seven canonical participants, with no Smart Extraction call", async () => {
    const user = userEvent.setup();
    queueFetchResponse(
      new Response(
        JSON.stringify({
          run: {
            id: "77777777-7777-4777-8777-777777777777",
            caseId: "88888888-8888-4888-8888-888888888888",
            executionMode: "shared",
            status: "READY",
            createdAt: "2026-08-25T10:00:00.000Z",
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
            id: "77777777-7777-4777-8777-777777777777",
            caseId: "88888888-8888-4888-8888-888888888888",
            executionMode: "shared",
            status: "ADVOCATES_RUNNING",
            createdAt: "2026-08-25T10:00:00.000Z",
            startedAt: "2026-08-25T10:00:01.000Z",
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

    await screen.findByRole("heading", { name: /the jon snow demo/i });
    await connectOpenRouter(user);

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);

    const [url, requestInit] = nonModelsFetchCalls()[0];
    const body = JSON.parse(requestInit!.body as string);

    expect(url).toBe("/api/runs");
    expect(body.executionMode).toBe("shared");
    expect(body.participants).toHaveLength(7);
    expect(
      body.participants.every((participant: { modelId: string }) => participant.modelId === JON_SNOW_DEFAULT_MODEL_ID)
    ).toBe(true);
    expect(body.case.kind).toBe("new");
    expect(body.case.case.defendant).toBe("Jon Snow");
    expect(body.case.case.sourceType).toBe("MANUAL");

    // No setup-time extraction call of any kind -- the canonical preset is
    // static, never a runtime Smart Extraction/LLM call (Issue #32 Sec 4).
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some(([callUrl]) =>
        String(callUrl).includes("/api/setup-extractions")
      )
    ).toBe(false);

    // Navigates to the themed run route on a triggered execution -- the
    // themed banner's own heading (distinct from the launcher page's
    // description sentence, which also mentions the case name).
    expect(
      await screen.findByRole("heading", { name: "The Realm v. Jon Snow" })
    ).toBeVisible();
  });

  it("does not silently fall back to another model when the configured default is ineligible", async () => {
    modelsCatalog = ELIGIBLE_MODEL_CATALOG_WITHOUT_DEFAULT;

    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    expect(
      await screen.findByText(new RegExp(`not currently.*eligible`, "i"))
    ).toBeVisible();

    const runButton = screen.getByRole("button", { name: /run jon snow demo/i });

    expect(runButton).toBeDisabled();

    // The secondary model chooser is reused from the existing eligible-
    // model catalog -- no second discovery mechanism.
    expect(screen.getByLabelText("Model")).toBeVisible();
  });
});
