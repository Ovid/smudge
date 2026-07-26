import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Single owner of "where Smudge persists data" (F-5). Both the image
// store (DATA_DIR/images/...) and the SQLite database (smudge.db) derive
// their locations from here, so the two can no longer point at unrelated
// directories by default. The previous arrangement duplicated the
// `../../data` default across images.paths.ts, db/purge.ts, and
// db/knexfile.ts, and let DATA_DIR and DB_PATH default independently.

/** Default directory under which images and the SQLite DB live. */
export function getDataDir(): string {
  return process.env.DATA_DIR ?? path.join(__dirname, "../../data");
}

/**
 * Absolute path to the SQLite database file. Defaults to `smudge.db`
 * directly inside {@link getDataDir}, so an explicit DATA_DIR moves the
 * database alongside the images. An explicit DB_PATH still wins, letting
 * operators place the DB elsewhere on purpose.
 */
export function getDbPath(): string {
  return process.env.DB_PATH ?? path.join(getDataDir(), "smudge.db");
}

/**
 * Directory holding the per-project image store: `<data-dir>/images`.
 * Single owner of the `images` subdir name (S-F9) — previously hardcoded in
 * images.paths, images.reaper, db/purge, and backup-core. Pass an explicit
 * `dataDir` to override the env default (backup/restore, purge, and the reaper
 * thread their own data dir through and must not read env); omit it to derive
 * from {@link getDataDir}.
 */
export function getImagesDir(dataDir?: string): string {
  return path.join(dataDir ?? getDataDir(), "images");
}

/**
 * Directory holding backup archives: `<cwd>/backups`.
 *
 * S7 (dedup review 2026-07-26): the one persistence location that never joined
 * this owner — `join(process.cwd(), "backups")` was written out in both
 * scripts/backup.ts and scripts/auto-backup.ts. If those two ever disagreed,
 * `make backup` and `make dev`'s auto-backup would write to different places
 * and rotateAutoBackups would prune only the directory it was handed, silently
 * letting the other grow forever. restore.ts correctly needs no copy: the
 * operator names the archive.
 *
 * Deliberately relative to `process.cwd()`, not to getDataDir(): backups are an
 * operator artifact of a source checkout (see docs/backup.md), and writing them
 * inside the data directory would fold each archive into the next one.
 */
export function getBackupsDir(): string {
  return path.join(process.cwd(), "backups");
}
