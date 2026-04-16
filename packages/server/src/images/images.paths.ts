import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/** Strict UUID v4 capture pattern — used by reference counting and export resolvers. */
export const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Regex matching /api/images/{uuid} src attributes — case-insensitive, global. */
export const IMAGE_SRC_REGEX = new RegExp(`src="/api/images/(${UUID_PATTERN})"`, "gi");

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function mimeToExt(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null;
}

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

export function getDataDir(): string {
  return process.env.DATA_DIR ?? path.join(__dirname, "../../data");
}

export function getImagePath(projectId: string, imageId: string, ext: string): string {
  return path.join(getDataDir(), "images", projectId, `${imageId}.${ext}`);
}
