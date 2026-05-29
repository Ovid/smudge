import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
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

/** Write an image blob, creating its parent directory if needed. */
export async function writeImageFile(filePath: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}

/** Read an image blob from disk. Rejects (ENOENT) when the file is missing. */
export async function readImageFile(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}

/** Delete an image blob from disk. Rejects (ENOENT) when the file is missing. */
export async function deleteImageFile(filePath: string): Promise<void> {
  await unlink(filePath);
}
