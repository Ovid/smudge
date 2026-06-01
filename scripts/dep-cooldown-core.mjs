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
 * The only registry host whose publish times this gate trusts. A lockfile entry
 * resolved to any other host has no comparable publish-time API here and — more
 * importantly — must NOT be age-checked against the same-named npmjs artifact
 * (that would let an off-host version borrow an innocent npmjs package's age).
 */
export const REGISTRY_HOST = "registry.npmjs.org";

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
 * Is a lockfile entry's `resolved` URL an npmjs-registry tarball? Registry
 * tarballs are `https://registry.npmjs.org/<name>/-/<name>-<version>.tgz` — the
 * host must be `REGISTRY_HOST` (parsed, not substring-matched, so a look-alike
 * like `registry.npmjs.org.evil.com` cannot pass) and the path carries the
 * characteristic `/-/` segment. git (`git+…`) / file (`file:…`) sources and any
 * other host lack this shape. Non-npmjs sources have no publish date we can
 * check here and are skipped by the gate (conservative: the gate never holds an
 * unrecognized source against the cooldown, and — critically — never age-checks
 * an off-host artifact against the same-named npmjs package).
 * @param {unknown} resolved
 * @returns {boolean}
 */
export function isRegistryResolved(resolved) {
  if (typeof resolved !== "string") return false;
  let url;
  try {
    url = new URL(resolved);
  } catch {
    return false;
  }
  return (
    (url.protocol === "https:" || url.protocol === "http:") &&
    url.hostname === REGISTRY_HOST &&
    url.pathname.includes("/-/")
  );
}

/**
 * npm package-name grammar restricted to what is safe to splice into a registry
 * metadata URL: an optional single `@scope/` prefix followed by the bare name,
 * lowercase, no path-traversal (`..`), no extra slashes, no leading dot/underscore.
 * The lockfile — and therefore the derived/alias name — is the untrusted input
 * the gate exists to police, so a name is validated BEFORE it is used to build
 * the fetch URL: a crafted name like `@scope/a/../../b` would otherwise URL-
 * normalize to a different package and borrow its (innocent, aged) publish date.
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidRegistryName(name) {
  if (typeof name !== "string") return false;
  return /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name);
}

/**
 * Is `value` a recognizable npm package-lock **v3** object — one this gate can
 * actually scan? v3 carries every dependency under a `packages` map; v1/v2 used
 * `dependencies` and lack the per-entry `resolved`/`version` shape we read. The
 * lockfile is read from disk and must be shape-checked BEFORE use: a degenerate
 * but still-valid-JSON value (`{}`, a v1/v2 lockfile, `{packages: 5}`,
 * `{packages: []}`, a bare primitive, or `null`) collects zero registry versions,
 * which the shell would otherwise report as a clean pass — a FAIL-OPEN, the worst
 * direction for a security gate (and `null` crashes the scan outright). The shell
 * fails closed when this returns false. Note an empty `{packages: {}}` is still a
 * valid v3 shape and passes here; only a missing/wrong-typed `packages` is rejected.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isV3Lockfile(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const packages = /** @type {{ packages?: unknown }} */ (value).packages;
  return packages !== null && typeof packages === "object" && !Array.isArray(packages);
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
 * Coerce the cooldown-window setting (the `DEP_COOLDOWN_DAYS` override, default
 * "7") to a positive, finite number of days. `Number("")` is 0 — which would
 * pass EVERY version and report "OK", a silently disabled gate — and a
 * non-numeric value is NaN (every version flagged young); both, plus zero and
 * negatives, are rejected so a misconfigured window fails closed rather than
 * neutering the gate. An unset value (undefined) takes the 7-day default.
 * @param {string | undefined} raw
 * @returns {number}
 */
export function parseCooldownDays(raw) {
  const n = Number(raw ?? "7");
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(
      `invalid DEP_COOLDOWN_DAYS ${JSON.stringify(raw)} — expected a positive number of days`,
    );
  }
  return n;
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

/**
 * @typedef {{ ok: boolean, status: number, json: () => Promise<any> }} FetchResult
 */

/**
 * Resolve a package's registry `time` object (per-version publish dates) with
 * bounded-retry, keeping the two failure classes the gate must never conflate
 * cleanly separated. IO is injected (`fetchDoc`, `sleep`) so the retry control
 * and the fail-closed exhaustion path — the gate's central safety property —
 * are unit-testable offline.
 *
 * Outcomes:
 *  - success → resolves with the `time` object;
 *  - a RETRIABLE status (5xx/408/425/429), a network/timeout rejection, malformed
 *    JSON, or a 200 whose whole `time` object is absent/non-object (S2) → retried
 *    with backoff up to `maxAttempts`, then THROWS (the shell surfaces this as a
 *    distinct infrastructure error and fails closed — never a silent pass, I1);
 *  - a NON-RETRIABLE status (e.g. 404) → THROWS immediately, no wasted retries (S1).
 *
 * @param {{
 *   name: string,
 *   fetchDoc: (name: string) => Promise<FetchResult>,
 *   sleep: (ms: number) => Promise<void>,
 *   maxAttempts: number,
 *   backoffMs?: (attempt: number) => number,
 * }} args
 * @returns {Promise<Record<string, unknown>>}
 */
export async function fetchPublishTimes({
  name,
  fetchDoc,
  sleep,
  maxAttempts,
  backoffMs = (attempt) => 500 * 2 ** (attempt - 1),
}) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    /** @type {FetchResult | null} */
    let res = null;
    try {
      res = await fetchDoc(name);
    } catch (err) {
      lastErr = err; // network/timeout — retriable
    }
    if (res) {
      if (res.ok) {
        try {
          const doc = await res.json();
          // An array is `typeof === "object"`; exclude it (as isV3Lockfile and
          // sanitizeCache do) so `time: []` is not mistaken for a usable — but
          // empty — per-version map. A non-plain-object `time` is a partial/
          // malformed response, retried below, never a usable result.
          const time =
            doc && typeof doc.time === "object" && doc.time !== null && !Array.isArray(doc.time)
              ? doc.time
              : null;
          if (time) return time;
          // S2: a 200 without a usable `time` object is a transient/partial
          // response, not a per-version yank — retriable infra, not a violation.
          lastErr = new Error(`registry metadata for ${name} has no usable "time" object`);
        } catch (err) {
          lastErr = err; // malformed JSON — treat as a transient/partial response
        }
      } else if (!isRetriableStatus(res.status)) {
        // S1: a definitive, non-retriable status fails fast — this throw is
        // outside any try, so the retry loop ends immediately.
        throw new Error(`registry responded ${res.status} for ${name}`);
      } else {
        lastErr = new Error(`registry responded ${res.status} for ${name}`);
      }
    }
    if (attempt < maxAttempts) await sleep(backoffMs(attempt));
  }
  throw lastErr ?? new Error(`could not fetch registry metadata for ${name}`);
}

/**
 * Read a single version's publish date from a registry `time` object by EXACT
 * key. The `time` object also carries `created`/`modified` sentinel keys that
 * are not per-version dates; an exact-key lookup ignores them by construction
 * (no `Object.entries` walk that could mistake a sentinel for a version). A
 * missing or non-string value yields null ("no usable publish date").
 * @param {Record<string, unknown>} time
 * @param {string} version
 * @returns {string | null}
 */
export function publishDateFromTime(time, version) {
  const iso = time[version];
  return typeof iso === "string" ? iso : null;
}

/**
 * Coerce a parsed publish-time cache file into a safe id→ISO-date map. The cache
 * is read from disk and is fully untrusted in shape: a truncated or hand-edited
 * file can parse as valid JSON that is NOT a plain object (`null`, a number,
 * string, boolean, or array). Using such a value with the `in` operator throws
 * (`'id' in null`) and would crash the gate, contradicting the documented
 * "a corrupt cache must not crash — fall back to empty and re-fetch" contract
 * (I1). A non-string entry value also slips past the date guard — a tampered `0`
 * becomes `Date.parse("0")` → year 2000 → reads ~9600 days old, aging a young
 * package through (S1). Both are closed here: anything that is not a plain object
 * becomes an empty map, and only string-valued entries are carried over — into a
 * null-prototype object so a forged `__proto__` key cannot pollute and `in` has
 * no inherited keys to confuse it.
 * @param {unknown} parsed
 * @returns {Record<string, string>}
 */
export function sanitizeCache(parsed) {
  /** @type {Record<string, string>} */
  const clean = Object.create(null);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return clean;
  }
  for (const [id, value] of Object.entries(parsed)) {
    if (typeof value === "string") clean[id] = value;
  }
  return clean;
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
