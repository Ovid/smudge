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
  return `better-sqlite3@${version}-${platform}-${arch}-abi${abiVersion}`;
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

  // Happy path: binary already loads. Warm the cache (for the other platform's
  // future benefit) if we haven't stored this exact binary yet.
  if (probe()) {
    if (!cacheHas(key)) {
      saveToCache(key);
      return "loaded-warmed";
    }
    return "loaded-cached-already";
  }

  // Binary won't dlopen. Prefer a cache restore over a rebuild.
  let cacheWasCorrupt = false;
  if (cacheHas(key)) {
    log(`→ restoring cached better-sqlite3 binary (${key}); no rebuild needed...`);
    restoreFromCache(key);
    if (probe()) return "restored-from-cache"; // S6: re-probe after restore.
    log("→ cached binary failed to load; discarding it and rebuilding from source...");
    deleteCacheEntry(key);
    cacheWasCorrupt = true;
  }

  // Cache miss or corrupt cache: rebuild from source (I5: no remote fetch).
  if (!rebuild()) return "rebuild-failed";
  if (!probe()) return "rebuilt-but-unloadable"; // S6: re-probe after rebuild.
  saveToCache(key);
  return cacheWasCorrupt ? "cache-corrupt-rebuilt" : "rebuilt-from-source";
}
