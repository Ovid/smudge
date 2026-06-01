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
 * A key that ends in `node_modules/` with no name after it (a malformed key
 * that cannot occur in a real lockfile) also returns null.
 * @param {string} key
 * @returns {string | null}
 */
export function derivePackageName(key) {
  const idx = key.lastIndexOf(NODE_MODULES);
  if (idx === -1) return null;
  const name = key.slice(idx + NODE_MODULES.length);
  return name === "" ? null : name;
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
 * skipped by the gate. Private registries that do not follow the `/-/`
 * tarball-path convention are treated as non-registry and skipped (conservative:
 * the gate never holds an unrecognized source against the cooldown).
 * @param {unknown} resolved
 * @returns {boolean}
 */
export function isRegistryResolved(resolved) {
  return typeof resolved === "string" && /^https?:\/\//.test(resolved) && resolved.includes("/-/");
}

/**
 * @typedef {{ name: string, version: string, id: string }} RegistryVersion
 */

/**
 * Walk a parsed package-lock v3 and collect the distinct registry-resolved
 * `name@version` pairs. Workspace/own packages (no `node_modules/` segment) and
 * symlinked workspace deps (`link: true`) are ignored; non-registry deps
 * (git/file) — and any malformed entry missing a `version` — are counted in
 * `skipped` (they have no publish date to check).
 * @param {{ packages?: Record<string, { version?: string, resolved?: unknown, link?: boolean }> }} lockfile
 * @returns {{ versions: RegistryVersion[], skipped: number }}
 */
export function collectRegistryVersions(lockfile) {
  const packages = lockfile.packages ?? {};
  /** @type {RegistryVersion[]} */
  const versions = [];
  const seen = new Set();
  let skipped = 0;

  for (const [key, entry] of Object.entries(packages)) {
    if (key === "") continue; // the root project
    const name = derivePackageName(key);
    if (name === null) continue; // workspace/own package — not a dependency
    if (entry.link) continue; // symlink to a workspace package
    if (!entry.version || !isRegistryResolved(entry.resolved)) {
      skipped++;
      continue;
    }
    const id = versionId(name, entry.version);
    if (seen.has(id)) continue;
    seen.add(id);
    versions.push({ name, version: entry.version, id });
  }

  return { versions, skipped };
}

/**
 * Group versions by package name so the shell fetches each package's metadata
 * document at most once even when several versions of it are in the tree.
 * @param {RegistryVersion[]} versions
 * @returns {Map<string, RegistryVersion[]>}
 */
export function groupVersionsByName(versions) {
  /** @type {Map<string, RegistryVersion[]>} */
  const byName = new Map();
  for (const v of versions) {
    const group = byName.get(v.name);
    if (group) group.push(v);
    else byName.set(v.name, [v]);
  }
  return byName;
}

/**
 * @typedef {{ reason: string, added?: string }} Waiver
 */

/**
 * Parse and validate the allowlist file contents into an id→waiver map. A
 * waiver bypasses the cooldown for an EXACT `name@version`. `reason` is
 * mandatory and non-blank so nothing can be waved through silently — a missing
 * or blank reason is a hard error.
 * @param {unknown} entries
 * @returns {Map<string, Waiver>}
 */
export function parseAllowlist(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("dependency-cooldown allowlist must be a JSON array");
  }
  /** @type {Map<string, Waiver>} */
  const byId = new Map();
  for (const e of entries) {
    const pkg = e && typeof e.package === "string" ? e.package : "";
    const version = e && typeof e.version === "string" ? e.version : "";
    if (!pkg) throw new Error(`allowlist entry is missing a "package": ${JSON.stringify(e)}`);
    if (!version) {
      throw new Error(`allowlist entry "${pkg}" is missing a "version"`);
    }
    if (typeof e.reason !== "string" || e.reason.trim() === "") {
      throw new Error(`allowlist entry "${pkg}@${version}" is missing a non-empty "reason"`);
    }
    byId.set(versionId(pkg, version), {
      reason: e.reason,
      added: typeof e.added === "string" ? e.added : undefined,
    });
  }
  return byId;
}
