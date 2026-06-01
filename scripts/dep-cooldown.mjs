// @ts-check
/**
 * Entry point for `make dep-cooldown` and the CI dep-cooldown job. Thin IO
 * shell: reads the lockfile + allowlist + publish-time cache, resolves each
 * registry version's publish date (cache, else a live npm-registry fetch with
 * bounded retry), then delegates the age/allowlist decision to the pure,
 * unit-tested core in scripts/dep-cooldown-core.mjs.
 *
 * Plain ESM (.mjs) so the Makefile runs it directly with `node` — no build step.
 * Excluded from coverage (see vitest.config.ts), like ensure-native.mjs.
 *
 * The full (non-abbreviated) registry metadata document is required: the
 * abbreviated install metadata (Accept: application/vnd.npm.install-v1+json)
 * OMITS the `time` field. We send Accept: application/json to get the full doc.
 *
 * See docs/superpowers/specs/2026-06-01-dependency-cooldown-design.md.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRegistryVersions,
  groupVersionsByName,
  parseAllowlist,
  classify,
  buildReport,
  fetchPublishTimes,
  publishDateFromTime,
  isValidRegistryName,
  parseCooldownDays,
} from "./dep-cooldown-core.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE_PATH = join(repoRoot, ".dep-cooldown-cache.json");
const ALLOWLIST_PATH = join(repoRoot, "dependency-cooldown-allowlist.json");
const LOCKFILE_PATH = join(repoRoot, "package-lock.json");
const REGISTRY = "https://registry.npmjs.org";
const MAX_ATTEMPTS = 4;

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {string} p @returns {any} */
function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/** @param {unknown} err */
function errMsg(err) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve a package's per-version publish-time map from the registry. The
 * retry/backoff control and the two-failure-class distinction (retriable infra
 * vs. fail-fast non-retriable status, S1/S2/I1) live in the pure, unit-tested
 * core; this wrapper only supplies real `fetch` (with safe URL encoding) and
 * `sleep`. Throws on exhausted retries or a non-retriable status — the caller
 * surfaces that as a fail-closed infrastructure error.
 * @param {string} name
 * @returns {Promise<Record<string, unknown>>}
 */
function fetchTimes(name) {
  return fetchPublishTimes({
    name,
    maxAttempts: MAX_ATTEMPTS,
    sleep,
    // Encode EVERY slash (replaceAll, not replace): a scoped name has one, but
    // the name is untrusted lockfile input — encoding all slashes keeps
    // `new URL()` from normalizing a crafted `…/../…` into a different
    // package's path. Names are also pre-validated via isValidRegistryName (C1).
    fetchDoc: (n) =>
      fetch(`${REGISTRY}/${n.replaceAll("/", "%2F")}`, { headers: { accept: "application/json" } }),
  });
}

async function main() {
  let cooldownDays;
  try {
    cooldownDays = parseCooldownDays(process.env.DEP_COOLDOWN_DAYS);
  } catch (err) {
    console.error(`✗ ${errMsg(err)}`);
    process.exitCode = 1;
    return;
  }

  let lockfile;
  try {
    lockfile = readJson(LOCKFILE_PATH);
  } catch (err) {
    console.error(`✗ ${LOCKFILE_PATH}: ${errMsg(err)}`);
    process.exitCode = 1;
    return;
  }
  const { versions, skipped } = collectRegistryVersions(lockfile);

  // Allowlist — a missing file means "no waivers".
  let allowlist;
  try {
    const raw = existsSync(ALLOWLIST_PATH) ? readJson(ALLOWLIST_PATH) : [];
    allowlist = parseAllowlist(raw);
  } catch (err) {
    console.error(`✗ ${ALLOWLIST_PATH}: ${errMsg(err)}`);
    process.exitCode = 1;
    return;
  }

  // Publish-time cache (immutable entries; gitignored locally, actions/cache in CI).
  // A corrupt/partial cache file (e.g. a prior run killed mid-write) must not
  // crash the gate — fall back to an empty cache and re-fetch.
  /** @type {Record<string, string>} */
  let cache = {};
  if (existsSync(CACHE_PATH)) {
    try {
      cache = readJson(CACHE_PATH);
    } catch {
      console.error(
        "  note: .dep-cooldown-cache.json is unreadable — ignoring cache, will re-fetch.",
      );
    }
  }

  /** @type {Map<string, string | null>} */
  const publishDates = new Map();

  for (const [name, group] of groupVersionsByName(versions)) {
    // Fail closed on a name that is not a valid npm package name (C1): never
    // fetch (or trust a cached date) for a crafted name that could borrow an
    // unrelated package's publish date. No usable date → an "absent" violation.
    if (!isValidRegistryName(name)) {
      for (const g of group) publishDates.set(g.id, null);
      continue;
    }
    const needFetch = group.some((g) => !(g.id in cache));
    if (!needFetch) {
      for (const g of group) publishDates.set(g.id, cache[g.id] ?? null);
      continue;
    }
    let times;
    try {
      times = await fetchTimes(name);
    } catch (err) {
      console.error(
        `✗ infrastructure error: could not fetch registry metadata for ${name} (${errMsg(err)}).`,
      );
      console.error(
        "  This is npm being unreachable, not a policy violation — re-run when the registry is available.",
      );
      process.exitCode = 3;
      return;
    }
    for (const g of group) {
      const iso = publishDateFromTime(times, g.version);
      publishDates.set(g.id, iso);
      if (iso) cache[g.id] = iso; // cache positive dates only (immutable)
    }
  }

  // Persist the cache (optimization only — never fail the run on a write error).
  try {
    writeFileSync(CACHE_PATH, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    /* best-effort */
  }

  const result = classify({
    versions,
    publishDates,
    allowlist,
    now: Date.now(),
    cooldownDays,
  });
  const { lines, blocking } = buildReport({ ...result, skipped, cooldownDays });
  for (const line of lines) console.log(line);

  if (blocking) {
    console.error(
      `\nDependency cooldown: ${result.violations.length} version(s) younger than ${cooldownDays} days and not allowlisted.`,
    );
    console.error(
      `Wait until they are ${cooldownDays} days old, or add an entry with a reason to dependency-cooldown-allowlist.json.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Dependency cooldown: OK — all ${versions.length} checked version(s) ≥ ${cooldownDays} days old or allowlisted.`,
    );
  }
}

await main();
