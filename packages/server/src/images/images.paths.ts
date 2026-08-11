import path from "node:path";
import { getImagesDir } from "../config/paths";

// getDataDir is owned by config/paths (F-5: single data-directory owner)
// and re-exported here so existing `../images/images.paths` importers and
// the image path helpers below keep a stable surface.
export { getDataDir } from "../config/paths";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/**
 * The MIME types an upload may declare — the gate.
 *
 * S3 (dedup review 2026-07-26): derived from MIME_TO_EXT rather than re-typed.
 * The two lists sat nine lines apart and had to agree, and this file already
 * derives its third consumer (IMAGE_EXT_PATTERN) from the same map for exactly
 * this reason. Drift failed closed but MISDIAGNOSED: a MIME added here alone
 * reached validateMagicBytes' `default: return false` and was reported as
 * "File content does not match declared type" — a content error for a config
 * gap. No test bound the two.
 */
export const ALLOWED_MIMES = new Set(Object.keys(MIME_TO_EXT));

/** Strict UUID v4 capture pattern — used by reference counting and export resolvers. */
export const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Regex matching /api/images/{uuid} src attributes — case-insensitive, global.
 *
 * C1 (dedup review 2026-07-26): the optional `?query` / `#fragment` tail is
 * load-bearing, not defensive. This scanner runs immediately downstream of
 * ALLOWED_IMAGE_SRC (export.renderers.ts), which accepts that tail — so when
 * this pattern demanded the closing quote right after the uuid, a suffixed src
 * was kept by the allowlist, missed here, and then deleted outright from the
 * export by the unresolved-image catch-all in image-resolver.ts. The two are
 * pinned together by the third column of
 * `shared/src/__tests__/image-src-allowlist-parity.test.ts`; widening either
 * without the other turns it red.
 */
export const IMAGE_SRC_REGEX = new RegExp(
  `src="/api/images/(${UUID_PATTERN})(?:[?#][^"]*)?"`,
  "gi",
);

export function mimeToExt(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null;
}

/**
 * Alternation of every extension the image producer writes
 * (e.g. `jpg|png|gif|webp`). Derived directly from `MIME_TO_EXT` so
 * the reaper and any other "what's a producer-written image file?"
 * consumer stays in lockstep with the producer — adding a new accepted
 * MIME type can never silently leave the reaper unable to recognise
 * the new extension, and the reaper can never widen to extensions the
 * producer doesn't write (e.g. `<uuid>.bak`).
 */
export const IMAGE_EXT_PATTERN = Object.values(MIME_TO_EXT).join("|");

/**
 * Validate that the buffer's magic bytes match the claimed MIME type.
 * Returns true if the magic bytes are consistent, false if they are not.
 */
export function validateMagicBytes(buffer: Buffer, mime: string): boolean {
  if (buffer.length < 12) return false;
  switch (mime) {
    case "image/jpeg":
      return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    case "image/png":
      return buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
    case "image/gif":
      return buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38;
    case "image/webp":
      // RIFF....WEBP
      return (
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
      );
    default:
      return false;
  }
}

export function getImagePath(projectId: string, imageId: string, ext: string): string {
  return path.join(getImagesDir(), projectId, `${imageId}.${ext}`);
}
