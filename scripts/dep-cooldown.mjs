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
  isRetriableStatus,
} from "./dep-cooldown-core.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const COOLDOWN_DAYS = Number(process.env.DEP_COOLDOWN_DAYS ?? "7");
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
 * Fetch a package's FULL registry metadata document, retrying transient infra
 * failures with exponential backoff. A non-retriable response (e.g. 404) or
 * exhausted retries throws — the caller surfaces it as an infrastructure error
 * (fail closed), distinct from a real policy violation.
 * @param {string} name
 * @returns {Promise<any>}
 */
async function fetchMetadata(name) {
  // Scoped names contain exactly one slash; encode it for the registry path.
  const url = `${REGISTRY}/${name.replace("/", "%2F")}`;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) return await res.json();
      if (!isRetriableStatus(res.status)) {
        throw new Error(`registry responded ${res.status}`);
      }
      lastErr = new Error(`registry responded ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
    if (attempt < MAX_ATTEMPTS) await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastErr ?? new Error("unknown fetch failure");
}

async function main() {
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
    const needFetch = group.some((g) => !(g.id in cache));
    if (!needFetch) {
      for (const g of group) publishDates.set(g.id, cache[g.id] ?? null);
      continue;
    }
    let doc;
    try {
      doc = await fetchMetadata(name);
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
    const times = (doc && doc.time) || {};
    for (const g of group) {
      const iso = typeof times[g.version] === "string" ? times[g.version] : null;
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
    cooldownDays: COOLDOWN_DAYS,
  });
  const { lines, blocking } = buildReport({ ...result, skipped, cooldownDays: COOLDOWN_DAYS });
  for (const line of lines) console.log(line);

  if (blocking) {
    console.error(
      `\nDependency cooldown: ${result.violations.length} version(s) younger than ${COOLDOWN_DAYS} days and not allowlisted.`,
    );
    console.error(
      `Wait until they are ${COOLDOWN_DAYS} days old, or add an entry with a reason to dependency-cooldown-allowlist.json.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      `Dependency cooldown: OK — all ${versions.length} checked version(s) ≥ ${COOLDOWN_DAYS} days old or allowlisted.`,
    );
  }
}

await main();
