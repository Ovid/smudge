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
see the Makefile's I5 note. **This design adds no new *network*-trust surface:**
the cache only ever holds binaries *we compiled locally on this machine*;
nothing is fetched. Restoring a cached binary has the same provenance as
recompiling it, just faster. The S10 (pin Node major before the probe) and S6
(re-probe after a rebuild) guards are retained.

It does add a small **local** tampering surface that the status quo lacks: a
long-lived, writable binary at a stable path (`.native-cache/<key>/`) that is
later copied into `node_modules` and `dlopen`'d with developer privileges, and
that survives an `npm rebuild` (which only overwrites `build/Release/`). The
mitigation is that `.native-cache/` lives in the **same trust domain as
`node_modules` itself** — already writable and already `dlopen`'d — so the
marginal surface is small, and it is repo-local / `rm -rf`-able. Note that the
self-heal re-probe (delete + rebuild on *load failure*) is **not** a security
control: it confirms a cached binary is *loadable*, not that it is the binary we
compiled. A threat model that includes a local attacker able to write the repo
tree already includes write access to `node_modules`; this design does not widen
that boundary, only its lifetime.

## Cache key & layout

- **Key:** `better-sqlite3@<version>-<platform>-<arch>-abi<modules>`
  - Example: `better-sqlite3@11.10.0-linux-arm64-abi127`
  - `version` from `better-sqlite3/package.json`; `platform`/`arch` from
    `process.platform`/`process.arch`; `modules` from `process.versions.modules`
    (the Node ABI / `NODE_MODULE_VERSION`).
  - Version-keying means a `better-sqlite3` **version** upgrade auto-invalidates
    — a stale binary for an old version is never served.
  - **Caveat (version-keyed, not content-keyed):** the binary is a function of
    *source*, not just the version string. A workflow that patches
    better-sqlite3's source *without* bumping its version (e.g. `patch-package`,
    an `npm overrides` patch, or a local edit to the C++) would collide with the
    existing key and serve a stale binary, silently masking the patch. The repo
    has no such patches today; if one is ever introduced, clear the cache
    (`rm -rf .native-cache/`) or extend the key with a hash of `binding.gyp` +
    `src/`. Recorded as a known limitation, not built now (YAGNI).
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

**Concurrency — cross-platform simultaneous runs are explicitly unsupported.**
Atomic rename keeps any *individual* file from tearing, but it does **not**
resolve the deeper interleave this cache exists to fix: there is one
`build/Release/better_sqlite3.node` slot shared across both platforms via the
bind mount. If `make` runs on **both** the host (macOS) and the container
(Linux) at the same time against that one `node_modules` — e.g. `make dev` up in
the container while `make e2e` fires on the host — they will fight over the
slot. Host `ensure-native` probes (fails — sees the Linux binary), restores the
macOS binary; the next container probe then fails and rebuilds; and so on. The
failure mode is **thrash, not corruption** (restore is gated on a `dlopen`
failure, and each file write is atomic), but it defeats the cache's purpose. The
supported model is therefore: **work on one platform at a time** against a shared
`node_modules`. A per-key lock would serialize same-platform races but cannot
make two OSes want different binaries in one slot, so it is intentionally not
added (it would add a stale-lock failure mode for no real gain here). This
limitation is inherent to sharing one `node_modules` across platforms — the
clean fix (separate `node_modules` per platform) lives in `.devcontainer/`,
which is out of scope per CLAUDE.md.

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
    `restoreFromCache`, `saveToCache`, `deleteCacheEntry`, `rebuild`, `log`) and
    returns the action taken — one of `"loaded-warmed"`,
    `"loaded-cached-already"`, `"restored-from-cache"`, `"cache-corrupt-rebuilt"`,
    `"rebuilt-from-source"`, `"rebuild-failed"`, or `"rebuilt-but-unloadable"`.
  - small pure helpers the entry point composes with real IO:
    `withBestEffortCleanup(body, cleanup)` (cleanup never masks the body's
    outcome — S1), `buildTempPath(dest, pid, token)` (collision-resistant temp
    sibling for the atomic copy — S4), and `interpretProbeError(err)` (classify a
    child-probe failure so only a clean non-zero exit counts as a dlopen failure
    — S2).

All review-sourced rationale (I5, S10, S6, the dlopen-symptom explanation)
moves from the Makefile comments into the `scripts/ensure-native.mjs` header so
the context is not lost.

Plain ESM `.mjs` (not TypeScript) so the Makefile runs it directly with `node`
and no build step is required — matching how the recipe invokes `node` today.

**Tooling coverage for `.mjs` (Finding 2).** `.mjs` at repo root is otherwise a
type-check/lint blind spot, against the repo's "TypeScript everywhere" + strict
ESLint posture. To close it without a build step:

- **Type-checking:** add `scripts/**/*.mjs` to `tsconfig.tooling.json`'s
  `include`, and enable `checkJs` (on that tooling config only) so the scripts
  are checked. Annotate the pure functions with JSDoc `@param`/`@returns` types
  (e.g. the `computeCacheKey` input shape and the `orchestrate` deps object) so
  `checkJs` has types to verify. The existing `npm run typecheck`'s
  `tsc --noEmit -p tsconfig.tooling.json` pass then covers the scripts.
- **Lint:** add `scripts/` (and the `.mjs` extension) to the ESLint globs in the
  `lint`/`lint:check` scripts and to a `files:` block in `eslint.config.js`, so
  the scripts lint under `make lint`/`make all` with the same zero-warnings bar.

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
`make cover`. Concretely, a `scripts/vitest.config.ts` (or a 4th entry in the
root `projects` array) scoped to `scripts/**/*.test.mjs`. Tests live in
`scripts/__tests__/`. This is the one piece of added configuration surface,
accepted because leaving tooling untested contradicts the repo's testing
philosophy.

**Coverage scope (Finding 1).** The root `vitest.config.ts` has a single
`coverage` block enforcing 95/85/90/95 across all projects, so a new `scripts/`
project folds straight into that global gate. `ensure-native.mjs` is, by design,
"thin IO wiring" — `npm rebuild` spawn, fs copy/rename, child-process probe —
the branches that are hard to cover with injected fakes. To avoid `make cover`
going red on un-coverable IO, **add `scripts/ensure-native.mjs` (the IO shell) to
`coverage.exclude`**, mirroring the existing `**/src/main.tsx` / `**/src/index.ts`
exclusions. The pure module `scripts/native-cache.mjs` stays **in** coverage and
must meet the thresholds via the unit tests above — that is where all the real
logic lives, so the gate still bites where it matters.

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
   running `make test` restores the correct binary near-instantly relative to the
   ~60s rebuild (a single ~2 MB file copy + rename; sub-second on a local fs,
   and in all cases no `npm rebuild` is invoked).
2. A first-ever run on a platform (cold cache) compiles once and populates
   `.native-cache/<key>/`.
3. A deliberately corrupted cache entry is detected, deleted, and rebuilt.
4. All existing `ensure-native` guards (Node-major pin, install check,
   post-rebuild re-probe, helpful failure messages) still hold.
5. `.native-cache/` is gitignored and never committed.
6. New unit tests pass under `make cover` and do not lower coverage.
