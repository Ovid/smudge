import { describe, it, expect } from "vitest";
import { computeCacheKey, validateNodeMajor, orchestrate } from "../native-cache.mjs";

describe("validateNodeMajor", () => {
  it("accepts a matching single-major form (22.x against 22.22.2)", () => {
    expect(validateNodeMajor("22.x", "22.22.2")).toEqual({
      ok: true,
      expected: "22",
    });
  });

  it.each(["22", "22.x", "22.5.0", "^22.5", "~22.5"])(
    "accepts the supported form %s when the active major matches",
    (form) => {
      expect(validateNodeMajor(form, "22.0.0")).toEqual({
        ok: true,
        expected: "22",
      });
    },
  );

  it("reports missing engines.node", () => {
    expect(validateNodeMajor(undefined, "22.22.2")).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports a multi-major range as unsupported", () => {
    expect(validateNodeMajor("22 || 24", "22.22.2")).toEqual({
      ok: false,
      reason: "unsupported-range",
    });
  });

  it("reports garbage as unsupported", () => {
    expect(validateNodeMajor("not-a-version", "22.22.2")).toEqual({
      ok: false,
      reason: "unsupported-range",
    });
  });

  it("reports a major mismatch with both expected and actual", () => {
    expect(validateNodeMajor("22.x", "20.11.0")).toEqual({
      ok: false,
      reason: "mismatch",
      expected: "22",
      actual: "20",
    });
  });
});

describe("computeCacheKey", () => {
  it("joins version, platform, arch and node-ABI into a stable key", () => {
    expect(
      computeCacheKey({
        version: "11.10.0",
        platform: "linux",
        arch: "arm64",
        abiVersion: "127",
      }),
    ).toBe("better-sqlite3@11.10.0-linux-arm64-abi127");
  });

  it("reflects a different platform/arch/abi in the key", () => {
    expect(
      computeCacheKey({
        version: "11.10.0",
        platform: "darwin",
        arch: "x64",
        abiVersion: "131",
      }),
    ).toBe("better-sqlite3@11.10.0-darwin-x64-abi131");
  });
});

/**
 * A probe that returns the next scripted boolean each call, clamping to the
 * last value once the script is exhausted (orchestrate may probe up to 3x:
 * initial, after-restore, after-rebuild).
 */
function probeSequence(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v ?? false;
  };
}

function makeDeps(overrides = {}) {
  const calls = {
    restoreFromCache: [],
    saveToCache: [],
    deleteCacheEntry: [],
    rebuild: 0,
    log: [],
  };
  const deps = {
    key: "better-sqlite3@11.10.0-linux-arm64-abi127",
    probe: () => true,
    cacheHas: () => false,
    restoreFromCache: (k) => calls.restoreFromCache.push(k),
    saveToCache: (k) => calls.saveToCache.push(k),
    deleteCacheEntry: (k) => calls.deleteCacheEntry.push(k),
    rebuild: () => {
      calls.rebuild += 1;
      return true;
    },
    log: (m) => calls.log.push(m),
    ...overrides,
  };
  return { deps, calls };
}

describe("orchestrate", () => {
  it("warms an empty cache when the binary already loads", () => {
    const { deps, calls } = makeDeps({ probe: () => true, cacheHas: () => false });
    expect(orchestrate(deps)).toBe("loaded-warmed");
    expect(calls.saveToCache).toEqual([deps.key]);
    expect(calls.rebuild).toBe(0);
    expect(calls.restoreFromCache).toEqual([]);
  });

  it("does nothing extra when the binary loads and is already cached", () => {
    const { deps, calls } = makeDeps({ probe: () => true, cacheHas: () => true });
    expect(orchestrate(deps)).toBe("loaded-cached-already");
    expect(calls.saveToCache).toEqual([]);
    expect(calls.rebuild).toBe(0);
  });

  it("restores from cache on a dlopen failure without rebuilding", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, true]),
      cacheHas: () => true,
    });
    expect(orchestrate(deps)).toBe("restored-from-cache");
    expect(calls.restoreFromCache).toEqual([deps.key]);
    expect(calls.rebuild).toBe(0);
    expect(calls.saveToCache).toEqual([]);
  });

  it("discards a corrupt cache entry and rebuilds from source", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, false, true]),
      cacheHas: () => true,
    });
    expect(orchestrate(deps)).toBe("cache-corrupt-rebuilt");
    expect(calls.restoreFromCache).toEqual([deps.key]);
    expect(calls.deleteCacheEntry).toEqual([deps.key]);
    expect(calls.rebuild).toBe(1);
    expect(calls.saveToCache).toEqual([deps.key]);
  });

  it("rebuilds from source on a cache miss and saves the result", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, true]),
      cacheHas: () => false,
    });
    expect(orchestrate(deps)).toBe("rebuilt-from-source");
    expect(calls.restoreFromCache).toEqual([]);
    expect(calls.rebuild).toBe(1);
    expect(calls.saveToCache).toEqual([deps.key]);
  });

  it("reports rebuild-failed when the compile fails (no save)", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false]),
      cacheHas: () => false,
      rebuild: () => {
        calls.rebuild += 1;
        return false;
      },
    });
    expect(orchestrate(deps)).toBe("rebuild-failed");
    expect(calls.saveToCache).toEqual([]);
  });

  it("reports rebuilt-but-unloadable when a fresh compile still won't load (S6)", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, false]),
      cacheHas: () => false,
    });
    expect(orchestrate(deps)).toBe("rebuilt-but-unloadable");
    expect(calls.rebuild).toBe(1);
    expect(calls.saveToCache).toEqual([]);
  });
});
