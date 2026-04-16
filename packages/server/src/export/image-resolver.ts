import fs from "node:fs/promises";
import { getProjectStore } from "../stores/project-store.injectable";
import { mimeToExt, getImagePath } from "../images/images.paths";
import { escapeHtml } from "./export.renderers";

export interface ResolvedImage {
  id: string;
  filename: string;
  data: Buffer;
  mimeType: string;
  altText: string;
  caption: string;
  source: string;
  license: string;
}

export async function resolveImage(imageId: string): Promise<ResolvedImage | null> {
  const store = getProjectStore();
  const row = await store.findImageById(imageId);
  if (!row) return null;

  const ext = mimeToExt(row.mime_type);
  if (!ext) return null;
  const filePath = getImagePath(row.project_id, row.id, ext);

  try {
    const data = await fs.readFile(filePath);
    return {
      id: row.id,
      filename: row.filename,
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

/**
 * Build the full caption string with source and license appended when present.
 * Format: "Caption (source, license)" or "Caption (source)" etc.
 */
export function buildCaptionText(img: ResolvedImage): string {
  let caption = img.caption;
  const parts: string[] = [];
  if (img.source) parts.push(img.source);
  if (img.license) parts.push(img.license);
  if (parts.length > 0) {
    const attribution = parts.join(", ");
    caption = caption ? `${caption} (${attribution})` : `(${attribution})`;
  }
  return caption;
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
    // Tag each <img> with data-image-id so the figcaption pass can match by unique ID
    resolvedHtml = resolvedHtml.replace(
      new RegExp(`src="/api/images/${id}"`, "gi"),
      `data-image-id="${id}" src="${dataUri}"`,
    );
  }

  // Add figure/figcaption for images with captions or attribution, matched by unique image ID
  for (const [id, img] of images) {
    const fullCaption = buildCaptionText(img);
    if (fullCaption) {
      resolvedHtml = resolvedHtml.replace(
        new RegExp(`(<img[^>]*data-image-id="${id}"[^>]*>)`, "g"),
        `<figure>$1<figcaption>${escapeHtml(fullCaption)}</figcaption></figure>`,
      );
    }
  }

  // Remove any remaining /api/images/ references that couldn't be resolved
  // (e.g. image file missing from disk) to avoid leaking internal API URLs
  // in exported documents.
  resolvedHtml = resolvedHtml.replace(/<img[^>]*src="\/api\/images\/[^"]*"[^>]*>/gi, "");

  return { html: resolvedHtml, images };
}
