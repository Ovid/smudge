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
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectRegistryVersions,
  isV3Lockfile,
  sanitizeCache,
  groupVersionsByName,
  parseAllowlist,
  classify,
  buildReport,
  fetchPublishTimes,
  resolvePublishDate,
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
 * Is the publish-time cache file committed to git? It must NEVER be — it is a
 * local/CI-only artifact (gitignored locally, restored via actions/cache in CI).
 * A committed cache is the C1 fail-open: CI checks out the PR tree, so a PR
 * author who `git add -f`s a `.dep-cooldown-cache.json` of forged old dates could
 * (on a cold cache, before actions/cache restores over it) have those dates
 * trusted by the `needFetch` short-circuit and skip the registry entirely — a
 * young/malicious package passing the gate. The same file would also be trusted
 * by a maintainer who checks out the PR branch and runs `make dep-cooldown`
 * locally (no actions/cache there at all). We refuse to run rather than depend on
 * cache-restore ordering. `git ls-files --error-unmatch` exits 0 only when the
 * path is tracked; a non-zero exit (untracked, or git/not-a-repo) means "not
 * committed" and we proceed normally. A cache file merely PRESENT but untracked
 * (the legitimate restored/local cache) is fine.
 * @returns {boolean}
 */
function cacheFileIsGitTracked() {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", CACHE_PATH], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true; // exit 0 => the path is tracked
  } catch {
    return false; // non-zero exit: untracked, or git unavailable / not a repo
  }
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
    // Deliberately NOT encodeURIComponent(n): the npm registry expects a scoped
    // name as `@scope%2Fname` — the `/` encoded but the `@` LITERAL — whereas
    // encodeURIComponent would also escape `@` to `%40`, which the registry does
    // not resolve, 404-ing every scoped package. Only the `/` needs encoding.
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
  // Fail CLOSED on a lockfile that parses as JSON but is not a recognizable v3
  // `packages` map (a corrupted/truncated commit, a bad merge, an old-npm
  // downgrade, or a tamper): collectRegistryVersions would yield zero versions
  // and the run would report a clean pass — a fail-open that silently disables
  // the gate, the worst direction for a security control (I2).
  if (!isV3Lockfile(lockfile)) {
    console.error(
      `✗ ${LOCKFILE_PATH}: not a recognizable npm v3 lockfile (missing or invalid "packages" map) — refusing to run the cooldown gate against an unreadable lockfile.`,
    );
    process.exitCode = 1;
    return;
  }
  const { versions, skipped, mismatched } = collectRegistryVersions(lockfile);

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

  // C1: refuse to run if the publish-time cache is committed to git. A committed
  // cache from a PR author's tree could feed the gate forged old dates and skip
  // the registry via the needFetch short-circuit (a fail-open) — see
  // cacheFileIsGitTracked. This guard closes that vector for both CI (the cold-
  // cache window before actions/cache restores) and local `make dep-cooldown`,
  // without depending on cache-restore ordering.
  if (cacheFileIsGitTracked()) {
    console.error(
      `✗ ${CACHE_PATH} is committed to git, but it is a local/CI publish-time cache that must never be tracked — a committed cache could feed the gate forged publish dates (fail-open). Remove it from version control (\`git rm --cached .dep-cooldown-cache.json\`); it is already gitignored.`,
    );
    process.exitCode = 1;
    return;
  }

  // Publish-time cache (immutable entries; gitignored locally, actions/cache in CI).
  // A corrupt/partial cache file (e.g. a prior run killed mid-write) must not
  // crash the gate — fall back to an empty cache and re-fetch.
  //
  // TRUST BOUNDARY: cached dates are trusted as-is (no integrity check), so a
  // forged entry could age a young package. The committed-file vector (a PR
  // author committing a forged cache, C1) is closed by the git-tracked guard
  // above; the residual is a forged entry reaching the cache through a TRUSTED
  // channel — CI cache scoping isolates main from untrusted branches, and
  // artifact integrity is enforced separately by `npm ci`'s `integrity` hashes
  // (a forged publish DATE does not bypass them). This is an accepted, documented
  // residual risk; see the CI cache step and the design spec's threat model.
  // sanitizeCache coerces a non-object-but-valid-JSON file (null/number/string/
  // array — which would crash `g.id in cache` below) to an empty map and drops
  // any non-string entry value (a tampered date that would otherwise age a young
  // package through). The try/catch still handles a file that fails to parse.
  /** @type {Record<string, string>} */
  let cache = sanitizeCache(null);
  if (existsSync(CACHE_PATH)) {
    try {
      cache = sanitizeCache(readJson(CACHE_PATH));
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
      // Prefer the fresh date, but keep a known-good cached date if this refetch
      // (forced by another, uncached member of the group) transiently omits this
      // version — otherwise it would become a false "absent" violation (S2).
      const iso = resolvePublishDate(times, g.version, g.id, cache);
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
  const { lines, blocking } = buildReport({ ...result, skipped, mismatched, cooldownDays });
  for (const line of lines) console.log(line);

  if (blocking) {
    if (mismatched.length > 0) {
      console.error(
        `\nDependency cooldown: ${mismatched.length} lockfile entr${mismatched.length === 1 ? "y" : "ies"} whose declared name@version does not match the "resolved" tarball — refusing to age an identity that is not the artifact npm installs.`,
      );
    }
    if (result.violations.length > 0) {
      console.error(
        `\nDependency cooldown: ${result.violations.length} version(s) younger than ${cooldownDays} days and not allowlisted.`,
      );
      console.error(
        `Wait until they are ${cooldownDays} days old, or add an entry with a reason to dependency-cooldown-allowlist.json.`,
      );
    }
    process.exitCode = 1;
  } else {
    console.log(
      `Dependency cooldown: OK — all ${versions.length} checked version(s) ≥ ${cooldownDays} days old or allowlisted.`,
    );
  }
}

try {
  await main();
} catch (err) {
  // An unexpected throw escaping main() (e.g. a defect reached outside the
  // per-step try/catch blocks above) must NOT exit with the violation code 1 —
  // that is indistinguishable from a real cooldown violation and would read as
  // "a package is too young." Surface it as a distinct non-violation failure
  // (exit 3, the same non-1 bucket as an infra error) with a clear message and
  // the stack, so CI shows the gate itself misbehaved rather than implying a
  // young/tampered package. Still fails closed: the merge stays blocked. (S1)
  console.error(`✗ unexpected error in the dependency-cooldown gate: ${errMsg(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  process.exitCode = 3;
}
