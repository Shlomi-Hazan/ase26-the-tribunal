import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoutes } from "../app/App";
import { JON_SNOW_DEFAULT_MODEL_ID } from "../features/jon-snow-demo/jonSnowDefaultModel";
import { renderWithAppProviders } from "../test/renderWithAppProviders";

// Mirrors jonSnowHome.test.tsx's own fake capability token exactly --
// same storage key, same "fake, well-formed capability string" style.
// The real token is validated authoritatively server-side; this is only
// ever compared against sessionStorage presence on the client.
const DEMO_ACCESS_TOKEN = "fake-lecturer-capability";

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

    // Milestone 14 cinematic redesign (PR #40): the page's h1 is now the
    // hero title "The Realm v. Jon Snow" -- "Jon Snow Demo Settings" no
    // longer exists as a heading (settings/model config moved to the
    // page's own "Run Configuration" section, per design). This is the
    // one necessary consequence of the approved redesign's own explicit
    // instruction not to use "Jon Snow Demo Settings" as the primary h1.
    expect(
      await screen.findByRole("heading", { name: /the realm v\. jon snow/i })
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

    await screen.findByRole("heading", { name: /the realm v\. jon snow/i });
    await user.click(screen.getByLabelText("Model"));

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox).getAllByRole("option");
    const optionText = options.map((option) => option.textContent);

    expect(optionText.some((text) => text?.includes("GPT-4o mini"))).toBe(true);
    expect(optionText.some((text) => text?.includes("GPT-4.1 nano"))).toBe(true);
    expect(optionText.some((text) => text?.includes("Claude Sonnet 5"))).toBe(false);
  });

  // M14 presentation-routing correction (PR #40): a Jon Snow run is a
  // real Tribunal run and must land on the exact same generic
  // `/runs/:runId` route/presentation every other run uses -- the dark
  // cinematic Jon Snow identity belongs to this settings page only,
  // never to the run/result screen (the old dedicated themed run route
  // and its JonSnowRunPage wrapper are removed).
  it("running from Settings uses the same dedicated canonical demo endpoint and navigates to the generic /runs/:runId route with no Jon Snow presentation", async () => {
    const user = userEvent.setup();

    // M14 access-gate fix: the Run button now also requires a stored
    // demo access capability (Sec 1) -- granted here exactly as a
    // lecturer's real prepared demo link would (captureJonSnowDemoAccess
    // FromLocation stores it under this same key at app startup).
    sessionStorage.setItem("tribunal.jonSnowDemoAccess", DEMO_ACCESS_TOKEN);

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

    // Generic RunPage's own running-state text (never the removed
    // JonSnowRunPage's "This is the real Tribunal engine" banner copy).
    expect(await screen.findByText(/deliberation in progress/i)).toBeVisible();
    expect(
      screen.queryByRole("heading", { name: "The Realm v. Jon Snow" })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/featured demo/i)).not.toBeInTheDocument();

    const demoCall = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(([url]) => url === "/api/demo/jon-snow/runs");

    expect(demoCall).toBeDefined();
  });
});

// M14 access-gate fix (live-verified root cause, PR #40): a real manual
// attempt reproduced POST /api/demo/jon-snow/runs -> 401
// demo_access_denied -- no stored demo access capability existed in that
// browser tab, yet the Run button was enabled and submitted anyway, and
// useIdempotentStart's generic fallback then misreported the resulting
// 401 as "Tribunal configuration could not be frozen." (a freeze/
// persistence message, for a rejection that happens before any case/run
// is ever attempted). These tests prove: the page stays fully reviewable
// without access (Sec 1), the Run action alone is gated (Sec 1-2), and
// the 401 now formats truthfully (Sec 3) -- with no OpenRouter
// credential UI introduced anywhere (Sec 2/4E).
describe("/demo/jon-snow -- access-gated Run action (M14 fix)", () => {
  it("A: remains fully viewable without any stored demo access -- case, advocates, judges, personalities, model catalog/economics all present, with no OpenRouter credential UI", async () => {
    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    expect(await screen.findByRole("heading", { name: /the realm v\. jon snow/i })).toBeVisible();
    // Case Dossier.
    expect(screen.getByRole("heading", { name: /case dossier/i })).toBeVisible();
    expect(screen.getByText(/jon intentionally killed daenerys/i)).toBeVisible();
    // Advocates -- real profileName, not a placeholder. `level: 3`
    // disambiguates from the Case Dossier's own "Jon Snow" defendant
    // value (an h5), since PersonDossierCard renders names as h3.
    expect(await screen.findByRole("heading", { name: "Jon Snow", level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Tyrion Lannister", level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Daenerys Targaryen", level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Grey Worm", level: 3 })).toBeVisible();
    // Judges.
    expect(screen.getByRole("heading", { name: "Aharon Barak", level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Menachem Elon", level: 3 })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Meir Shamgar", level: 3 })).toBeVisible();
    // Model catalog/economics remain visible and usable for review.
    expect(screen.getByLabelText("Model")).toBeVisible();
    expect(screen.getByText(/conservative estimate/i)).toBeVisible();
    // Never an OpenRouter credential field, with or without access.
    expect(screen.queryByText(/openrouter connection/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/openrouter api key/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/access token/i)).not.toBeInTheDocument();
  });

  it("B: Run Jon Snow Demo stays disabled without stored demo access, even with a valid eligible model ready, and explains why", async () => {
    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    // The model catalog resolves (proving this isn't merely the
    // loading/catalog-not-ready disabled state) -- yet the button stays
    // disabled solely because no demo access is stored.
    await screen.findByText(/conservative estimate/i);
    expect(runButton).toBeDisabled();
    expect(
      screen.getByText(/lecturer demo access is required to run this operator-funded case/i)
    ).toBeVisible();

    // No submission is ever attempted -- confirms this is a client-side
    // gate, not merely a disabled-but-clickable button relying on the
    // server to reject it.
    expect(
      vi.mocked(globalThis.fetch).mock.calls.some(([url]) => url === "/api/demo/jon-snow/runs")
    ).toBe(false);
  });

  it("C: the no-access explanation disappears and Run becomes enabled once a demo access capability is stored", async () => {
    sessionStorage.setItem("tribunal.jonSnowDemoAccess", DEMO_ACCESS_TOKEN);

    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    await waitFor(() => expect(runButton).toBeEnabled());
    expect(
      screen.queryByText(/lecturer demo access is required to run this operator-funded case/i)
    ).not.toBeInTheDocument();
  });

  it("D: a 401 demo_access_denied response formats to a truthful access message, never the generic freeze-failure fallback", async () => {
    const user = userEvent.setup();

    // Access IS stored here -- proving the truthful message reflects the
    // SERVER's authoritative rejection (e.g. a revoked/expired
    // capability), not merely the client-side gate from tests A/B above,
    // which never reaches the network at all.
    sessionStorage.setItem("tribunal.jonSnowDemoAccess", DEMO_ACCESS_TOKEN);
    queueFetchResponse(
      new Response(JSON.stringify({ error: "demo_access_denied" }), { status: 401 })
    );

    renderWithAppProviders(<AppRoutes />, "/demo/jon-snow");

    const runButton = await screen.findByRole("button", { name: /run jon snow demo/i });

    await waitFor(() => expect(runButton).toBeEnabled());
    await user.click(runButton);

    expect(
      await screen.findByText(/jon snow demo access is missing or invalid/i)
    ).toBeVisible();
    expect(
      screen.queryByText(/tribunal configuration could not be frozen/i)
    ).not.toBeInTheDocument();
  });
});
