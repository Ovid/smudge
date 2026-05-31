# Platform-keyed cache for the better-sqlite3 native binary

**Date:** 2026-05-31
**Status:** Approved design — ready for implementation plan
**Scope:** Dev tooling only (`ensure-native`). No application code, no shipped artifact, no production runtime.

## Problem

`better-sqlite3` ships/builds a single compiled binary at
`node_modules/better-sqlite3/build/Release/better_sqlite3.node`, keyed to
`{platform, arch, node-ABI}`. On a dev machine that runs Smudge both natively on
the macOS host (`darwin/arm64`) and inside the Linux devcontainer
(`linux/arm64`) against **one bind-mounted `node_modules`**, there is only one
slot for that binary. Whichever platform ran last wins; the other side hits a
`dlopen` failure (`slice is not valid mach-o file` on macOS loading an ELF, or
`invalid ELF header` on Linux loading a Mach-O).

Today `make ensure-native` (a prerequisite of `make test`, `cover`, `e2e`, and
`dev`) responds to that failure by recompiling from source via
`npm rebuild better-sqlite3 --build-from-source` — roughly 60 seconds, paid on
**every** host↔container crossing. That repeated cost is the annoyance this
design removes.

### What this is and is not

- **Not application code.** Nothing in `packages/` changes. The only new code is
  the `ensure-native` tooling script. The cached file is the exact artifact
  `npm rebuild` already produces — byte-identical. We only change *where a copy
  is stashed*, not what runs.
- **Not production.** The shipped Docker image builds the binary once, for a
  single platform, with no shared `node_modules` and no host↔container crossing.
  The thrash exists only on a cross-platform dev machine.
- **Dev-wide, not just tests.** `ensure-native` gates `test`, `cover`, `e2e`,
  and `dev`, so this speeds the dev-server start too — but it is entirely
  dev-time. The running app's behavior is unchanged.

## Goal

On a `dlopen` failure, **copy the matching cached binary into place (<1s)**
instead of recompiling. Compile only on a genuine cache miss, then save the
result. First crossing to each platform compiles once; every crossing after is
a fast file copy.

## Security invariants preserved

The current recipe deliberately uses `npm rebuild --build-from-source` rather
than `prebuild-install` so that compilation (inputs covered by
`package-lock.json` integrity + the local toolchain) replaces network trust —
see the Makefile's I5 note. **This design adds no network-trust surface:** the
cache only ever holds binaries *we compiled locally on this machine*. Restoring
a cached binary has the same provenance as recompiling it, just faster. The
S10 (pin Node major before the probe) and S6 (re-probe after a rebuild)
guards are retained.

## Cache key & layout

- **Key:** `better-sqlite3@<version>-<platform>-<arch>-abi<modules>`
  - Example: `better-sqlite3@11.10.0-linux-arm64-abi127`
  - `version` from `better-sqlite3/package.json`; `platform`/`arch` from
    `process.platform`/`process.arch`; `modules` from `process.versions.modules`
    (the Node ABI / `NODE_MODULE_VERSION`).
  - Version-keying means a `better-sqlite3` upgrade auto-invalidates — a stale
    binary for an old version is never served.
- **Layout:** `.native-cache/<key>/better_sqlite3.node`
  - Only the single `.node` file is cached — it is what the `bindings` loader
    actually `dlopen`s. The `sqlite3.a`, `obj/`, `obj.target/`, `.deps/`, and
    `test_extension.node` build intermediates in `build/Release/` are not needed
    at runtime and are not cached.
- **Location rationale:** `.native-cache/` at the repo root, added to
  `.gitignore`. It lives outside `node_modules` (so `npm install` does not wipe
  it) and is tied to the repo (so `rm -rf` of the repo removes it — no orphaned
  clutter in the developer's home directory). Each platform writes its own keyed
  subdir, so the shared bind mount is safe (distinct keys → distinct files, no
  collision).

## Algorithm

`ensure-native` runs these steps in order:

1. **Validate Node major** against `engines.node` (existing guard; runs first so
   a developer with a foreign Node active never reaches the rebuild/cache path).
   Supports `22`, `22.x`, `22.5.0`, `^22.5`, `~22.5`; rejects multi-major ranges
   with a clear message.
2. **Validate `better-sqlite3` is installed** (existing guard;
   `require.resolve` check → "run npm install first").
3. **Probe** load: `new (require('better-sqlite3'))(':memory:').close()`.
   - **Loads** → *warm the cache*: if `.native-cache/<key>/better_sqlite3.node`
     is absent, copy the current `build/Release/better_sqlite3.node` into it.
     Exit 0.
   - **Fails** → compute `<key>` and look in the cache:
     - **Cache hit** → atomic-copy the cached `.node` into
       `build/Release/better_sqlite3.node`, then **re-probe**:
       - Loads → done (the fast path; the win). Exit 0.
       - Still fails → the cache entry is corrupt/incompatible: delete that
         cache entry and fall through to rebuild.
     - **Cache miss** → fall through to rebuild.
4. **Rebuild** (only reached on miss or corrupt cache):
   `NPM_CONFIG_IGNORE_SCRIPTS=false npm rebuild better-sqlite3 --build-from-source`.
   On failure → existing helpful error (missing toolchain / python3 / Node
   mismatch / try clean install), exit 1.
5. **Re-probe after rebuild** (existing S6 guard). Still fails → existing helpful
   error (stale node-gyp cache / multiple `.node` copies / missing shared libs /
   partial extraction), exit 1.
6. **Save to cache** on rebuild success: copy the fresh
   `build/Release/better_sqlite3.node` into `.native-cache/<key>/`. Exit 0.

**Atomicity:** every copy (into `build/Release/` and into the cache) writes to a
temp file in the destination directory and `rename`s into place, so an
interrupted copy cannot leave a torn binary.

**Concurrency:** two simultaneous `make` invocations racing on the copy is
accepted low-risk for a single-developer workflow; atomic rename keeps any
individual file consistent.

## Code structure

Replace the ~40-line inline `node -e` blob in the Makefile `ensure-native`
target with a single `@node scripts/ensure-native.mjs`. New `scripts/` dir:

- **`scripts/ensure-native.mjs`** — entry point. Thin IO wiring: the real probe
  (spawns a `node -e` load test), filesystem copy/exists/mkdir/rename, and the
  `npm rebuild` invocation. Reads `package.json` `engines.node` and
  `better-sqlite3/package.json` `version`. Calls into the pure core and renders
  the user-facing messages.
- **`scripts/native-cache.mjs`** — pure logic, no IO of its own:
  - `computeCacheKey({ version, platform, arch, abiVersion }) → string`
  - `validateNodeMajor(enginesNode, actualNodeVersion) → { ok, expected, actual, reason? }`
  - an `orchestrate(deps)` function that takes injected IO (`probe`, `cacheHas`,
    `copyFromCache`, `copyToCache`, `deleteCacheEntry`, `rebuild`, `log`) and
    returns the action taken (e.g. `"loaded-warmed"`, `"cache-hit"`,
    `"rebuilt-saved"`, `"cache-corrupt-rebuilt"`, `"rebuild-failed"`).

All review-sourced rationale (I5, S10, S6, the dlopen-symptom explanation)
moves from the Makefile comments into the `scripts/ensure-native.mjs` header so
the context is not lost.

Plain ESM `.mjs` (not TypeScript) so the Makefile runs it directly with `node`
and no build step is required — matching how the recipe invokes `node` today.

## Testing (RED-GREEN-REFACTOR)

The pure core is fully testable with injected fakes — no real native compile is
exercised in the test suite.

- **`computeCacheKey`** — exact key string for a representative input.
- **`validateNodeMajor`** — `22`, `22.x`, `22.5.0`, `^22.5`, `~22.5` accepted and
  matched against active major; mismatch reported; multi-major range and garbage
  rejected with reason.
- **`orchestrate`** (IO injected as fakes):
  - probe loads → warms cache when absent; does **not** re-copy when present.
  - probe fails + cache hit → copies from cache, re-probes, succeeds (no
    rebuild called).
  - probe fails + cache hit + re-probe still fails → deletes cache entry, calls
    rebuild, saves.
  - probe fails + cache miss → calls rebuild, re-probes, saves.
  - rebuild fails → surfaces failure (no save).

**Runner:** add a 4th vitest project for `scripts/` so these run under
`make cover` and count toward coverage. Concretely, a `scripts/vitest.config.ts`
(or a 4th entry in the root `projects` array) scoped to `scripts/**/*.test.mjs`.
Tests live in `scripts/__tests__/`. This is the one piece of added
configuration surface, accepted because leaving tooling untested contradicts the
repo's testing philosophy.

## Edge cases & non-goals

- **Corrupt/stale cache entry** — self-heals: a cached binary that fails the
  re-probe is deleted and the rebuild path runs.
- **Old-version cache entries** linger after a `better-sqlite3` upgrade
  (~1.8 MB each, keyed by version). An optional cheap prune of same-
  `{platform, arch, abi}` other-version entries on warm is **noted but not
  built** (YAGNI); revisit only if accumulation becomes a real problem.
- **Cache miss is the floor.** The first crossing to a given
  `{version, platform, arch, abi}` still compiles once — the cache cannot
  pre-populate a binary it has never seen. This is expected and acceptable.

**Non-goals:**

- No `.devcontainer/` changes (out of scope per CLAUDE.md; the clean
  named-volume fix would live there and is therefore unavailable).
- No change to the shipped Docker image or production runtime.
- No migration off `better-sqlite3` (e.g. to `node:sqlite` or `sql.js`).

## Acceptance criteria

1. After a warm cache exists for both platforms, switching host↔container and
   running `make test` restores the correct binary in well under a second with
   no `npm rebuild` invoked.
2. A first-ever run on a platform (cold cache) compiles once and populates
   `.native-cache/<key>/`.
3. A deliberately corrupted cache entry is detected, deleted, and rebuilt.
4. All existing `ensure-native` guards (Node-major pin, install check,
   post-rebuild re-probe, helpful failure messages) still hold.
5. `.native-cache/` is gitignored and never committed.
6. New unit tests pass under `make cover` and do not lower coverage.
