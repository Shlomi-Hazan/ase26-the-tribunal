import { describe, expect, it } from "vitest";
import { sharedEndpointCache, sharedModelCache } from "./sharedMetadataCache";
import { MODEL_METADATA_CACHE_MAX_ENTRIES, ModelMetadataCache } from "./cache";

describe("shared metadata cache singletons (production wiring, Section 15-18)", () => {
  it("are ModelMetadataCache instances, not ad-hoc objects", () => {
    expect(sharedModelCache).toBeInstanceOf(ModelMetadataCache);
    expect(sharedEndpointCache).toBeInstanceOf(ModelMetadataCache);
  });

  it("start empty (no accidental cross-test-run seeding)", () => {
    // Each of these is a fresh module instance per test file/process --
    // this asserts the constructor itself never pre-populates state, not
    // that no other test in this same module scope has touched it.
    expect(sharedModelCache.state("models")).toBe("absent");
  });

  it("F: remain bounded -- the endpoint cache never grows past the approved max size", () => {
    const cache = new ModelMetadataCache<string>();

    for (let i = 0; i < MODEL_METADATA_CACHE_MAX_ENTRIES + 50; i += 1) {
      cache.set(`model-${i}`, "value");
    }

    expect(cache.size()).toBe(MODEL_METADATA_CACHE_MAX_ENTRIES);
  });
});
