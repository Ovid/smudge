import { mkdir, writeFile, readFile, unlink, rename, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Filesystem I/O seam for image blobs (F-13).
 *
 * Every other domain reaches persistence through the `ProjectStore`
 * abstraction; image binaries are the deliberate exception (opaque blobs, not
 * rows — see F-13's "defensible asymmetry"). Centralising the raw `fs` calls
 * here gives that one I/O surface a single named, mockable boundary, so
 * `images.service`'s logic can be unit-tested without touching the disk and
 * the orphan-image reaper (F-14) shares one delete path.
 */

/** Write an image blob, creating its parent directory if needed.
 *
 * Atomic publish (O1): write to a per-process temp sibling then `rename` it into
 * place. A concurrent reader — notably a live `make backup` — then sees either
 * the old complete file or none, never a torn/half-written copy. The temp name
 * carries the pid so two same-instant writers can't share it, and its `.tmp`
 * extension is outside the orphan reaper's `<uuid>.<ext>` pattern, so it is never
 * reaped as an image. On failure the temp is removed so a mid-write error can't
 * strand an orphan `.tmp` (each upload uses a fresh uuid, so it would otherwise
 * never be overwritten — the same leak class fixed for the backup publish). */
export async function writeImageFile(filePath: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, filePath);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

/** Read an image blob from disk. Rejects (ENOENT) when the file is missing. */
export async function readImageFile(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}

/** Delete an image blob from disk. Rejects (ENOENT) when the file is missing. */
export async function deleteImageFile(filePath: string): Promise<void> {
  await unlink(filePath);
}
