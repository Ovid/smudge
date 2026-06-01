// @ts-check
/**
 * Pure logic for the dependency-cooldown gate. No IO of its own — the caller
 * (scripts/dep-cooldown.mjs) injects the lockfile object, publish dates, the
 * allowlist, and `now`, so every decision is unit-testable offline.
 *
 * See docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md.
 */

/** Marker separating path segments in a package-lock v3 `packages` key. */
const NODE_MODULES = "node_modules/";

/**
 * Derive a package name from a package-lock v3 `packages` key (a path). The
 * name is everything after the FINAL `node_modules/` segment and may include an
 * `@scope/` prefix. A naive last-path-segment split is WRONG for scoped
 * packages (it would yield `send` from `@types/send`), so we slice from the
 * last marker instead. Keys without a `node_modules/` segment are the root
 * project or a workspace package — not a dependency — and return null.
 * @param {string} key
 * @returns {string | null}
 */
export function derivePackageName(key) {
  const idx = key.lastIndexOf(NODE_MODULES);
  if (idx === -1) return null;
  return key.slice(idx + NODE_MODULES.length);
}

/**
 * The canonical `name@version` identity used as the dedup, cache, and allowlist
 * key throughout the gate.
 * @param {string} name
 * @param {string} version
 * @returns {string}
 */
export function versionId(name, version) {
  return `${name}@${version}`;
}

/**
 * Is a lockfile entry's `resolved` URL an npm-registry tarball? Registry
 * tarballs are `https://<registry>/<name>/-/<name>-<version>.tgz` — the `/-/`
 * segment is characteristic and git (`git+…`) / file (`file:…`) sources lack
 * the `http(s)://…/-/` shape. Non-registry sources have no publish date and are
 * skipped by the gate.
 * @param {unknown} resolved
 * @returns {boolean}
 */
export function isRegistryResolved(resolved) {
  return typeof resolved === "string" && /^https?:\/\//.test(resolved) && resolved.includes("/-/");
}
