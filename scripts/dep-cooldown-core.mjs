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
 * @param {{ packages?: Record<string, { name?: string, version?: string, resolved?: unknown, link?: boolean }> }} lockfile
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
    const derived = derivePackageName(key);
    if (derived === null) continue; // workspace/own package — not a dependency
    if (entry.link) continue; // symlink to a workspace package
    // npm aliases (e.g. "foo": "npm:bar@1") put the REAL registry package in
    // entry.name while the key holds the alias. Prefer entry.name when present;
    // the path-derived name is correct only for non-aliased deps.
    const name = typeof entry.name === "string" && entry.name ? entry.name : derived;
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

/**
 * Is an HTTP status (or 0 for a network/timeout error) a transient
 * infrastructure blip worth retrying, as opposed to a definitive answer? The
 * shell retries these; a non-retriable failure is surfaced as an infra error
 * (it cannot be silently treated as a pass — the gate fails closed).
 * @param {number} status
 * @returns {boolean}
 */
export function isRetriableStatus(status) {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A cooldown violation. `ageDays` is the version's age in days for a "young"
 * violation (may be fractional, e.g. 3.25) and `null` for an "absent" one
 * (no usable publish date). Consumers formatting it should round.
 * @typedef {{ id: string, ageDays: number | null, kind: "young" | "absent" }} Violation
 */

/**
 * Decide, for every registry version in the tree, whether it violates the
 * cooldown. A version violates if it is younger than `cooldownDays` and not
 * allowlisted ("young"), or if the registry returned no publish date for it
 * ("absent" — yanked/tampered/unexpected; only reached when the registry WAS
 * reachable, since infra failures are handled in the shell). Allowlist
 * diagnostics are non-failing: a waiver whose version is now old is "stale", a
 * waiver whose id is no longer in the tree is "orphaned" — both are hygiene
 * hints, not violations.
 * @param {{
 *   versions: RegistryVersion[],
 *   publishDates: Map<string, string | null>,
 *   allowlist: Map<string, Waiver>,
 *   now: number,
 *   cooldownDays: number,
 * }} args
 * @returns {{ violations: Violation[], staleWaivers: string[], orphanedWaivers: string[] }}
 */
export function classify({ versions, publishDates, allowlist, now, cooldownDays }) {
  const cooldownMs = cooldownDays * DAY_MS;
  /** @type {Violation[]} */
  const violations = [];
  /** @type {string[]} */
  const staleWaivers = [];
  const usedWaivers = new Set();

  for (const v of versions) {
    // Mark the waiver used regardless of the date outcome (young/old/absent),
    // so an absent-but-waived id is NOT later mis-reported as orphaned.
    const waived = allowlist.has(v.id);
    if (waived) usedWaivers.add(v.id);

    // `published == null` catches both null and undefined; `Date.parse` of an
    // unparseable string yields NaN. All three mean "no usable publish date" —
    // we cannot age-check the version, so it is an "absent" violation unless
    // allowlisted. Folding them into one guard also closes the trap where a
    // garbage date string (NaN age) would otherwise fall through as "young".
    const published = publishDates.get(v.id);
    const ageMs = published == null ? NaN : now - Date.parse(published);
    if (Number.isNaN(ageMs)) {
      if (!waived) violations.push({ id: v.id, ageDays: null, kind: "absent" });
      continue;
    }
    if (ageMs >= cooldownMs) {
      // passes: at least cooldownDays old. A waiver here is no longer needed.
      if (waived) staleWaivers.push(v.id);
      continue;
    }
    if (!waived) violations.push({ id: v.id, ageDays: ageMs / DAY_MS, kind: "young" });
  }

  /** @type {string[]} */
  const orphanedWaivers = [];
  for (const id of allowlist.keys()) {
    if (!usedWaivers.has(id)) orphanedWaivers.push(id);
  }

  return { violations, staleWaivers, orphanedWaivers };
}

/**
 * Render the human-readable report lines and decide whether the run blocks.
 * Only violations block; stale/orphaned waivers and the skipped count are
 * informational. Kept pure (returns strings) so the shell only prints.
 * @param {{
 *   violations: Violation[],
 *   staleWaivers: string[],
 *   orphanedWaivers: string[],
 *   skipped: number,
 *   cooldownDays: number,
 * }} args
 * @returns {{ lines: string[], blocking: boolean }}
 */
export function buildReport({ violations, staleWaivers, orphanedWaivers, skipped, cooldownDays }) {
  /** @type {string[]} */
  const lines = [];

  for (const v of violations) {
    if (v.kind === "absent") {
      lines.push(`✗ ${v.id} — not found in registry publish times (yanked or tampered?)`);
    } else {
      // A "young" violation always carries a numeric ageDays (the "absent"
      // branch above is the only producer of null). JSDoc can't narrow through
      // the `kind` discriminant, so assert it.
      const ageDays = /** @type {number} */ (v.ageDays);
      lines.push(`✗ ${v.id} — published ${ageDays.toFixed(1)} days ago (min ${cooldownDays})`);
    }
  }
  for (const id of staleWaivers) {
    lines.push(
      `note: waiver for ${id} no longer needed (now ≥ ${cooldownDays} days old); safe to remove.`,
    );
  }
  for (const id of orphanedWaivers) {
    lines.push(
      `note: waiver for ${id} references a version no longer in the tree; safe to remove.`,
    );
  }
  if (skipped > 0) {
    const noun = skipped === 1 ? "entry" : "entries";
    lines.push(
      `info: skipped ${skipped} non-registry dependency ${noun} (git/file/link — no publish date to check).`,
    );
  }

  return { lines, blocking: violations.length > 0 };
}
