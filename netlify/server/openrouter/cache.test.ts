import { describe, expect, it } from "vitest";
import { cachedFetch, ModelMetadataCache, MODEL_METADATA_TTL_MS } from "./cache";

function makeClock(startMs: number) {
  let now = startMs;

  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    }
  };
}

describe("ModelMetadataCache TTL boundary", () => {
  it("is fresh at TTL - 1ms", () => {
    const { clock, advance } = makeClock(0);
    const cache = new ModelMetadataCache<string>(MODEL_METADATA_TTL_MS, clock);
    cache.set("key", "value");
    advance(MODEL_METADATA_TTL_MS - 1);

    expect(cache.state("key")).toBe("fresh");
  });

  it("is stale at exactly TTL", () => {
    const { clock, advance } = makeClock(0);
    const cache = new ModelMetadataCache<string>(MODEL_METADATA_TTL_MS, clock);
    cache.set("key", "value");
    advance(MODEL_METADATA_TTL_MS);

    expect(cache.state("key")).toBe("stale");
  });

  it("is absent for a key never set", () => {
    const cache = new ModelMetadataCache<string>();

    expect(cache.state("missing")).toBe("absent");
  });
});

describe("cachedFetch refresh-with-fallback semantics", () => {
  it("fresh cache is used without a refetch", async () => {
    const { clock } = makeClock(0);
    const cache = new ModelMetadataCache<string>(MODEL_METADATA_TTL_MS, clock);
    cache.set("key", "cached-value");

    let fetchCount = 0;
    const value = await cachedFetch(cache, "key", async () => {
      fetchCount += 1;
      return "new-value";
    });

    expect(value).toBe("cached-value");
    expect(fetchCount).toBe(0);
  });

  it("stale + successful refetch replaces the cached value", async () => {
    const { clock, advance } = makeClock(0);
    const cache = new ModelMetadataCache<string>(MODEL_METADATA_TTL_MS, clock);
    cache.set("key", "old-value");
    advance(MODEL_METADATA_TTL_MS);

    const value = await cachedFetch(cache, "key", async () => "new-value");

    expect(value).toBe("new-value");
    expect(cache.get("key")).toBe("new-value");
  });

  it("stale + failed refetch blocks (propagates the failure)", async () => {
    const { clock, advance } = makeClock(0);
    const cache = new ModelMetadataCache<string>(MODEL_METADATA_TTL_MS, clock);
    cache.set("key", "old-value");
    advance(MODEL_METADATA_TTL_MS);

    await expect(
      cachedFetch(cache, "key", async () => {
        throw new Error("provider unavailable");
      })
    ).rejects.toThrow("provider unavailable");
  });

  it("no cache + successful fetch stores and uses the fresh value", async () => {
    const cache = new ModelMetadataCache<string>();

    const value = await cachedFetch(cache, "key", async () => "first-value");

    expect(value).toBe("first-value");
    expect(cache.get("key")).toBe("first-value");
  });

  it("no cache + failed fetch blocks", async () => {
    const cache = new ModelMetadataCache<string>();

    await expect(
      cachedFetch(cache, "key", async () => {
        throw new Error("provider unavailable");
      })
    ).rejects.toThrow("provider unavailable");
  });

  it("fresh cache + provider unavailable: fresh cache is still used without ever calling the fetcher", async () => {
    const { clock } = makeClock(0);
    const cache = new ModelMetadataCache<string>(MODEL_METADATA_TTL_MS, clock);
    cache.set("key", "cached-value");

    const value = await cachedFetch(cache, "key", async () => {
      throw new Error("provider unavailable -- must never be called");
    });

    expect(value).toBe("cached-value");
  });
});

describe("deterministic bounded eviction", () => {
  it("evicts the oldest-inserted entry once the max size is exceeded", () => {
    const cache = new ModelMetadataCache<string>(MODEL_METADATA_TTL_MS, Date.now, 2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    expect(cache.state("a")).toBe("absent");
    expect(cache.get("b")).toBe("2");
    expect(cache.get("c")).toBe("3");
    expect(cache.size()).toBe(2);
  });

  it("re-setting an existing key never evicts it", () => {
    const cache = new ModelMetadataCache<string>(MODEL_METADATA_TTL_MS, Date.now, 2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("a", "1-updated");
    cache.set("c", "3");

    expect(cache.get("a")).toBe("1-updated");
    expect(cache.state("b")).toBe("absent");
  });
});
