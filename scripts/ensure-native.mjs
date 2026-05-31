// @ts-check
/**
 * Entry point for `make ensure-native`. Validates the active Node major,
 * locates better-sqlite3, computes the platform cache key, then delegates to
 * orchestrate() (scripts/native-cache.mjs) to make the native binding loadable
 * with minimal work: a cache restore (<1s) when possible, a from-source
 * rebuild only on a true miss or a corrupt cache entry.
 *
 * Plain ESM (.mjs) so the Makefile runs it directly with `node` — no build step.
 *
 * Review history preserved from the Makefile recipe this replaces:
 *  - I5: rebuild via `npm rebuild --build-from-source` (no remote .node fetched);
 *    the cache only ever holds binaries we compiled locally, so no NEW
 *    network-trust surface is added.
 *  - S10: validate the Node major BEFORE the dlopen probe (below, first).
 *  - S6: re-probe after a rebuild AND after a restore (orchestrate enforces this).
 */
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCacheKey, validateNodeMajor, orchestrate } from "./native-cache.mjs";

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = require(join(repoRoot, "package.json"));

// --- S10: validate the Node major before touching the binary -------------
const nodeCheck = validateNodeMajor(pkg.engines?.node, process.versions.node);
if (!nodeCheck.ok) {
  if (nodeCheck.reason === "missing") {
    console.error("→ package.json has no engines.node; cannot validate Node major.");
    process.exit(2);
  }
  if (nodeCheck.reason === "unsupported-range") {
    console.error(
      `→ engines.node = ${pkg.engines?.node} is not a single-major form ensure-native supports.`,
    );
    console.error('   Supported: "22", "22.x", "22.5.0", "^22.5", "~22.5".');
    console.error(
      '   Multi-major ranges ("22 || 24") would silently pin to the first major; update scripts/native-cache.mjs to iterate allowed majors if broadening is intentional.',
    );
    process.exit(2);
  }
  console.error(
    `→ Active Node v${process.versions.node} major (${nodeCheck.actual}) does not match engines.node (${pkg.engines?.node}).`,
  );
  console.error(
    `   Run: fnm use ${nodeCheck.expected}  (or nvm use ${nodeCheck.expected})  before \`make test/cover/e2e/dev\`.`,
  );
  process.exit(1);
}

// --- better-sqlite3 must be installed ------------------------------------
let bsqlitePkgPath;
try {
  bsqlitePkgPath = require.resolve("better-sqlite3/package.json");
} catch {
  console.error("→ better-sqlite3 not installed. Run npm install first.");
  process.exit(2);
}
const bsqliteVersion = require(bsqlitePkgPath).version;
const binaryPath = join(dirname(bsqlitePkgPath), "build", "Release", "better_sqlite3.node");

const key = computeCacheKey({
  version: bsqliteVersion,
  platform: process.platform,
  arch: process.arch,
  abiVersion: process.versions.modules,
});

const cacheRoot = join(repoRoot, ".native-cache");
/** @param {string} k */
const cacheBinaryPath = (k) => join(cacheRoot, k, "better_sqlite3.node");

// --- injected IO ---------------------------------------------------------

/** Load better-sqlite3 in an isolated child `node` so a crash can't take us down. */
function probe() {
  try {
    execFileSync(process.execPath, ["-e", "new (require('better-sqlite3'))(':memory:').close()"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy to a temp sibling then rename into place, so an interrupted copy never
 * leaves a torn binary.
 * @param {string} src
 * @param {string} dest
 */
function atomicCopy(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}`;
  copyFileSync(src, tmp);
  renameSync(tmp, dest);
}

/** I5: rebuild from source — no remote .node binary is fetched. */
function rebuild() {
  console.error(
    `→ better-sqlite3 binary won't load and no cached binary matched; rebuilding from source for Node ${process.versions.node} on ${process.platform}/${process.arch}...`,
  );
  console.error("  (one-time cost per platform; no remote .node binary fetched)");
  try {
    execFileSync("npm", ["rebuild", "better-sqlite3", "--build-from-source"], {
      stdio: "inherit",
      env: { ...process.env, NPM_CONFIG_IGNORE_SCRIPTS: "false" },
    });
    return true;
  } catch {
    console.error("");
    console.error("npm rebuild --build-from-source failed. Possible causes:");
    console.error(
      "  - Missing C++ toolchain — install 'build-essential' (Linux) or Xcode CLT (macOS)",
    );
    console.error("  - Missing python3 — required by node-gyp");
    console.error(
      `  - Active Node version (${process.versions.node}) differs from engines.node — verify with 'node --version'`,
    );
    console.error("  - Try 'rm -rf node_modules && npm install' to start clean");
    console.error("");
    console.error("  See the npm/node-gyp stderr above for the actual error.");
    return false;
  }
}

const outcome = orchestrate({
  key,
  probe,
  cacheHas: (k) => existsSync(cacheBinaryPath(k)),
  restoreFromCache: (k) => atomicCopy(cacheBinaryPath(k), binaryPath),
  saveToCache: (k) => atomicCopy(binaryPath, cacheBinaryPath(k)),
  deleteCacheEntry: (k) => rmSync(join(cacheRoot, k), { recursive: true, force: true }),
  rebuild,
  log: (m) => console.error(m),
});

if (outcome === "rebuild-failed") {
  // rebuild() already printed the toolchain-cause guidance. Exit non-zero.
  process.exit(1);
}
if (outcome === "rebuilt-but-unloadable") {
  console.error("");
  console.error("→ npm rebuild succeeded but the resulting binary still won't dlopen.");
  console.error(
    "  Active Node major matches engines.node (verified above), so the cause is likely:",
  );
  console.error(
    "    - Stale node-gyp cache (try: rm -rf ~/.cache/node-gyp && rm -rf node_modules/better-sqlite3 && npm install better-sqlite3)",
  );
  console.error("    - Multiple .node copies left in node_modules from an interrupted install");
  console.error(
    "    - Missing system shared libraries the build linked against (check ldd / otool -L on the .node)",
  );
  console.error("    - Incomplete extraction — partial files in node_modules/better-sqlite3");
  process.exit(1);
}
// loaded-warmed / loaded-cached-already / rebuilt-from-source /
// cache-corrupt-rebuilt / restored-from-cache → success, exit 0 (silent on the
// pure happy path to match the old recipe's quiet behavior).
