import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  captureJonSnowDemoAccessFromLocation,
  getJonSnowDemoAccessToken,
  hasJonSnowDemoAccess,
  JON_SNOW_DEMO_ACCESS_HEADER,
  withJonSnowDemoAccessHeader
} from "./jonSnowDemoAccess";

function setLocation(hash: string) {
  window.history.replaceState(null, "", `/${hash}`);
}

beforeEach(() => {
  sessionStorage.clear();
  setLocation("");
});

afterEach(() => {
  sessionStorage.clear();
  setLocation("");
});

describe("captureJonSnowDemoAccessFromLocation", () => {
  it("stores a token found in the URL fragment and strips it from the visible URL", () => {
    setLocation("#demo=secret-token-abc");

    captureJonSnowDemoAccessFromLocation();

    expect(getJonSnowDemoAccessToken()).toBe("secret-token-abc");
    expect(window.location.hash).toBe("");
  });

  it("does nothing when there is no fragment", () => {
    setLocation("");

    captureJonSnowDemoAccessFromLocation();

    expect(hasJonSnowDemoAccess()).toBe(false);
  });

  it("does nothing when the fragment does not carry a demo token", () => {
    setLocation("#other=value");

    captureJonSnowDemoAccessFromLocation();

    expect(hasJonSnowDemoAccess()).toBe(false);
  });

  it("ignores a blank/whitespace-only token", () => {
    setLocation("#demo=%20%20");

    captureJonSnowDemoAccessFromLocation();

    expect(hasJonSnowDemoAccess()).toBe(false);
  });
});

describe("withJonSnowDemoAccessHeader", () => {
  it("attaches the stored capability under the dedicated header, distinct from any OpenRouter header", () => {
    setLocation("#demo=my-capability");
    captureJonSnowDemoAccessFromLocation();

    const headers = withJonSnowDemoAccessHeader({ "content-type": "application/json" });

    expect(headers[JON_SNOW_DEMO_ACCESS_HEADER]).toBe("my-capability");
    expect(headers["x-user-openrouter-key"]).toBeUndefined();
  });

  it("leaves headers unchanged when nothing is stored", () => {
    const headers = withJonSnowDemoAccessHeader({ "content-type": "application/json" });

    expect(headers[JON_SNOW_DEMO_ACCESS_HEADER]).toBeUndefined();
  });
});
