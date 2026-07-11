import fs from "node:fs/promises";
import path from "node:path";
import type { Knex } from "knex";
import { UUID_PATTERN, IMAGE_EXT_PATTERN } from "./images.paths";
import { getImagesDir } from "../config/paths";
import { deleteImageFile } from "./images.fs";
import { logger } from "../logger";

// S6: only ever consider files whose extension is one this app's producer
// actually writes (`jpg|png|gif|webp`, derived from MIME_TO_EXT). A loose
// `[a-z0-9]+` would also match operator backups (`<uuid>.bak`/`.tmp`/`.orig`)
// that happen to share a uuid prefix — the reaper must never delete a file
// it didn't write.
const IMAGE_FILE_RE = new RegExp(`^(${UUID_PATTERN})\\.(?:${IMAGE_EXT_PATTERN})$`, "i");

/**
 * Startup reaper for orphaned image files (F-14).
 *
 * Image filesystem writes/deletes cannot join the SQLite transaction, so a
 * crash between an upload's `INSERT` failing (file already written) or between
 * a delete's commit and its `unlink` can strand a blob on disk with no DB row.
 * Unlike soft-deleted rows — which `purgeOldTrash` reaps on startup — image
 * files previously had no reaper, so orphans accumulated forever.
 *
 * This runs once at startup (mirroring `purgeOldTrash`), when no upload is in
 * flight, so it cannot race a mid-upload file whose row has not yet committed.
 * It loads the set of known image ids, walks `DATA_DIR/images/<project>/`, and
 * deletes only image-shaped files (`<uuid>.<ext>`) whose id has no DB row.
 * Best-effort: per-file failures are logged and skipped, never thrown.
 *
 * **Single-process assumption (S2).** Smudge is documented as a single-process
 * single-user app (CLAUDE.md). Running two server processes against the same
 * `DATA_DIR` is unsupported and would expose a race: this reaper snapshots
 * the known-id set with a `select id from images`, then walks the tree, so a
 * sibling process's freshly-uploaded file (committed AFTER the snapshot but
 * BEFORE the walk) would be deleted as an "orphan." There is no in-process
 * upload concurrency at startup — the reaper runs before `app.listen` binds.
 *
 * @returns the number of orphan files removed.
 */
export async function reapOrphanImages(db: Knex, dataDir?: string): Promise<number> {
  const imagesRoot = getImagesDir(dataDir);

  let projectDirs: string[];
  try {
    projectDirs = await fs.readdir(imagesRoot);
  } catch (err) {
    // S4: only swallow ENOENT (legitimate fresh install — images directory
    // has not been created yet). Any other code (EACCES, EIO, ENOTDIR, …)
    // is an operator-actionable signal — surface it as a warn rather than
    // confusing the operator later with a "upload fails for no reason" 500.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
    logger.warn({ err, imagesRoot }, "Failed to read images directory; skipping reaper");
    return 0;
  }

  const rows = await db("images").select("id");
  const known = new Set(rows.map((r: { id: string }) => r.id.toLowerCase()));

  let reaped = 0;
  for (const projectDir of projectDirs) {
    const dirPath = path.join(imagesRoot, projectDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (err) {
      // S4: a per-project directory disappearing between the outer readdir
      // and this call is benign (ENOENT) — race with a manual cleanup or a
      // sibling process. Other codes are operator-actionable.
      if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") {
        logger.warn({ err, projectDir }, "Failed to read project image directory; skipping");
      }
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = IMAGE_FILE_RE.exec(entry.name);
      const id = match?.[1];
      if (!id) continue; // not an image blob we wrote — leave it alone
      if (known.has(id.toLowerCase())) continue; // has a DB row — keep
      try {
        await deleteImageFile(path.join(dirPath, entry.name));
        reaped++;
      } catch (err) {
        logger.warn({ err, file: entry.name, projectDir }, "Failed to reap orphan image file");
      }
    }
  }
  return reaped;
}
