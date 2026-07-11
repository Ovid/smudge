# Phase 4b.14 — Operational Backup Stopgap (Design)

**Date:** 2026-05-26
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** `docs/roadmap.md` — Phase 4b.14: Operational Backup Stopgap
**Sibling phase:** Phase 8b (Bundle Export `.smg`) — see `2026-05-26-bundle-export-roundtrip-design.md`

---

## Goal

Give the developer-operator (today, that is the project author running Smudge from a source checkout — see §Audience) a reliable escape hatch from a corrupted SQLite file **today**, so the months between now and Phase 8b shipping aren't a window with no recovery path. Use the current shared-data-directory layout as-is; do not anticipate Phase 8a's per-project folder model.

**Backup is automatic; restore is manual (design pivot, 2026-06-03).** The original design made *backup* a manual `make backup` the operator had to remember to run. That fails the actual usage pattern: this project is worked in bursts with long pauses, and a backup you must remember to invoke is no backup at all after a context-switch. So the trigger is inverted:

- **Backup runs automatically as a prerequisite of `make dev`** — the one command always run to start working. The operator never has to remember to back up.
- **`make backup` still exists** as an explicit on-demand backup (e.g. "snapshot right now before I do something risky") and as the shared building block the auto-hook invokes — same core, two entry points.
- **Restore stays a deliberate manual `make restore`.** Restore is rare and only reached for in a crisis, at which point the operator *will* look it up; automating it would be dangerous (it overwrites live data). Asymmetry is intentional: automate the proactive half, keep the destructive half manual and confirmed.

See §Audience for who this serves and §1a for the auto-backup mechanics (rotation, best-effort, skip conditions).

## Audience (who runs this, and its expiry)

Honest framing (settled during the /roadmap pushback): **these are operator/dev tools, not end-user-writer tools.** They are Makefile targets run through `tsx` (a devDependency) from a Smudge source checkout — they require the checkout, installed `node_modules`, and `make`. A non-technical writer using a future packaged build would have none of those.

This is acceptable **only** because of where Smudge is today: there is no Dockerfile / packaged build yet (CLAUDE.md), so the only way to run Smudge is `make dev` from the checkout — meaning the "writer" right now *is* the operator at the repo. When Smudge ships as a container, `make` and the devDeps won't exist inside it, and the writer-facing backup story becomes **Phase 8b**'s portable per-project export. 4b.14 is explicitly the interim stopgap with a defined expiry; `docs/backup.md` states this plainly so no one mistakes it for the permanent answer.

**Authoritative path resolution (pushback Issue 1).** The data dir and DB path are *not* re-derived by this feature. The single owner of "where Smudge persists data" is `packages/server/src/config/paths.ts` (the F-5 invariant):

- `getDataDir()` → `process.env.DATA_DIR` ?? `<pkg>/../../data` (default `packages/server/data/`). Images live at `join(getDataDir(), "images")`.
- `getDbPath()` → `process.env.DB_PATH` ?? `join(getDataDir(), "smudge.db")`. **`DB_PATH` can point outside the data dir** — operators may place the DB elsewhere on purpose, so the DB path is resolved independently of the images root.

Both `make backup` and `make restore` import and call `getDataDir()` / `getDbPath()` directly. They must never re-implement this resolution (the original design did, via `dirname(DB_PATH)`, which ignored `DATA_DIR` and silently targeted the wrong directory — exactly the duplication F-5 was created to eliminate).

## Why Now

Phase 8b is the long-term answer for per-project, portable, versioned backup. It depends on Phase 8a (per-project folder layout), which depends on Phase 7g (Electron runtime prep). Realistically that is months out. Until then the only path back from a corrupted `smudge.db` is "hope the host's filesystem snapshots covered it" — which is not a contract Smudge gets to make on the user's behalf.

The stopgap is intentionally **separate from Phase 8b**, not folded into it:

- Folding the urgent thing into the slow thing inverts the priority. Doing them as one phase means the urgent thing waits on the slow thing.
- The stopgap uses the *current* data layout. Phase 8b uses the *post-8a* layout. They share almost no code.
- The throwaway risk is bounded and low. When 8b ships, `make backup` can either be deprecated or kept as a "back up everything at once" complement to per-project `.smg`. That decision belongs to the 8b era.

## Forward-compatibility policy for old archives

**Hard commitment: `make restore` (or whatever its successor is named) must be able to read any archive written by any prior Smudge version, indefinitely.** A backup that becomes unreadable because the user upgraded Smudge is not a backup — it's a time bomb. The "I made a backup before the upgrade, now I can't restore it" failure mode must not exist.

This policy applies most acutely at the Phase 8a boundary, when the on-disk layout changes from a shared `<data-dir>/smudge.db` to per-project `.smudge/` folders. The mechanics:

1. **8a inherits the obligation.** Phase 8a's roadmap entry is updated (alongside this design) to note that 8a owns "restore an old 4b.14 archive into the new per-project layout." The migration logic 8a already needs for live upgrades (extract per-project state from the shared SQLite into per-project folders) is reused for restored archives.
2. **`make restore` learns to detect old-layout archives.** Trivial: if the archive's top-level contains `smudge.db` (not `<slug>.smudge/`), it's a pre-8a archive. The restore path forks: pre-8a archives go through the 8a migration; post-8a archives extract into per-project folders directly.
3. **No silent data loss.** If 8a's migration encounters a project shape it can't migrate (some hypothetical future inconsistency), it refuses with a clear error and leaves the original archive intact. The user's data is never destroyed by a failed restore.
4. **The 4b.14 archive format does not change.** Its zip layout is "whatever the shared-data layout was at write time." Old archives stay readable because 8a knows how to translate the old layout to the new one — not because the archive format pretends to be future-proof.

This policy is stated here (rather than only in Phase 8a) so the contract is visible to anyone reading 4b.14 first. The 4b.14 implementation does not need to do anything special — its job is just to write an honest snapshot of the current layout. Forward-compat is 8a's job at 8a-time.

## In Scope

1. A `make backup` Makefile target that produces a single timestamped zip archive under `backups/` (explicit, on-demand; also the shared core the auto-hook calls).
1a. **Automatic backup wired into `make dev`** (design pivot): a `make dev` prerequisite that snapshots the existing DB+images before the dev server starts, **best-effort** (a backup failure warns loudly but never blocks `make dev`), **rotated** (keeps the last N auto-backups, prunes older — default N=10, override via `SMUDGE_BACKUP_KEEP`), and **skipped** when there is no DB yet (fresh checkout) or when `SMUDGE_SKIP_AUTO_BACKUP=1` is set (fast-start escape hatch). See §1a.
2. A `make restore BACKUP=<file>` Makefile target that restores a zip archive after confirming with the user.
3. A short `docs/backup.md` documenting the recipe (auto-on-`make dev`, manual `make backup`, manual `make restore`), cadence/offsite guidance, the operator-audience framing, and the interim-vs-8b relationship.
4. Tests that cover the backup + restore round-trip, rotation/pruning, best-effort non-blocking, and skip conditions on a small fixture data dir.
5. A `.gitignore` update so backup artifacts can never be committed (pushback Issue 5): add `backups/` and the staging file pattern (`*.backup-staging.db`). Verify `packages/server/data/` is already ignored (it holds the live DB); if so, the staging file under it is already covered and only `backups/` strictly needs adding — add only what is actually missing. A `make backup` (or an auto-backup on `make dev`) followed by `git add -A` must not be able to commit the writer's manuscript.
6. A `CLAUDE.md` §Build & Run Commands update documenting `make backup` / `make restore` **and** the new auto-backup side-effect of `make dev` (decided during the /roadmap CLAUDE.md review). Lands in the same PR as the targets.

## Out of Scope

- Per-project export. That's Phase 8b's job.
- Format versioning. The archive is whatever shape the data dir is right now — no `manifest.json`, no `format_version`. Forward compatibility is irrelevant because nothing reads this archive except `make restore` running against the same Smudge version.
- Scheduled / cron / daemon-based automation. The auto-backup is a `make dev` **prerequisite** (fires on a command the operator already runs), *not* a background timer, cron entry, or OS service. No always-on process.
- Auto-backup on any start path other than `make dev` (e.g. launching the server directly). Out of scope by the trigger decision (2026-06-03); covers the operator's actual workflow without putting backup logic in the app.
- Off-host copying (rsync, S3, etc.). The archive lands on the host; moving it offsite is the user's problem.
- A UI for backup/restore. CLI only.
- Pruning of **manual** `make backup` archives. Rotation applies only to the auto-backup archives (distinct filename prefix, §1a); manual backups are deliberate and kept indefinitely.

---

## 1. `make backup` design

### Output

```
backups/smudge-2026-05-26-143211.zip
  smudge.db                       # consistent point-in-time snapshot (from getDbPath())
  images/                         # everything under getDataDir()/images/
    <projectId>/<uuid>.jpg        # images are stored per-project, NOT flat
    <projectId>/<uuid>.png
    ...
```

**Image layout (pushback Issue 6).** Images live in per-project subdirectories — `join(getDataDir(), "images", <projectId>, <file>)` (see `db/purge.ts`). Backup and restore walk the `images/` tree **recursively**, so the nesting round-trips correctly and the mechanism is indifferent to depth; the test fixtures must mirror the real `images/<projectId>/<file>` shape rather than a flat directory.

Filename encodes the trigger and a UTC timestamp:

- **Manual** (`make backup`): `smudge-<ISO-8601-UTC>.zip` (e.g. `smudge-2026-05-26T143211Z.zip`).
- **Automatic** (`make dev` prerequisite): `smudge-auto-<ISO-8601-UTC>.zip`.

The distinct `-auto` infix is load-bearing: **rotation prunes only `smudge-auto-*.zip`**, never `smudge-*.zip` manual archives (§1a). **UTC, not local time (S-F1):** rotation picks the newest N by a lexical filename sort with no stat() calls, and only a UTC stamp keeps that sort monotonic across a DST fall-back or backward clock step — a local-time stamp can make a later backup sort *before* an earlier one and prune the wrong file. (`-` < `T`, so any legacy local-time `…-HHmmss.zip` names sort before all new `…THHmmssZ` names, and mixed dirs rotate correctly with no migration.) Hyphens/`T`/`Z` (no colons) keep the name filesystem-safe on every host. The operator-facing move-aside path still uses a local-time stamp (`isoStampLocal`) for human readability.

**Format choice: zip, not tar.gz.** Two reasons: (1) consistency with Phase 8b's `.smg` (also a zip archive), so backup-related tooling speaks one format; (2) cross-platform portability — every supported host OS has native zip support, whereas tar.gz on older Windows is a frequent friction point.

### SQLite snapshot mechanism

Use SQLite's **`VACUUM INTO`** to produce a clean copy of the DB at a single point in time, rather than `cp`. `VACUUM INTO` is safe to run while the live Smudge process holds connections to the same DB — it's the SQLite-blessed online-backup path. Plain `cp` is dangerous because the WAL file can be out of sync with the main DB file at any given instant; restoring such a copy may surface partial transactions or appear corrupt.

The flow:

1. Resolve paths via `config/paths.ts`: the DB file is `getDbPath()`, the images root is `join(getDataDir(), "images")` (see §Goal — never re-derived here).
2. Open a read-only connection to the live DB at `getDbPath()`.
3. `VACUUM INTO '<staging>.db'` where the staging file lives in `getDataDir()` (e.g. `join(getDataDir(), ".backup-staging.db")`).
4. Zip the staging DB (renamed inside the archive as `smudge.db`) + the live `getDataDir()/images/` tree into `backups/smudge-<timestamp>.zip`.
5. Delete the staging file.

Step 4 (image archiving) happens after step 3 (DB snapshot) finishes. The window between the DB snapshot and the image archive is small but non-zero — if the writer uploads an image during that window, the image file will be in the archive even though it's not referenced by the snapshotted DB. That is a *safe* inconsistency (an unreferenced image on restore is harmless; orphaned-image cleanup is already on the future-cleanup list per CLAUDE.md). The inverse (image referenced in DB but missing from archive) cannot happen because uploads write the image file *before* inserting the DB reference.

### Implementation surface

**Pure-core + thin-shell split (pushback Issue 3).** To keep the security-critical logic under the project's coverage floor (95% lines / 85% branches — CLAUDE.md §Testing Philosophy) and to follow the established `dep-cooldown` precedent (pure logic under coverage, thin IO shell coverage-excluded):

- **`packages/server/src/backup/backup-core.ts`** — pure, dependency-injected logic, **under coverage**: path resolution (delegating to `config/paths.ts`), the zip-slip validator (§2a), the decompression-bomb size checks (§2b), and the backup/restore orchestration with injected fs / db / clock / archive seams. Unit-tested in-process via Vitest — no child-process spawning for the logic.
- **`packages/server/scripts/backup.ts`** and **`packages/server/scripts/restore.ts`** — thin IO shells (**coverage-excluded**, per the `dep-cooldown.mjs` precedent) that parse argv, wire the real fs / `better-sqlite3` / archive library, and call the core. A single child-process round-trip test exercises the shell + Makefile wiring end-to-end (the seam the in-process unit tests can't reach); the logic coverage comes from the core's unit tests.

The shells live in the server package because they use `better-sqlite3` (already a server dep) and import the server's `config/paths.ts`.

**TS runner (pushback Issue 4).** The Makefile invokes the shells via **`tsx`** (already a `packages/server` devDependency and the repo's standard TS runner), **not** `node --experimental-strip-types` (experimental on Node 22, emits an `ExperimentalWarning` on every run, and would be a second TS-execution mechanism). Because `tsx` is a devDependency, `make backup`/`make restore` are developer-run-from-checkout tools — `docs/backup.md` states this explicitly.

**Library choice: `jszip` (decided 2026-06-03).** Already present in `packages/server`'s `devDependencies` (v3.10.1, used by tests), so no new dependency and no cooldown wait. Its license is dual `MIT OR GPL-3.0-or-later`; per CLAUDE.md §Dependency Licenses #5, **elect MIT** and record the election in `docs/dependency-licenses.md`. Deliverable: promote `jszip` from `devDependencies` to `dependencies` in `packages/server/package.json` (a one-line move; the version is unchanged so the cooldown gate sees no new young version) and add/update its `docs/dependency-licenses.md` row noting the MIT election.

`archiver`/`yauzl` (streaming) were considered and rejected: after the audience pivot, restore mostly consumes archives this tool itself produced, so a new streaming dependency is disproportionate for a throwaway stopgap. `tar` is likewise avoided (`.tar.gz` was rejected as the format above).

**jszip is in-memory — bomb-defense adaptation (§2b).** Because `jszip.loadAsync` parses the whole archive into memory, the §2b "streaming watchdog" is replaced by: (1) a **declared-size pre-check read from the zip central directory on the raw bytes BEFORE `loadAsync`** (so a giant declared total is refused before anything is loaded into memory), (2) the free-space check, and (3) a **post-extraction cumulative-size assertion** (sum of bytes actually written must not exceed the declared total beyond minor slack). See §2b.

```ts
// Sketch — not final; library choice deferred. Path resolution delegates to
// config/paths.ts (NOT re-derived) per pushback Issue 1.
import Database from "better-sqlite3";
import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getDataDir, getDbPath } from "../src/config/paths";

async function main() {
  const dataDir = getDataDir();
  const dbPath = getDbPath(); // may live outside dataDir
  const imagesDir = join(dataDir, "images");
  const stamp = isoStampUtc(); // UTC → lexical sort stays chronological (S-F1)
  const outFile = resolve("backups", `smudge-${stamp}.zip`);
  const staging = join(dataDir, ".backup-staging.db");

  await mkdir("backups", { recursive: true });
  await rm(staging, { force: true });

  const db = new Database(dbPath, { readonly: true });
  db.exec(`VACUUM INTO '${staging.replace(/'/g, "''")}'`);
  db.close();

  // ... build a JSZip, addFile("smudge.db", <staging bytes>) + walk images/<projectId>/...
  // and generateAsync({ type: "nodebuffer" }) to outFile (jszip — see Library choice)

  await rm(staging, { force: true });
  console.log(`Backup written: ${outFile}`);
}
```

The Makefile target (runs via `tsx`, see "TS runner" above):

```makefile
backup: ensure-native
	@node_modules/.bin/tsx packages/server/scripts/backup.ts
```

`ensure-native` is already a prerequisite of `make dev/test/cover/e2e`; the same prerequisite ensures the rebuild story is consistent.

---

## 1a. Automatic backup on `make dev` (design pivot, 2026-06-03)

The operator never has to remember to back up: `make dev` snapshots the existing state before starting the dev server.

### Makefile wiring

```makefile
# auto-backup is best-effort: the trailing `|| true` (and the script's own
# non-zero-only-on-its-own-bug contract) guarantee a backup hiccup never
# blocks the dev server from starting.
auto-backup: ensure-native
	@node_modules/.bin/tsx packages/server/scripts/auto-backup.ts || true

dev: ensure-native auto-backup
	# ... existing dev startup ...
```

`auto-backup.ts` is a second thin shell over the same `backup-core` used by `make backup` — it calls the shared backup routine with `mode: "auto"` (which selects the `smudge-auto-` prefix) and then runs rotation.

### Behavior contract

1. **Skip when there is nothing to back up.** If `getDbPath()` does not exist (fresh checkout, brand-new project, never-run server), print one line (`no database yet — skipping auto-backup`) and exit 0. Backing up a nonexistent DB is not an error.
2. **Skip on opt-out.** If `SMUDGE_SKIP_AUTO_BACKUP=1`, print `auto-backup skipped (SMUDGE_SKIP_AUTO_BACKUP)` and exit 0. Fast-start escape hatch for rapid restart loops.
3. **Best-effort, never blocks.** Any failure inside auto-backup (disk full, locked file, library error) is caught, logged as a clear `WARNING: auto-backup failed: <reason> — starting Smudge anyway` to stderr, and the script exits 0. The dev server must start regardless. (The `|| true` in the Makefile is belt-and-suspenders; the script itself swallows its own operational failures and only ever exits non-zero on a genuine programming bug, which surfaces in tests, not in normal dev.)
4. **Rotation.** After a successful auto-backup, list `backups/smudge-auto-*.zip`, sort lexically (= chronologically), and delete all but the newest `SMUDGE_BACKUP_KEEP` (default 10). Rotation **only** matches the `smudge-auto-` prefix — manual `smudge-<stamp>.zip` archives are never touched. Rotation failure is also best-effort (warn, continue).
5. **Unique staging file.** The `VACUUM INTO` staging file name includes the timestamp (and pid) so two near-simultaneous `make dev` invocations cannot collide on one staging path. Staging always lands in `getDataDir()` and is removed in a `finally`.

### Why a prerequisite, not a daemon or cron

The trigger is the command the operator already runs. No always-on process, no scheduler, nothing to configure or remember. It backs up the *previous* session's committed state — which is exactly what you want to recover after corruption (the prior good snapshot), not the half-finished current edit. The cost is a small, bounded startup delay (a `VACUUM INTO` of a small DB + zipping images); `SMUDGE_SKIP_AUTO_BACKUP=1` exists for the rare case that delay is unwanted.

### Delta self-review (acting as pushback on the pivot)

The pivot was introduced after the formal pushback pass, so its new surface is reviewed here:

- **Startup latency** on every `make dev` for image-heavy projects → bounded, and `SMUDGE_SKIP_AUTO_BACKUP=1` is the escape hatch. Accept + document.
- **Pruning safety** (deleting the wrong file) → mitigated by the dedicated `smudge-auto-` prefix match + a test asserting manual archives and non-matching files are never deleted.
- **Concurrent `make dev`** → mitigated by the timestamp+pid staging filename and atomic temp-then-rename of the final zip.
- **Silent best-effort failure hiding a chronic problem** → the WARNING is loud (stderr, unmistakable wording); `docs/backup.md` tells the operator that repeated warnings mean backups aren't happening and to investigate.
- **Partial/corrupt zip on crash mid-write** → write to a temp name, atomic rename; a crash leaves a harmless `*.tmp` file (gitignored, under `backups/`) that rotation ignores and never counts as a valid archive. The load-bearing guarantee — no half-written `smudge-auto-*.zip` — holds via the atomic rename. The stray `*.tmp` is not auto-cleaned (it is invisible and harmless); the operator can delete `backups/*.tmp` anytime.

---

## 2. `make restore` design

### Invocation

```
make restore BACKUP=backups/smudge-2026-05-26-143211.zip
```

If `BACKUP=` is missing, the target prints usage and exits non-zero.

### Behavior

1. Verify the archive exists and is a valid zip containing at least `smudge.db`.
2. **Validate every entry path against zip-slip** (see §2a). If any entry would resolve outside the target dir, refuse the entire archive without writing anything.
2a. **Validate declared uncompressed sizes against the bomb-defense limits** (see §2b). If the declared total exceeds the absolute cap or the compression-ratio cap, refuse without writing anything.
3. Probe for a running Smudge server **via its HTTP port** (pushback Issue 2). A TCP connect to the configured server port (default `3456`, honoring `SMUDGE_PORT`) on both `127.0.0.1` and `::1`; if either connects, refuse: "Smudge is running — stop it and rerun." This mirrors the proven `make e2e-clean` probe (CLAUDE.md documents it probing `127.0.0.1:3457` and `::1:3457`). A DB-file lock probe was rejected: SQLite uses transient POSIX byte-range (`fcntl`) locks held only during an active transaction — not a persistent `flock` — so an idle-but-running server holds no lock and a file probe would report a false "safe," then clobber the live DB. The HTTP probe degrades gracefully (a server on a custom port not exported to the `make restore` environment is missed, i.e. no worse than no guard) rather than giving false confidence. Do **not** attempt to stop the server ourselves; that's the user's call. The move-aside step (5) is the backstop if the probe is evaded.
4. Prompt for explicit confirmation: "This will overwrite the data dir at `<data-dir>`. Type the backup filename to confirm:" — the user has to type the basename of the backup file. This is the Word "highly recommend you operate on a copy" pattern, mechanized: you cannot fat-finger a restore.
5. Move existing `<data-dir>/` to `<data-dir>.before-restore-<timestamp>/`. Do not delete it; let the user clean up later.
6. Unzip the archive into a fresh `<data-dir>/`.
7. Print: "Restored from `<backup>`. Previous data preserved at `<data-dir>.before-restore-<timestamp>/`."

The "move-aside, don't delete" rule is deliberate: restore is destructive, and people grab the wrong archive sometimes. The cost of disk space for one extra copy is much smaller than the cost of an unrecoverable mistake.

### 2a. Zip-slip defense (security contract)

`make restore` extracts an untrusted archive. Without explicit path validation, a crafted entry like `../../Users/ovid/.ssh/authorized_keys` causes naive extractors to write *outside* the target directory — full arbitrary file write as the running user. This is a well-known CVE class (zip-slip / path-traversal) and must be defended against before any extraction begins.

**Validation rule** (applied to every entry before any byte is written to disk):

1. Compute `targetRoot = path.resolve(<data-dir>)`.
2. For each entry, compute `entryDest = path.resolve(targetRoot, entry.path)`.
3. Require `entryDest === targetRoot || entryDest.startsWith(targetRoot + path.sep)`.
4. Additionally reject entries whose declared path is absolute, contains a Windows drive letter, contains `..` as any segment after normalization, or contains null bytes.
5. On the first violation, refuse the entire archive and exit non-zero without moving `<data-dir>` or writing anything. The error message names the offending entry path.

The validation runs as a separate first pass — read all entry names, validate, then extract. Two-pass discipline avoids the "extracted 80% then aborted, partial state on disk" failure mode.

`jszip` does *not* validate entry paths by default. Whatever library is selected for implementation must either do this validation natively (e.g., recent versions of `archiver`'s extract counterpart) or have this validation layer added explicitly. The selection criterion is "validates by default, or has a small validation wrapper" — not "decompresses fastest."

### 2b. Decompression-bomb defense (security contract)

A small archive (a few hundred KB) can be crafted to decompress to gigabytes — overlapping entries, deeply repeated patterns, nested archives (`42.zip` is the canonical demo: ~42 KB → 4.5 PB). Naive extraction streams every byte to disk and can brick the host before completing. Even though the 4b.14 stopgap normally consumes its own outputs, restore should defend against the case where the archive came from somewhere else (downloaded a backup from another machine, restored from offsite copy).

Apply three defenses in order (adapted for jszip's in-memory model — see §Library choice):

1. **Pre-load declared-size check, read from the raw central directory.** *Before* `jszip.loadAsync` (so nothing is parsed into memory yet), parse the zip central directory off the raw bytes to sum every entry's declared uncompressed size. Refuse if:
   - the sum exceeds `maxUncompressed` (default 2 GiB), or
   - the sum divided by the compressed archive size exceeds `maxRatio` (default 10). Typical legitimate Smudge backups achieve 2-4× compression on text + image content, well below the cap.
   This ordering is the key adaptation: a non-streaming library must reject the bomb *before* loading, not during. **Residual (accepted — backlog S1):** this holds only for an *honest* central directory. A *lying* CD that under-declares its sizes passes this pre-load check, and `file.async("nodebuffer")` then inflates the real (oversized) entry fully into RAM before the per-entry disk assertion (#2) can fire — so a crafted archive can OOM the host even though "reject before loading" is satisfied on paper. This is a deliberately-accepted residual for the single-operator stopgap (the operator runs `make restore` on their own machine against their own archives); a true fix (a per-entry streaming size cap) is tracked as backlog S1, not shipped here.
2. **Post-extraction cumulative-size assertion.** As each validated entry is written, accumulate bytes actually written; if the running total exceeds the declared total beyond minor slack, abort and refuse. This only fires for an archive whose central directory **lies** about declared sizes (the honest pre-load check #1 already rejects oversized declarations). On this rare trip the partial extraction is **not** rolled back — but the original data is intact at the move-aside path (`<data-dir>.before-restore-<time>/`), so there is no data loss; the operator recovers from the move-aside dir. (This replaces the streaming watchdog of the original streaming-library design; with jszip the check is per-entry-as-written rather than a byte stream.)
3. **Output destination has enough free space.** Before starting extraction, check that the partition holding `<data-dir>` has at least `(declared total uncompressed) + 100 MiB` free. Refuse if not. Smaller projects don't trigger this; large image-heavy projects get a clean refusal instead of mid-extraction disk-full panic.

Options `maxUncompressed` / `maxRatio` are parameters on the core restore routine (the `restore` shell exposes them as `--max-uncompressed=N` / `--max-ratio=N`). These mirror the env vars used by 8b's `POST /api/projects/import` (`SMUDGE_IMPORT_MAX_UNCOMPRESSED_BYTES`, `SMUDGE_IMPORT_MAX_COMPRESSION_RATIO`) so both code paths share the same defense.

---

## 3. `docs/backup.md` outline

Short — one page. Sections:

1. **What this is.** An operator backup recipe for the current shared-data layout, run from a Smudge source checkout (it uses `make` + the dev toolchain — see §Audience). Backup is automatic on `make dev`; restore is a manual command.
2. **What it is not.** Not Phase 8b's `.smg`. Not per-project. Not an in-app feature for end-user writers. Not offsite. Not a background daemon/cron — the auto-backup fires only as part of `make dev`.
3. **Automatic backup.** Every `make dev` snapshots the existing DB+images to `backups/smudge-auto-<time>.zip` before starting, best-effort (a warning is printed if it fails, but the dev server still starts). Keeps the newest `SMUDGE_BACKUP_KEEP` (default 10); set `SMUDGE_SKIP_AUTO_BACKUP=1` to skip for a fast restart. **If you see the auto-backup WARNING repeatedly, your backups are NOT happening — investigate (disk space, permissions).**
4. **Manual backup.** `make backup` makes a `backups/smudge-<time>.zip` on demand (e.g. before something risky). Safe to run while Smudge is up. Manual backups are never auto-pruned.
5. **How to restore.** `make restore BACKUP=…`. Smudge must be stopped. Confirms by making you type the filename. Old data is moved aside (`<data-dir>.before-restore-<time>/`), not deleted.
6. **Offsite.** Copy `backups/` to a separate disk, USB drive, or cloud sync folder. Smudge does not do this for you.
7. **When 8b ships.** This recipe will be either deprecated or kept as a "full-machine snapshot" complement to per-project `.smg`. Either way, your backups from this recipe remain readable by `make restore` against the Smudge version that wrote them.

---

## 4. Test plan

Per the pure-core + thin-shell split (§Implementation surface), the logic tests target `backup-core.ts` **in-process** (so coverage counts and runs are fast/debuggable); a **single** child-process test exercises the `make backup` → `make restore` wiring end-to-end. All image fixtures use the real nested `images/<projectId>/<file>` layout (pushback Issue 6), not a flat directory.

Core unit tests in `packages/server/src/backup/__tests__/backup-core.test.ts` (the security-critical validators — zip-slip §2a and bomb-defense §2b — are tested here, under coverage):

These call the `backup-core` routines (`runBackup`, `runRestore`, `rotateAutoBackups`, the validators) **directly, in-process** against a temp `DATA_DIR` fixture — not via `make`:

1. **Round-trip:** create a fixture DB with a project, two chapters, and two images (nested `images/<projectId>/<file>`); invoke the backup routine; wipe the fixture data dir; invoke the restore routine; assert the DB contents and image bytes are bit-for-bit identical to the fixture.
2. **Live-DB safety:** open a writer connection to the live DB and invoke the backup routine while a transaction is open; assert the backup completes and contains the pre-transaction state (since `VACUUM INTO` snapshots a consistent point in time).
3. **Restore safety:** invoke the restore routine against an archive that is missing `smudge.db`; assert it refuses without touching the data dir. Drive the restore routine with a confirmation token that does not match the backup filename; assert it aborts without touching the data dir.
4. **Zip-slip defense:** construct three malicious archives — one with a `../../etc/passwd`-style entry, one with an absolute path entry (`/etc/passwd`), one with a `..` segment after normalization (`a/../../etc/passwd`). For each, invoke the restore routine against a temp data dir and assert: (a) it refuses with the offending entry name in the error message, (b) the temp data dir is unchanged, (c) no file is written outside the temp data dir (verify by snapshotting the surrounding tmpfs before and after).
5. **Decompression-bomb defense:** construct two malicious archives — one with declared uncompressed total exceeding `maxUncompressed` (2 GiB default; use a smaller threshold in tests), one with compression ratio exceeding `maxRatio` (10 by default). For each, invoke the restore routine against a temp data dir and assert: (a) it refuses with a "decompression bomb" message, (b) no extraction was attempted, (c) the temp data dir is unchanged.
6. **Rotation keeps N and prunes only auto-backups:** seed `backups/` with 12 `smudge-auto-*.zip` files (distinct timestamps), 2 manual `smudge-*.zip` files, and 1 unrelated file; run `rotateAutoBackups` with keep=10; assert exactly the 10 newest `smudge-auto-*.zip` survive, both manual archives survive, and the unrelated file is untouched.
7. **Best-effort auto-backup never throws on operational failure:** invoke the auto-backup routine with an injected fs/db seam that fails (e.g. unwritable `backups/`); assert it resolves (does not throw / non-zero) and surfaces a WARNING. Use `expectConsole`-style assertion discipline if any console output is produced (zero-unasserted-warnings rule).
8. **Skip conditions:** (a) with no DB file present, the auto-backup routine returns a "skipped — no database" result and writes no archive; (b) with `SMUDGE_SKIP_AUTO_BACKUP=1`, it returns a "skipped — opt-out" result and writes no archive.

Test 2 uses better-sqlite3's transaction API to hold a write transaction open in a worker thread while the backup runs. Test 3 drives the confirmation through an injected prompt seam (the core takes the confirmation token as an argument; the shell is what reads stdin).

**Plus one wiring smoke-test** (`packages/server/src/__tests__/backup-cli.test.ts`, child-process): spawn `make backup` then `make restore` against a temp `DATA_DIR` fixture and assert the round-trip succeeds. This is the only child-process test — it covers the shell + Makefile + `tsx` seam that the in-process core tests cannot reach. The thin shells (`scripts/backup.ts`, `scripts/restore.ts`) are coverage-excluded (per the `dep-cooldown.mjs` precedent), so this smoke-test is for wiring confidence, not coverage.

A running-server probe test also belongs here: bind a listener on the configured port and assert `make restore` refuses (pushback Issue 2).

---

## 5. Risks and non-risks

**Risk: the WAL truncation timing.** `VACUUM INTO` doesn't touch the WAL of the source DB. If the writer has just made a change that's still in the WAL (not yet checkpointed), the snapshot will include it. This is correct behavior; the snapshot reflects the committed state including WAL entries.

**Non-risk: image-file consistency.** As noted in §1, the small window between DB snapshot and image-tar can leave an *extra* image in the tar that isn't referenced by the DB. This is harmless on restore.

**Non-risk: archive portability.** The archive is a standard zip, readable by any unzip tool on any host. Not Smudge-specific in any way. If `make restore` itself breaks in some future Smudge version, the user can still manually unzip and copy files into place.

**Risk: backup-dir bloat — bounded for auto-backups, unbounded for manual.** Because auto-backup fires on every `make dev`, it *must* rotate or it would accumulate one archive per dev start; rotation (keep newest `SMUDGE_BACKUP_KEEP`, default 10, prefix-scoped to `smudge-auto-`) bounds it. **Manual** `make backup` archives are deliberately never pruned (the operator asked for them explicitly); `docs/backup.md` tells the operator to manage those themselves. The distinct `-auto` prefix is what lets rotation touch only the disposable ones.

**Risk: auto-backup masks a chronic failure.** Best-effort means a persistently failing auto-backup (e.g. a full disk) won't stop `make dev`, so the operator could write for weeks believing they're protected. Mitigation: the failure WARNING is loud and on every `make dev`; `docs/backup.md` explicitly says repeated warnings mean backups are NOT happening and to investigate. This is the accepted trade-off for "never block the dev server."

---

## 6. What this design deliberately does NOT include

- **A schema-version marker in the tar.** The tar is "whatever the current Smudge data layout is." Restoring with a different Smudge version is on the user. (8b owns the cross-version story.)
- **Encryption.** Smudge is single-user, runs on the user's host, with no auth. Encrypting the backup tar adds key-management burden without a real threat-model gain.
- **Differential / incremental backups.** Manuscripts are small. A full archive every time is fine. If the writer ends up with 500MB of images, they can revisit.
- **A UI in the Smudge app.** This is CLI-only, deliberately. A UI implies discovery, scheduling, status — all of which belong to 8b.
