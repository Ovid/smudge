// @ts-check
/**
 * Pure logic for the platform-keyed better-sqlite3 native binary cache.
 * No IO of its own — all filesystem / process effects are injected by the
 * caller (scripts/ensure-native.mjs), so this module is unit-testable without
 * a real native compile.
 *
 * See docs/superpowers/specs/2026-05-31-native-binary-cache-design.md.
 *
 * Review history preserved from the Makefile recipe this replaces:
 *  - I5: rebuild from source (no prebuild-install) so compilation replaces
 *    network trust. The cache only ever holds locally-compiled binaries, so it
 *    adds no NEW network-trust surface.
 *  - S10: pin the Node major BEFORE the dlopen probe (validateNodeMajor, called
 *    first by the entry point).
 *  - S6: re-probe AFTER a rebuild AND after a cache restore (orchestrate does
 *    both before trusting a binary).
 */

/**
 * @typedef {{ ok: true, expected: string }
 *   | { ok: false, reason: "missing" }
 *   | { ok: false, reason: "unsupported-range" }
 *   | { ok: false, reason: "mismatch", expected: string, actual: string }
 * } NodeMajorResult
 */

/**
 * Validate that the active Node major matches package.json's engines.node.
 * Mirrors the single-major regex from the recipe this replaces (S10): a
 * foreign Node must be rejected BEFORE the dlopen probe so we never rebuild
 * against the wrong ABI.
 * @param {string | undefined} enginesNode  e.g. "22.x"
 * @param {string} actualNodeVersion        e.g. process.versions.node "22.22.2"
 * @returns {NodeMajorResult}
 */
export function validateNodeMajor(enginesNode, actualNodeVersion) {
  if (!enginesNode) return { ok: false, reason: "missing" };
  const m = String(enginesNode).match(/^[\^~]?(\d+)(?:\.(?:\d+|x))?(?:\.(?:\d+|x))?$/);
  const expected = m?.[1];
  if (!expected) return { ok: false, reason: "unsupported-range" };
  const actual = actualNodeVersion.split(".")[0] ?? actualNodeVersion;
  if (actual !== expected) {
    return { ok: false, reason: "mismatch", expected, actual };
  }
  return { ok: true, expected };
}

/**
 * Build the cache key for a given better-sqlite3 build target.
 * @param {{ version: string, platform: string, arch: string, abiVersion: string }} input
 * @returns {string}
 */
export function computeCacheKey({ version, platform, arch, abiVersion }) {
  const key = `better-sqlite3@${version}-${platform}-${arch}-abi${abiVersion}`;
  // S5 (defense-in-depth): the key becomes a path segment under .native-cache/
  // and flows into a recursive rmSync. `version` comes from a same-trust-domain
  // package.json (valid semver can't contain these), but refuse anything that
  // could escape the cache directory before it ever reaches the filesystem.
  if (key.includes("/") || key.includes("\\") || key.includes("..")) {
    throw new Error(`Refusing unsafe cache key (would escape the cache dir): ${key}`);
  }
  return key;
}

/**
 * Run `body` and return its value, then ALWAYS run `cleanup` — but never let a
 * cleanup failure mask the body's outcome. JS `try { … } finally { cleanup() }`
 * has the opposite default: a throw from the `finally` replaces whatever the
 * body returned or threw, so a noisy cleanup error (e.g. `EPERM` unlinking a
 * temp file) would hide the real cause (e.g. `ENOSPC` from the copy). Here a
 * cleanup error is swallowed; the body's return value or error is what escapes.
 * @template T
 * @param {() => T} body
 * @param {() => void} cleanup
 * @returns {T}
 */
export function withBestEffortCleanup(body, cleanup) {
  try {
    return body();
  } finally {
    try {
      cleanup();
    } catch {
      // Best-effort: a cleanup failure must not override the body's outcome.
    }
  }
}

/**
 * Build a collision-resistant temp sibling path for an atomic copy-then-rename.
 * The temp file must live in the SAME directory as `dest` so the rename is a
 * cheap intra-filesystem move. S4: `pid` alone is not unique — PIDs are
 * per-namespace, so a macOS host process and a Linux container process sharing
 * one bind-mounted node_modules can collide on the same pid AND the same `dest`
 * (the single shared `build/Release` slot), letting two `copyFileSync` writers
 * tear one temp file. The caller passes a per-invocation random `token` so the
 * temp path is distinct even when pid and dest collide across that boundary.
 * @param {string} dest
 * @param {number} pid
 * @param {string} token  a random, per-invocation hex string
 * @returns {string}
 */
export function buildTempPath(dest, pid, token) {
  return `${dest}.tmp-${pid}-${token}`;
}

/**
 * @typedef {"exited-nonzero" | "killed" | "spawn-error" | "unknown"} ProbeErrorKind
 */

/**
 * Classify an error thrown by the child-process load probe. S2: only
 * "exited-nonzero" (the child RAN and exited non-zero — i.e. `require`'d
 * better-sqlite3 and threw on dlopen) is the expected clean "binary won't load"
 * signal. "killed" (the child died to a signal, e.g. an OOM SIGKILL),
 * "spawn-error" (the child could not be started at all), and "unknown" are NOT
 * dlopen failures; the caller surfaces them so a spurious restore/rebuild is
 * not triggered silently by an unrelated environment problem.
 * @param {unknown} err
 * @returns {ProbeErrorKind}
 */
export function interpretProbeError(err) {
  if (typeof err !== "object" || err === null) return "unknown";
  const e = /** @type {{ signal?: unknown, status?: unknown, code?: unknown }} */ (err);
  if (e.signal != null) return "killed";
  if (typeof e.status === "number") return "exited-nonzero";
  if (typeof e.code === "string") return "spawn-error";
  return "unknown";
}

/**
 * @typedef {object} OrchestrateDeps
 * @property {string} key                          Cache key for the active target.
 * @property {() => boolean} probe                 Does better_sqlite3 currently dlopen?
 * @property {(key: string) => boolean} cacheHas   Is there a cached binary for this key?
 * @property {(key: string) => void} restoreFromCache  Atomic copy cache -> build/Release.
 * @property {(key: string) => void} saveToCache       Atomic copy build/Release -> cache.
 * @property {(key: string) => void} deleteCacheEntry  Remove a corrupt cache entry.
 * @property {() => boolean} rebuild               Compile from source; true on success.
 * @property {(msg: string) => void} log           Emit a progress line.
 */

/**
 * @typedef {"loaded-warmed" | "loaded-cached-already" | "restored-from-cache"
 *   | "cache-corrupt-rebuilt" | "rebuilt-from-source" | "rebuild-failed"
 *   | "rebuilt-but-unloadable"} OrchestrateOutcome
 */

/**
 * Make better_sqlite3 loadable with the least work, preferring a cache restore
 * (<1s) over a from-source rebuild (~60s). Returns a tag describing the path
 * taken (used by the entry point for messaging and by tests for assertions).
 * @param {OrchestrateDeps} deps
 * @returns {OrchestrateOutcome}
 */
export function orchestrate(deps) {
  const { key, probe, cacheHas, restoreFromCache, saveToCache, deleteCacheEntry, rebuild, log } =
    deps;

  // I1: cache mutation is an opportunistic optimization, never a gate. A write
  // failure (read-only mount, full disk, restrictive perms) must not fail a run
  // whose binary is otherwise fine — warming is "for the other platform's
  // future benefit", so swallow the error and continue.
  const warmCache = () => {
    try {
      saveToCache(key);
    } catch (err) {
      log(
        `→ note: could not write to the native-binary cache (${describeError(err)}); continuing.`,
      );
    }
  };

  // Happy path: binary already loads. Warm the cache if we haven't stored this
  // exact binary yet.
  if (probe()) {
    if (!cacheHas(key)) {
      warmCache();
      return "loaded-warmed";
    }
    return "loaded-cached-already";
  }

  // Binary won't dlopen. Prefer a cache restore over a rebuild.
  let cacheWasCorrupt = false;
  if (cacheHas(key)) {
    log(`→ restoring cached better-sqlite3 binary (${key}); no rebuild needed...`);
    let restored = false;
    try {
      restoreFromCache(key);
      restored = true;
    } catch (err) {
      // I1/S2: a restore that throws (read-only mount, or a concurrent
      // same-platform run that deleted the entry between cacheHas() and the
      // copy) falls through to a rebuild rather than aborting.
      log(`→ cache restore failed (${describeError(err)}); rebuilding from source...`);
    }
    if (restored && probe()) return "restored-from-cache"; // S6: re-probe after restore.
    if (restored) {
      log("→ cached binary failed to load; discarding it and rebuilding from source...");
    }
    try {
      deleteCacheEntry(key);
    } catch {
      // Best-effort: a stale entry we can't remove is harmless — the rebuild
      // below overwrites it, and the next re-probe is the source of truth.
    }
    cacheWasCorrupt = true;
  }

  // Cache miss or corrupt cache: rebuild from source (I5: no remote fetch).
  if (!rebuild()) return "rebuild-failed";
  if (!probe()) return "rebuilt-but-unloadable"; // S6: re-probe after rebuild.
  warmCache();
  return cacheWasCorrupt ? "cache-corrupt-rebuilt" : "rebuilt-from-source";
}

/** @param {unknown} err */
function describeError(err) {
  return err instanceof Error ? err.message : String(err);
}
