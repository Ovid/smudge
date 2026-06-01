import { describe, it, expect } from "vitest";
import {
  computeCacheKey,
  validateNodeMajor,
  orchestrate,
  withBestEffortCleanup,
} from "../native-cache.mjs";

describe("withBestEffortCleanup", () => {
  it("returns the body's value and runs cleanup on success", () => {
    /** @type {string[]} */
    const ran = [];
    const result = withBestEffortCleanup(
      () => "body-value",
      () => ran.push("cleanup"),
    );
    expect(result).toBe("body-value");
    expect(ran).toEqual(["cleanup"]);
  });

  it("propagates the body error and still runs cleanup when the body throws", () => {
    /** @type {string[]} */
    const ran = [];
    expect(() =>
      withBestEffortCleanup(
        () => {
          throw new Error("body failed");
        },
        () => ran.push("cleanup"),
      ),
    ).toThrow("body failed");
    expect(ran).toEqual(["cleanup"]);
  });

  // S1: the load-bearing case — a cleanup failure must never mask the real body
  // error (JS try/finally otherwise replaces the in-flight error with the
  // cleanup error, misdiagnosing the failure).
  it("propagates the BODY error, not the cleanup error, when both throw", () => {
    expect(() =>
      withBestEffortCleanup(
        () => {
          throw new Error("real cause: ENOSPC");
        },
        () => {
          throw new Error("cleanup noise: EPERM");
        },
      ),
    ).toThrow("real cause: ENOSPC");
  });

  it("swallows a cleanup failure on the success path and returns the body value", () => {
    const result = withBestEffortCleanup(
      () => 42,
      () => {
        throw new Error("EPERM unlink tmp");
      },
    );
    expect(result).toBe(42);
  });
});

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

  it.each(["../../etc", "11.10.0/..", "a/b", "a\\b"])(
    "refuses a version that would escape the cache directory (%s)",
    (version) => {
      expect(() =>
        computeCacheKey({ version, platform: "linux", arch: "arm64", abiVersion: "127" }),
      ).toThrow(/unsafe cache key/i);
    },
  );
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

  // I1: cache warming is opportunistic — a failed cache write must never fail a
  // run whose binary already loads.
  it("tolerates a cache-warm write failure on the happy path", () => {
    const { deps, calls } = makeDeps({
      probe: () => true,
      cacheHas: () => false,
      saveToCache: () => {
        throw new Error("EROFS: read-only file system");
      },
    });
    expect(orchestrate(deps)).toBe("loaded-warmed");
    expect(calls.rebuild).toBe(0);
    expect(calls.log.some((m) => /could not (?:warm|write).*cache/i.test(m))).toBe(true);
  });

  // I1/S2: a restore that throws (read-only mount, or a concurrent same-platform
  // run deleting the entry between cacheHas() and the copy) must fall through to
  // a rebuild rather than abort.
  it("falls through to rebuild when a cache restore throws", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, true]),
      cacheHas: () => true,
      restoreFromCache: () => {
        throw new Error("ENOENT: cache entry vanished");
      },
    });
    expect(orchestrate(deps)).toBe("cache-corrupt-rebuilt");
    expect(calls.rebuild).toBe(1);
    expect(calls.saveToCache).toEqual([deps.key]);
  });

  // I1: a failed warm-save after a successful rebuild must not mask the success.
  it("tolerates a cache-warm write failure after a successful rebuild", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, true]),
      cacheHas: () => false,
      saveToCache: () => {
        throw new Error("ENOSPC: no space left on device");
      },
    });
    expect(orchestrate(deps)).toBe("rebuilt-from-source");
    expect(calls.rebuild).toBe(1);
  });

  // I1: a deleteCacheEntry failure while discarding a corrupt entry is best-effort.
  it("tolerates a deleteCacheEntry failure when discarding a corrupt entry", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, false, true]),
      cacheHas: () => true,
      deleteCacheEntry: () => {
        throw new Error("EACCES: permission denied");
      },
    });
    expect(orchestrate(deps)).toBe("cache-corrupt-rebuilt");
    expect(calls.rebuild).toBe(1);
  });
});
