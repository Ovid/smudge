import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as imagesRepo from "../images/images.repository";
import { getDb } from "../db/connection";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ResolvedImage {
  id: string;
  data: Buffer;
  mimeType: string;
  altText: string;
  caption: string;
  source: string;
  license: string;
}

function getDataDir(): string {
  return process.env.DATA_DIR ?? path.join(__dirname, "../../data");
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
  };
  return map[mime] ?? "bin";
}

export async function resolveImage(imageId: string): Promise<ResolvedImage | null> {
  const db = getDb();
  const row = await imagesRepo.findById(db, imageId);
  if (!row) return null;

  const dataDir = getDataDir();
  const ext = mimeToExt(row.mime_type);
  const filePath = path.join(dataDir, "images", row.project_id, `${row.id}.${ext}`);

  try {
    const data = await fs.readFile(filePath);
    return {
      id: row.id,
      data,
      mimeType: row.mime_type,
      altText: row.alt_text,
      caption: row.caption,
      source: row.source,
      license: row.license,
    };
  } catch {
    return null;
  }
}

export async function resolveImagesInHtml(html: string): Promise<{
  html: string;
  images: Map<string, ResolvedImage>;
}> {
  const images = new Map<string, ResolvedImage>();
  const pattern = /src="\/api\/images\/([0-9a-f-]{36})"/gi;
  const matches = [...html.matchAll(pattern)];

  for (const match of matches) {
    const id = match[1];
    if (id && !images.has(id)) {
      const resolved = await resolveImage(id);
      if (resolved) images.set(id, resolved);
    }
  }

  let resolvedHtml = html;
  for (const [id, img] of images) {
    const dataUri = `data:${img.mimeType};base64,${img.data.toString("base64")}`;
    resolvedHtml = resolvedHtml.replace(
      new RegExp(`src="/api/images/${id}"`, "gi"),
      `src="${dataUri}"`,
    );
  }

  // Add figure/figcaption for images with captions
  for (const [, img] of images) {
    if (img.caption) {
      const escapedCaption = img.caption
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      resolvedHtml = resolvedHtml.replace(
        new RegExp(`(<img[^>]*src="data:${img.mimeType.replace("/", "\\/")}[^"]*"[^>]*>)`, "g"),
        `<figure>$1<figcaption>${escapedCaption}</figcaption></figure>`,
      );
    }
  }

  return { html: resolvedHtml, images };
}
