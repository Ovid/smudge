import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ALLOWED_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

export function mimeToExt(mime: string): string | null {
  return MIME_TO_EXT[mime] ?? null;
}

export function getDataDir(): string {
  return process.env.DATA_DIR ?? path.join(__dirname, "../../data");
}

export function getImagePath(projectId: string, imageId: string, ext: string): string {
  return path.join(getDataDir(), "images", projectId, `${imageId}.${ext}`);
}
