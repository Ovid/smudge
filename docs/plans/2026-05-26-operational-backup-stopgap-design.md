# Phase 4b.14 — Operational Backup Stopgap (Design)

**Date:** 2026-05-26
**Author:** Ovid / Claude (collaborative)
**Roadmap phase:** `docs/roadmap.md` — Phase 4b.14: Operational Backup Stopgap
**Sibling phase:** Phase 8b (Bundle Export `.smg`) — see `2026-05-26-bundle-export-roundtrip-design.md`

---

## Goal

Give the writer a reliable, repeatable manual-backup recipe **today**, so the months between now and Phase 8b shipping don't leave the manuscript with no escape hatch from a corrupted SQLite file. Use the current shared-data-directory layout (`packages/server/data/smudge.db` + `packages/server/data/images/`, with `DB_PATH` / a derived `SMUDGE_DATA_DIR` honored as overrides) as-is; do not anticipate Phase 8a's per-project folder model.

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

1. A `make backup` Makefile target that produces a single timestamped zip archive under `backups/`.
2. A `make restore BACKUP=<file>` Makefile target that restores a zip archive after confirming with the user.
3. A short `docs/backup.md` documenting the recipe, cadence guidance, and the interim-vs-8b relationship.
4. Tests that cover the backup + restore round-trip on a small fixture data dir.

## Out of Scope

- Per-project export. That's Phase 8b's job.
- Format versioning. The archive is whatever shape the data dir is right now — no `manifest.json`, no `format_version`. Forward compatibility is irrelevant because nothing reads this archive except `make restore` running against the same Smudge version.
- Scheduled / cron-based automation. The user runs `make backup` themselves.
- Off-host copying (rsync, S3, etc.). The archive lands on the host; moving it offsite is the user's problem.
- A UI for backup/restore. CLI only.

---

## 1. `make backup` design

### Output

```
backups/smudge-2026-05-26-143211.zip
  smudge.db          # consistent point-in-time snapshot
  images/            # everything under <data dir>/images/
    <uuid>.jpg
    <uuid>.png
    ...
```

Filename is `smudge-<ISO-8601-local-time>.zip`. Local time, not UTC — matches the writer's timezone (consistent with Phase 2's timezone discipline). Hyphens (not colons) so the name is filesystem-safe on every host.

**Format choice: zip, not tar.gz.** Two reasons: (1) consistency with Phase 8b's `.smg` (also a zip archive), so backup-related tooling speaks one format; (2) cross-platform portability — every supported host OS has native zip support, whereas tar.gz on older Windows is a frequent friction point.

### SQLite snapshot mechanism

Use SQLite's **`VACUUM INTO`** to produce a clean copy of the DB at a single point in time, rather than `cp`. `VACUUM INTO` is safe to run while the live Smudge process holds connections to the same DB — it's the SQLite-blessed online-backup path. Plain `cp` is dangerous because the WAL file can be out of sync with the main DB file at any given instant; restoring such a copy may surface partial transactions or appear corrupt.

The flow:

1. Resolve the data dir: `DB_PATH`'s dirname if set, otherwise the package-relative default (`packages/server/data/`). The DB filename is `smudge.db` (per `packages/server/src/db/knexfile.ts`).
2. Open a read-only connection to the live `<data-dir>/smudge.db`.
3. `VACUUM INTO '<data-dir>/.backup-staging.db'`.
4. Zip `<data-dir>/.backup-staging.db` (renamed inside the archive as `smudge.db`) + the live `<data-dir>/images/` directory into `backups/smudge-<timestamp>.zip`.
5. Delete the staging file.

Step 4 (image archiving) happens after step 3 (DB snapshot) finishes. The window between the DB snapshot and the image archive is small but non-zero — if the writer uploads an image during that window, the image file will be in the archive even though it's not referenced by the snapshotted DB. That is a *safe* inconsistency (an unreferenced image on restore is harmless; orphaned-image cleanup is already on the future-cleanup list per CLAUDE.md). The inverse (image referenced in DB but missing from archive) cannot happen because uploads write the image file *before* inserting the DB reference.

### Implementation surface

A small Node script at `packages/server/scripts/backup.ts`, invoked by the Makefile target. Lives in the server package because it uses `better-sqlite3` (already a server dep).

**Library choice for zipping is deferred to implementation.** Two viable options, both license-clean:

- **`jszip`** — already present in `packages/server`'s `devDependencies` (used by tests). Promoting it to `dependencies` is a single-line change; license is MIT-or-GPLv2-or-LGPL — verify in `node_modules/jszip/package.json` and document the MIT election in `docs/dependency-licenses.md`. In-memory; fine for typical manuscript sizes but watch image-heavy projects.
- **`archiver`** — streaming zip; better for projects with many large images. Would be a new direct dep (MIT — verify and document).

Avoid the `tar` npm package: not a current direct dep, and `.tar.gz` was rejected as the output format above.

```ts
// Sketch — not final; library choice deferred
import Database from "better-sqlite3";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

function resolveDataDir(): string {
  if (process.env.DB_PATH) return dirname(process.env.DB_PATH);
  // Default matches packages/server/src/db/knexfile.ts:11
  return resolve(__dirname, "../data");
}

async function main() {
  const dataDir = resolveDataDir();
  const stamp = isoStampLocal();
  const outFile = resolve("backups", `smudge-${stamp}.zip`);
  const staging = resolve(dataDir, ".backup-staging.db");

  await mkdir("backups", { recursive: true });
  await rm(staging, { force: true });

  const db = new Database(resolve(dataDir, "smudge.db"), { readonly: true });
  db.exec(`VACUUM INTO '${staging.replace(/'/g, "''")}'`);
  db.close();

  // ... write outFile zip containing { "smudge.db": <staging bytes>, "images/...": <image bytes> }
  // exact library API deferred to implementation; see notes above

  await rm(staging, { force: true });
  console.log(`Backup written: ${outFile}`);
}
```

The Makefile target:

```makefile
backup: ensure-native
	@node --experimental-strip-types packages/server/scripts/backup.ts
```

`ensure-native` is already a prerequisite of `make dev/test/cover/e2e`; the same prerequisite ensures the rebuild story is consistent.

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
3. Probe for a running Smudge dev/prod server on the live DB. The probe is a write attempt on a flock around the resolved DB file (`<data-dir>/smudge.db`, matching what `better-sqlite3` does). If the DB is in use, refuse: "Smudge is running — stop it and rerun." Do **not** attempt to stop it ourselves; that's the user's call.
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

Apply three defenses in order:

1. **Pre-extraction declared-size check.** After zip-slip validation but before extraction, sum every entry's declared uncompressed size. Refuse if:
   - the sum exceeds `--max-uncompressed=<N>` (default 2 GiB), or
   - the sum divided by the compressed archive size exceeds `--max-ratio=<N>` (default 10). Typical legitimate Smudge backups achieve 2-4× compression on text + image content, well below the cap.
2. **Streaming watchdog during extraction.** Track bytes written cumulatively. If extraction exceeds the declared total by more than minor slack, abort, clean up the partial extraction, and refuse. Catches archives that lie about their declared sizes.
3. **Output destination has enough free space.** Before starting extraction, check that the partition holding `<data-dir>` has at least `(declared total uncompressed) + 100 MiB` free. Refuse if not. Smaller projects don't trigger this; large image-heavy projects get a clean refusal instead of mid-extraction disk-full panic.

CLI flags `--max-uncompressed=N` and `--max-ratio=N` override the defaults. These mirror the env vars used by 8b's `POST /api/projects/import` (`SMUDGE_IMPORT_MAX_UNCOMPRESSED_BYTES`, `SMUDGE_IMPORT_MAX_COMPRESSION_RATIO`) so both code paths share the same defense.

---

## 3. `docs/backup.md` outline

Short — one page. Sections:

1. **What this is.** A manual backup recipe for the current shared-data layout.
2. **What it is not.** Not Phase 8b's `.smg`. Not per-project. Not automatic. Not offsite.
3. **How to back up.** `make backup`. Output goes to `backups/`. Safe to run while Smudge is up.
4. **How to restore.** `make restore BACKUP=…`. Smudge must be stopped. Confirms by typing the filename. Old data is moved aside, not deleted.
5. **Cadence.** Suggested: before every Smudge upgrade; weekly otherwise. Set a calendar reminder; this is not automated.
6. **Offsite.** Copy `backups/` to a separate disk, USB drive, or cloud sync folder. Smudge does not do this for you.
7. **When 8b ships.** This recipe will be either deprecated or kept as a "full-machine snapshot" complement to per-project `.smg`. Either way, your backups from this recipe remain readable by `make restore` against the Smudge version that wrote them.

---

## 4. Test plan

Three integration tests in `packages/server/src/__tests__/backup.test.ts`:

1. **Round-trip:** create a fixture DB with a project, two chapters, and two images; run `make backup`; wipe `data/`; run `make restore`; assert the DB contents and image bytes are bit-for-bit identical to the fixture.
2. **Live-DB safety:** open a writer connection to the live DB and run `make backup` while a transaction is open; assert the backup completes and contains the pre-transaction state (since `VACUUM INTO` snapshots a consistent point in time).
3. **Restore safety:** run `make restore` against an archive that is missing `smudge.db`; assert it refuses without touching the data dir. Run `make restore` with a typo in the confirmation prompt; assert it aborts without touching the data dir.
4. **Zip-slip defense:** construct three malicious archives — one with a `../../etc/passwd`-style entry, one with an absolute path entry (`/etc/passwd`), one with a `..` segment after normalization (`a/../../etc/passwd`). For each, run `make restore` against a temp data dir and assert: (a) the restore refuses with the offending entry name in the error message, (b) the temp data dir is unchanged, (c) no file is written outside the temp data dir (verify by snapshotting the surrounding tmpfs before and after).
5. **Decompression-bomb defense:** construct two malicious archives — one with declared uncompressed total exceeding `--max-uncompressed` (2 GiB by default; use a smaller threshold in tests), one with compression ratio exceeding `--max-ratio` (10 by default). For each, run `make restore` against a temp data dir and assert: (a) the restore refuses with a "decompression bomb" message, (b) no extraction was attempted, (c) the temp data dir is unchanged.

Test 2 uses better-sqlite3's transaction API to hold a write transaction open in a worker thread while the backup runs. Test 3 simulates the prompt with a piped-in confirmation string.

---

## 5. Risks and non-risks

**Risk: the WAL truncation timing.** `VACUUM INTO` doesn't touch the WAL of the source DB. If the writer has just made a change that's still in the WAL (not yet checkpointed), the snapshot will include it. This is correct behavior; the snapshot reflects the committed state including WAL entries.

**Non-risk: image-file consistency.** As noted in §1, the small window between DB snapshot and image-tar can leave an *extra* image in the tar that isn't referenced by the DB. This is harmless on restore.

**Non-risk: archive portability.** The archive is a standard zip, readable by any unzip tool on any host. Not Smudge-specific in any way. If `make restore` itself breaks in some future Smudge version, the user can still manually unzip and copy files into place.

**Risk: backup-dir bloat.** `make backup` never deletes old backups. If the writer runs it daily for a year, that's 365 archives. The recipe doc tells them to manage this themselves; we don't add an auto-purge.

---

## 6. What this design deliberately does NOT include

- **A schema-version marker in the tar.** The tar is "whatever the current Smudge data layout is." Restoring with a different Smudge version is on the user. (8b owns the cross-version story.)
- **Encryption.** Smudge is single-user, runs on the user's host, with no auth. Encrypting the backup tar adds key-management burden without a real threat-model gain.
- **Differential / incremental backups.** Manuscripts are small. A full archive every time is fine. If the writer ends up with 500MB of images, they can revisit.
- **A UI in the Smudge app.** This is CLI-only, deliberately. A UI implies discovery, scheduling, status — all of which belong to 8b.
