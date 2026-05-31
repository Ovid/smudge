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
  const m = String(enginesNode).match(
    /^[\^~]?(\d+)(?:\.(?:\d+|x))?(?:\.(?:\d+|x))?$/,
  );
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
