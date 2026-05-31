# Platform-keyed better-sqlite3 native binary cache — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `make ensure-native` restore a cached, locally-compiled `better_sqlite3.node` (<1s) on a `dlopen` failure instead of recompiling from source (~60s) on every host↔container crossing.

**Architecture:** Extract the inline `node -e` blob in the Makefile `ensure-native` target into two ESM modules under `scripts/`: a pure, unit-tested decision core (`native-cache.mjs`) and a thin IO shell (`ensure-native.mjs`) that wires real filesystem/process effects. The shell validates the Node major, locates better-sqlite3, computes a `{version, platform, arch, node-ABI}` cache key, then calls the core, which prefers a cache restore over a from-source rebuild. Compiled binaries are cached in a gitignored `.native-cache/<key>/` keyed so a host run and a container run never collide.

**Tech Stack:** Node 22 (plain `.mjs`, no build step), Vitest (4th project for `scripts/`), TypeScript `checkJs` for tooling type-checking, ESLint flat config, GNU Make.

**Spec:** `docs/superpowers/specs/2026-05-31-native-binary-cache-design.md`

---

## File Structure

**Create:**
- `scripts/native-cache.mjs` — pure logic: `computeCacheKey`, `validateNodeMajor`, `orchestrate`. No IO; all effects injected. JSDoc-typed (`// @ts-check`). The only file under the coverage gate.
- `scripts/ensure-native.mjs` — IO entry point run by the Makefile. Real probe (child `node`), atomic file copies, `npm rebuild`, user-facing messages, exit codes. Excluded from coverage (thin IO shell).
- `scripts/__tests__/native-cache.test.mjs` — Vitest unit tests for the pure core.
- `scripts/vitest.config.ts` — registers the `scripts/` project's test glob.

**Modify:**
- `.gitignore` — add `.native-cache/`.
- `vitest.config.ts` — add `"scripts"` to `projects`; add `scripts/ensure-native.mjs` to `coverage.exclude`.
- `Makefile` — replace the inline `ensure-native` recipe (lines ~10–113) with a one-liner that runs the script, plus a short pointer comment.
- `tsconfig.tooling.json` — `allowJs` + `checkJs`; add `scripts/**/*.mjs` and `scripts/**/*.ts` to `include`.
- `eslint.config.js` — add a `files: ["scripts/**/*.mjs"]` block with Node globals.
- `package.json` — add `scripts/` to the `lint`/`lint:check` globs and the `format`/`format:check` globs.

---

### Task 1: `scripts/` test project + `computeCacheKey` (TDD)

**Files:**
- Modify: `.gitignore`
- Create: `scripts/vitest.config.ts`
- Modify: `vitest.config.ts`
- Create: `scripts/__tests__/native-cache.test.mjs`
- Create: `scripts/native-cache.mjs`

- [ ] **Step 1: Ignore the cache dir**

Add to the end of `.gitignore` (the file currently ends with the `/.devcontainer/` block):

```gitignore

# Locally-compiled better-sqlite3 native binaries, keyed by
# {version, platform, arch, node-ABI}. Dev-only; see
# docs/superpowers/specs/2026-05-31-native-binary-cache-design.md
.native-cache/
```

- [ ] **Step 2: Register a Vitest project for `scripts/`**

Create `scripts/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["__tests__/**/*.test.mjs"],
  },
});
```

- [ ] **Step 3: Add the project to the root config**

In `vitest.config.ts`, change the `projects` line (currently the last line inside `test`):

```ts
    projects: ["packages/shared", "packages/server", "packages/client", "scripts"],
```

- [ ] **Step 4: Write the failing test**

Create `scripts/__tests__/native-cache.test.mjs`:

```js
import { describe, it, expect } from "vitest";
import { computeCacheKey } from "../native-cache.mjs";

describe("computeCacheKey", () => {
  it("joins version, platform, arch and node-ABI into a stable key", () => {
    expect(
      computeCacheKey({
        version: "11.10.0",
        platform: "linux",
        arch: "arm64",
        abiVersion: "127",
      }),
    ).toBe("better-sqlite3@11.10.0-linux-arm64-abi127");
  });

  it("reflects a different platform/arch/abi in the key", () => {
    expect(
      computeCacheKey({
        version: "11.10.0",
        platform: "darwin",
        arch: "x64",
        abiVersion: "131",
      }),
    ).toBe("better-sqlite3@11.10.0-darwin-x64-abi131");
  });
});
```

- [ ] **Step 5: Run the test, verify it fails**

Run: `npx vitest run --project scripts`
Expected: FAIL — `Failed to resolve import "../native-cache.mjs"` (file does not exist yet).

- [ ] **Step 6: Implement `computeCacheKey`**

Create `scripts/native-cache.mjs`:

```js
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
 * Build the cache key for a given better-sqlite3 build target.
 * @param {{ version: string, platform: string, arch: string, abiVersion: string }} input
 * @returns {string}
 */
export function computeCacheKey({ version, platform, arch, abiVersion }) {
  return `better-sqlite3@${version}-${platform}-${arch}-abi${abiVersion}`;
}
```

- [ ] **Step 7: Run the test, verify it passes**

Run: `npx vitest run --project scripts`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add .gitignore scripts/vitest.config.ts vitest.config.ts scripts/__tests__/native-cache.test.mjs scripts/native-cache.mjs
git commit -m "feat(tooling): add scripts/ test project and computeCacheKey for native cache"
```

---

### Task 2: `validateNodeMajor` (TDD)

**Files:**
- Modify: `scripts/__tests__/native-cache.test.mjs`
- Modify: `scripts/native-cache.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/native-cache.test.mjs` (add the import to the existing top import line so it reads `import { computeCacheKey, validateNodeMajor } from "../native-cache.mjs";`):

```js
describe("validateNodeMajor", () => {
  it("accepts a matching single-major form (22.x against 22.22.2)", () => {
    expect(validateNodeMajor("22.x", "22.22.2")).toEqual({
      ok: true,
      expected: "22",
    });
  });

  it.each(["22", "22.x", "22.5.0", "^22.5", "~22.5"])(
    "accepts the supported form %s when the active major matches",
    (form) => {
      expect(validateNodeMajor(form, "22.0.0")).toEqual({
        ok: true,
        expected: "22",
      });
    },
  );

  it("reports missing engines.node", () => {
    expect(validateNodeMajor(undefined, "22.22.2")).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("reports a multi-major range as unsupported", () => {
    expect(validateNodeMajor("22 || 24", "22.22.2")).toEqual({
      ok: false,
      reason: "unsupported-range",
    });
  });

  it("reports garbage as unsupported", () => {
    expect(validateNodeMajor("not-a-version", "22.22.2")).toEqual({
      ok: false,
      reason: "unsupported-range",
    });
  });

  it("reports a major mismatch with both expected and actual", () => {
    expect(validateNodeMajor("22.x", "20.11.0")).toEqual({
      ok: false,
      reason: "mismatch",
      expected: "22",
      actual: "20",
    });
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run --project scripts`
Expected: FAIL — `validateNodeMajor is not a function` (not yet exported).

- [ ] **Step 3: Implement `validateNodeMajor`**

Add to `scripts/native-cache.mjs` (above or below `computeCacheKey`):

```js
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
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run --project scripts`
Expected: PASS (all `validateNodeMajor` cases green; `computeCacheKey` still green).

- [ ] **Step 5: Commit**

```bash
git add scripts/__tests__/native-cache.test.mjs scripts/native-cache.mjs
git commit -m "feat(tooling): add validateNodeMajor with single-major range parsing"
```

---

### Task 3: `orchestrate` decision core (TDD)

**Files:**
- Modify: `scripts/__tests__/native-cache.test.mjs`
- Modify: `scripts/native-cache.mjs`

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/native-cache.test.mjs` (extend the top import to `import { computeCacheKey, validateNodeMajor, orchestrate } from "../native-cache.mjs";`):

```js
/**
 * A probe that returns the next scripted boolean each call, clamping to the
 * last value once the script is exhausted (orchestrate may probe up to 3x:
 * initial, after-restore, after-rebuild).
 */
function probeSequence(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i += 1;
    return v ?? false;
  };
}

function makeDeps(overrides = {}) {
  const calls = {
    restoreFromCache: [],
    saveToCache: [],
    deleteCacheEntry: [],
    rebuild: 0,
    log: [],
  };
  const deps = {
    key: "better-sqlite3@11.10.0-linux-arm64-abi127",
    probe: () => true,
    cacheHas: () => false,
    restoreFromCache: (k) => calls.restoreFromCache.push(k),
    saveToCache: (k) => calls.saveToCache.push(k),
    deleteCacheEntry: (k) => calls.deleteCacheEntry.push(k),
    rebuild: () => {
      calls.rebuild += 1;
      return true;
    },
    log: (m) => calls.log.push(m),
    ...overrides,
  };
  return { deps, calls };
}

describe("orchestrate", () => {
  it("warms an empty cache when the binary already loads", () => {
    const { deps, calls } = makeDeps({ probe: () => true, cacheHas: () => false });
    expect(orchestrate(deps)).toBe("loaded-warmed");
    expect(calls.saveToCache).toEqual([deps.key]);
    expect(calls.rebuild).toBe(0);
    expect(calls.restoreFromCache).toEqual([]);
  });

  it("does nothing extra when the binary loads and is already cached", () => {
    const { deps, calls } = makeDeps({ probe: () => true, cacheHas: () => true });
    expect(orchestrate(deps)).toBe("loaded-cached-already");
    expect(calls.saveToCache).toEqual([]);
    expect(calls.rebuild).toBe(0);
  });

  it("restores from cache on a dlopen failure without rebuilding", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, true]),
      cacheHas: () => true,
    });
    expect(orchestrate(deps)).toBe("restored-from-cache");
    expect(calls.restoreFromCache).toEqual([deps.key]);
    expect(calls.rebuild).toBe(0);
    expect(calls.saveToCache).toEqual([]);
  });

  it("discards a corrupt cache entry and rebuilds from source", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, false, true]),
      cacheHas: () => true,
    });
    expect(orchestrate(deps)).toBe("cache-corrupt-rebuilt");
    expect(calls.restoreFromCache).toEqual([deps.key]);
    expect(calls.deleteCacheEntry).toEqual([deps.key]);
    expect(calls.rebuild).toBe(1);
    expect(calls.saveToCache).toEqual([deps.key]);
  });

  it("rebuilds from source on a cache miss and saves the result", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, true]),
      cacheHas: () => false,
    });
    expect(orchestrate(deps)).toBe("rebuilt-from-source");
    expect(calls.restoreFromCache).toEqual([]);
    expect(calls.rebuild).toBe(1);
    expect(calls.saveToCache).toEqual([deps.key]);
  });

  it("reports rebuild-failed when the compile fails (no save)", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false]),
      cacheHas: () => false,
      rebuild: () => {
        calls.rebuild += 1;
        return false;
      },
    });
    expect(orchestrate(deps)).toBe("rebuild-failed");
    expect(calls.saveToCache).toEqual([]);
  });

  it("reports rebuilt-but-unloadable when a fresh compile still won't load (S6)", () => {
    const { deps, calls } = makeDeps({
      probe: probeSequence([false, false]),
      cacheHas: () => false,
    });
    expect(orchestrate(deps)).toBe("rebuilt-but-unloadable");
    expect(calls.rebuild).toBe(1);
    expect(calls.saveToCache).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run --project scripts`
Expected: FAIL — `orchestrate is not a function`.

- [ ] **Step 3: Implement `orchestrate`**

Add to `scripts/native-cache.mjs`:

```js
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
  const {
    key,
    probe,
    cacheHas,
    restoreFromCache,
    saveToCache,
    deleteCacheEntry,
    rebuild,
    log,
  } = deps;

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
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run --project scripts`
Expected: PASS (all `orchestrate` cases plus the earlier suites).

- [ ] **Step 5: Confirm full coverage of the pure module**

Run: `npx vitest run --project scripts --coverage`
Expected: PASS; `scripts/native-cache.mjs` reports 100% (or at minimum ≥ the 95/85/90/95 thresholds). `scripts/ensure-native.mjs` does not exist yet, so it cannot affect this run.

- [ ] **Step 6: Commit**

```bash
git add scripts/__tests__/native-cache.test.mjs scripts/native-cache.mjs
git commit -m "feat(tooling): add orchestrate decision core for native cache restore/rebuild"
```

---

### Task 4: IO shell `scripts/ensure-native.mjs` + coverage exclusion

**Files:**
- Create: `scripts/ensure-native.mjs`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Exclude the IO shell from coverage**

In `vitest.config.ts`, add one entry to the `coverage.exclude` array (place it after `"**/types.ts"`):

```ts
        "**/*.types.ts",
        // Thin IO shell for `make ensure-native`: npm-rebuild spawn, fs copies,
        // child-process probe. The testable logic lives in scripts/native-cache.mjs
        // (kept under coverage). See the spec, "Coverage scope (Finding 1)".
        "scripts/ensure-native.mjs",
```

- [ ] **Step 2: Write the IO shell**

Create `scripts/ensure-native.mjs`:

```js
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
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  rmSync,
} from "node:fs";
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
    console.error(`→ engines.node = ${pkg.engines?.node} is not a single-major form ensure-native supports.`);
    console.error('   Supported: "22", "22.x", "22.5.0", "^22.5", "~22.5".');
    console.error('   Multi-major ranges ("22 || 24") would silently pin to the first major; update scripts/native-cache.mjs to iterate allowed majors if broadening is intentional.');
    process.exit(2);
  }
  console.error(`→ Active Node v${process.versions.node} major (${nodeCheck.actual}) does not match engines.node (${pkg.engines?.node}).`);
  console.error(`   Run: fnm use ${nodeCheck.expected}  (or nvm use ${nodeCheck.expected})  before \`make test/cover/e2e/dev\`.`);
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
    execFileSync(
      process.execPath,
      ["-e", "new (require('better-sqlite3'))(':memory:').close()"],
      { stdio: "ignore" },
    );
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
  console.error(`→ better-sqlite3 binary won't load and no cached binary matched; rebuilding from source for Node ${process.versions.node} on ${process.platform}/${process.arch}...`);
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
    console.error("  - Missing C++ toolchain — install 'build-essential' (Linux) or Xcode CLT (macOS)");
    console.error("  - Missing python3 — required by node-gyp");
    console.error(`  - Active Node version (${process.versions.node}) differs from engines.node — verify with 'node --version'`);
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
  console.error("  Active Node major matches engines.node (verified above), so the cause is likely:");
  console.error("    - Stale node-gyp cache (try: rm -rf ~/.cache/node-gyp && rm -rf node_modules/better-sqlite3 && npm install better-sqlite3)");
  console.error("    - Multiple .node copies left in node_modules from an interrupted install");
  console.error("    - Missing system shared libraries the build linked against (check ldd / otool -L on the .node)");
  console.error("    - Incomplete extraction — partial files in node_modules/better-sqlite3");
  process.exit(1);
}
// loaded-warmed / loaded-cached-already / restored-from-cache /
// cache-corrupt-rebuilt / rebuilt-from-source → success, exit 0 (silent on the
// pure happy path to match the old recipe's quiet behavior).
```

- [ ] **Step 3: Verify the happy path warms the cache**

Run (the workspace binary already loads under this platform):

```bash
rm -rf .native-cache
node scripts/ensure-native.mjs
ls .native-cache/*/better_sqlite3.node
```

Expected: the script prints nothing (happy path), exits 0, and the `ls` shows one cached binary under a key like `better-sqlite3@11.10.0-linux-arm64-abi127/better_sqlite3.node`.

- [ ] **Step 4: Verify a corrupt build binary is restored from cache (no rebuild)**

```bash
# Cache is now warm from Step 3. Corrupt the in-place binary, then re-run.
BIN=$(node -e "console.log(require.resolve('better-sqlite3/package.json').replace(/package\.json$/, 'build/Release/better_sqlite3.node'))")
printf 'corrupt' > "$BIN"
node scripts/ensure-native.mjs
node -e "new (require('better-sqlite3'))(':memory:').close()" && echo "RESTORED-OK"
```

Expected: the script prints `→ restoring cached better-sqlite3 binary (...); no rebuild needed...`, exits 0, does NOT run `npm rebuild`, and `RESTORED-OK` prints (the binary loads again).

- [ ] **Step 5: Commit**

```bash
git add scripts/ensure-native.mjs vitest.config.ts
git commit -m "feat(tooling): add ensure-native IO shell and exclude it from coverage"
```

---

### Task 5: Wire the Makefile to the script

**Files:**
- Modify: `Makefile` (the `ensure-native` comment block + recipe, currently lines ~10–113)

- [ ] **Step 1: Read the current target**

Run: `sed -n '9,114p' Makefile`
Confirm the comment block begins at the `# better-sqlite3 ships a precompiled .node binary` line and the recipe (the three `@node -e ...` blocks) ends at the line that is a lone `}` before the blank line preceding `test:`.

- [ ] **Step 2: Replace the comment block and recipe**

Replace everything from the comment line `# better-sqlite3 ships a precompiled .node binary keyed on` through the end of the recipe (the lone `}` on the line before the blank line that precedes `test:`) with:

```makefile
# better-sqlite3 ships a precompiled .node binary keyed on
# {platform, arch, node-abi}. A dev machine that runs both natively (macOS)
# and inside the Linux devcontainer against ONE bind-mounted node_modules has
# a single slot for that binary, so each host<->container crossing hits a
# dlopen failure on the wrong-platform .node. The logic that recovers from
# this — validate Node major (S10), probe, restore a locally-compiled binary
# from the platform-keyed .native-cache/ when possible, else rebuild from
# source (I5: no remote fetch) and re-probe (S6) — now lives in
# scripts/ensure-native.mjs (+ the unit-tested scripts/native-cache.mjs) so it
# is testable. See docs/superpowers/specs/2026-05-31-native-binary-cache-design.md.
ensure-native: ## Ensure better-sqlite3 native binding matches current platform (restores from .native-cache or rebuilds from source; no remote binary fetched)
	@node scripts/ensure-native.mjs
```

(The `.PHONY` line and the `all:` target above the comment block are unchanged.)

- [ ] **Step 3: Verify the target still works end-to-end**

```bash
rm -rf .native-cache
make ensure-native
ls .native-cache/*/better_sqlite3.node && echo "MAKE-ENSURE-NATIVE-OK"
```

Expected: `make ensure-native` exits 0 and `MAKE-ENSURE-NATIVE-OK` prints.

- [ ] **Step 4: Verify the test suite still runs through the target**

Run: `make test`
Expected: `ensure-native` runs first (silent happy path), then Vitest runs all projects — `packages/shared`, `packages/server`, `packages/client`, and `scripts` — all green.

- [ ] **Step 5: Commit**

```bash
git add Makefile
git commit -m "refactor(tooling): run ensure-native via scripts/ensure-native.mjs"
```

---

### Task 6: Lint, type-check, and format coverage for `scripts/`

**Files:**
- Modify: `eslint.config.js`
- Modify: `package.json`
- Modify: `tsconfig.tooling.json`

- [ ] **Step 1: Lint `.mjs` with Node globals**

In `eslint.config.js`, add the `globals` import at the top (after the existing imports):

```js
import globals from "globals";
```

Then add a new config block immediately before `prettierConfig,` (the last entry in the `tseslint.config(...)` array):

```js
  {
    // Tooling scripts are plain Node ESM (.mjs). They need Node globals
    // (process, console) that the TS files get for free, and they legitimately
    // use createRequire's require() for JSON / module resolution.
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
```

- [ ] **Step 2: Add `scripts/` to the lint + format globs**

In `package.json`, update these four script entries to include `scripts/`:

```json
    "lint": "eslint --fix --max-warnings 0 packages/ e2e/ scripts/ playwright.config.ts vitest.config.ts",
    "lint:check": "eslint --max-warnings 0 packages/ e2e/ scripts/ playwright.config.ts vitest.config.ts",
    "format": "prettier --write \"packages/**/*.{ts,tsx,json,css}\" \"e2e/**/*.ts\" \"scripts/**/*.{mjs,ts}\" playwright.config.ts vitest.config.ts \"tsconfig*.json\"",
    "format:check": "prettier --check \"packages/**/*.{ts,tsx,json,css}\" \"e2e/**/*.ts\" \"scripts/**/*.{mjs,ts}\" playwright.config.ts vitest.config.ts \"tsconfig*.json\"",
```

- [ ] **Step 3: Type-check `.mjs` via the tooling config**

Replace `tsconfig.tooling.json` with:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "allowJs": true,
    "checkJs": true
  },
  "include": [
    "playwright.config.ts",
    "e2e/**/*.ts",
    "vitest.config.ts",
    "scripts/*.mjs",
    "scripts/vitest.config.ts"
  ]
}
```

> **Why `scripts/*.mjs` and not `scripts/**/*.mjs`:** this type-checks the two
> real modules (`native-cache.mjs`, `ensure-native.mjs`) but deliberately
> excludes `scripts/__tests__/`. The test file's injected fakes (e.g.
> `restoreFromCache: (k) => ...`) are untyped object-literal callbacks, which
> `checkJs` + `noImplicitAny` would reject. The tests are validated by running
> them, not by type-checking; the real modules carry the JSDoc types.

- [ ] **Step 4: Format the new files**

Run: `npm run format`
Expected: Prettier rewrites `scripts/*.mjs`, `scripts/vitest.config.ts`, and `scripts/__tests__/*.test.mjs` to house style (no functional change).

- [ ] **Step 5: Run lint, verify clean**

Run: `make lint-check`
Expected: PASS with zero warnings. If ESLint flags any additional TypeScript-only rule on the `.mjs` files (beyond `no-require-imports`, already disabled), turn that specific rule off inside the `files: ["scripts/**/*.mjs"]` block from Step 1 — do not broaden the disable to other paths.

- [ ] **Step 6: Run type-check, verify clean**

Run: `npm run typecheck`
Expected: PASS. If `checkJs` reports a type error in a `.mjs` file, fix it at the source (add/correct a JSDoc annotation) — do not silence it with `// @ts-ignore`.

- [ ] **Step 7: Commit**

```bash
git add eslint.config.js package.json tsconfig.tooling.json scripts/
git commit -m "chore(tooling): lint, type-check and format scripts/ .mjs"
```

---

### Task 7: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the coverage gate**

Run: `make cover`
Expected: PASS — all four projects green; thresholds (95/85/90/95) met; `scripts/native-cache.mjs` covered, `scripts/ensure-native.mjs` excluded.

- [ ] **Step 2: Run the format/lint/typecheck CI gates**

Run: `make lint-check && make format-check && make typecheck`
Expected: all PASS.

- [ ] **Step 3: Confirm the cache is not tracked by git**

Run: `git status --porcelain .native-cache; git check-ignore .native-cache`
Expected: the first command prints nothing (untracked-and-ignored, so not listed); the second prints `.native-cache` (confirming the ignore rule matches).

- [ ] **Step 4: Final commit (only if Steps 1–3 surfaced fixes)**

If any gate required a fix, commit it:

```bash
git add -A
git commit -m "fix(tooling): address full-suite verification findings for native cache"
```

Otherwise, no commit — the feature is complete.

---

## Self-Review

**Spec coverage:**

- Cache key `{version, platform, arch, abi}` → Task 1 (`computeCacheKey`) + Task 4 (key assembled from `process.*`).
- Layout `.native-cache/<key>/better_sqlite3.node`, single file cached → Task 4 (`cacheBinaryPath`, `atomicCopy`).
- In-repo, gitignored, outside `node_modules` → Task 1 Step 1.
- Algorithm (Node-major guard → probe → warm/restore/rebuild → re-probe → save) → Task 2 (`validateNodeMajor`) + Task 3 (`orchestrate`) + Task 4 (entry-point ordering, S10 first).
- Atomic copy → Task 4 (`atomicCopy`).
- I5/S10/S6 preserved → comments in Tasks 2–4; verified behaviorally in Task 4 Steps 3–4 and Task 5.
- Code split (`native-cache.mjs` pure + `ensure-native.mjs` IO) → Tasks 1–4.
- Testing with injected fakes → Task 3.
- 4th Vitest project + coverage exclusion of the IO shell (Finding 1) → Task 1 Step 2–3, Task 4 Step 1.
- `.mjs` type-check + lint (Finding 2) → Task 6.
- Concurrency unsupported (Finding 3), version-keyed caveat (Finding 4), security framing (Finding 5), AC#1 wording (Finding 6) → documentation-only in the spec; no code behavior to implement, so no task — correctly excluded.
- Makefile delegates to the script → Task 5.
- Acceptance criteria 1–6 → Task 4 Steps 3–4 (restore speed, cold build, corrupt self-heal), Task 5 (guards intact via `make test`), Task 7 Step 3 (gitignored), Task 7 Step 1 (coverage).

**Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step states the exact command and expected result. The two "if a gate complains, fix X" notes (Task 6 Steps 5–6) name the concrete remedy and scope, not a vague "handle errors".

**Type consistency:** `computeCacheKey` input `{version, platform, arch, abiVersion}` is identical in Task 1 and its call site in Task 4. `validateNodeMajor` returns the `NodeMajorResult` union consumed by the entry point's `reason`/`expected`/`actual` branches in Task 4. `orchestrate`'s `OrchestrateDeps` (key, probe, cacheHas, restoreFromCache, saveToCache, deleteCacheEntry, rebuild, log) match exactly between the definition (Task 3), the test fakes (Task 3), and the real wiring (Task 4). `OrchestrateOutcome` tags are identical across the impl, the tests, and the entry-point `if` checks (`rebuild-failed`, `rebuilt-but-unloadable`, etc.).
