import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ImageRow } from "@smudge/shared";
import { mimeToExt, getImagePath, IMAGE_SRC_REGEX } from "../images/images.paths";
import { escapeHtml } from "./html-escape";

/**
 * Narrow data dependency for image resolution: the single store method these
 * renderers need. Injected by the caller (the export service) rather than
 * reached via the global `getProjectStore()` singleton, so the leaf renderers
 * declare their data dependency at the boundary and are decoupled from global
 * init order (F-12). `ProjectStore` satisfies this structurally.
 */
export interface ImageSource {
  findImageById(id: string): Promise<ImageRow | null>;
}

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

export async function resolveImage(
  imageId: string,
  source: ImageSource,
): Promise<ResolvedImage | null> {
  const row = await source.findImageById(imageId);
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

// ---------------------------------------------------------------------------
// Shared image-resolution pipeline
// ---------------------------------------------------------------------------

interface ImageResolution {
  src: string;
  image: ResolvedImage;
}

/**
 * Resolve /api/images/{uuid} URLs in HTML. The `resolve` callback determines
 * how each image is resolved — either as a base64 data URI (for HTML/MD/text
 * exports) or a file:// URL (for EPUB).
 *
 * Pipeline:
 * 1. Scan for image IDs via IMAGE_SRC_REGEX
 * 2. Resolve each unique ID via the callback
 * 3. Add figure/figcaption for images with captions
 * 4. Strip any unresolved /api/images/ references
 */
async function resolveImageSrcs(
  html: string,
  resolve: (id: string) => Promise<ImageResolution | null>,
): Promise<{ html: string; images: Map<string, ResolvedImage> }> {
  IMAGE_SRC_REGEX.lastIndex = 0;
  const matches = [...html.matchAll(IMAGE_SRC_REGEX)];
  const uniqueIds = [...new Set(matches.map((m) => m[1]).filter(Boolean))] as string[];

  const images = new Map<string, ResolvedImage>();
  let resolvedHtml = html;

  for (const id of uniqueIds) {
    const result = await resolve(id);
    if (result) {
      images.set(id, result.image);
      resolvedHtml = resolvedHtml.replace(
        new RegExp(`src="/api/images/${id}"`, "gi"),
        `data-image-id="${id}" src="${result.src}"`,
      );
    }
  }

  // Add figure/figcaption for images with captions or attribution
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
  resolvedHtml = resolvedHtml.replace(/<img[^>]*src="\/api\/images\/[^"]*"[^>]*>/gi, "");

  return { html: resolvedHtml, images };
}

// ---------------------------------------------------------------------------
// Format-specific resolvers
// ---------------------------------------------------------------------------

/**
 * Resolve images as base64 data URIs — used for HTML, Markdown, and plain text exports.
 */
export async function resolveImagesInHtml(
  html: string,
  source: ImageSource,
): Promise<{
  html: string;
  images: Map<string, ResolvedImage>;
}> {
  return resolveImageSrcs(html, async (id) => {
    const resolved = await resolveImage(id, source);
    if (!resolved) return null;
    const dataUri = `data:${resolved.mimeType};base64,${resolved.data.toString("base64")}`;
    return { src: dataUri, image: resolved };
  });
}

/**
 * Resolve images as file:// URLs — used for EPUB exports.
 * epub-gen-memory supports file:// URLs natively.
 */
export async function resolveImagesForEpub(html: string, source: ImageSource): Promise<string> {
  const { html: resolvedHtml } = await resolveImageSrcs(html, async (id) => {
    const row = await source.findImageById(id);
    if (!row) return null;
    const ext = mimeToExt(row.mime_type);
    if (!ext) return null;
    const filePath = getImagePath(row.project_id, row.id, ext);
    try {
      await fs.access(filePath);
    } catch {
      return null;
    }
    const fileUrl = pathToFileURL(filePath).href;
    return {
      src: fileUrl,
      image: {
        id: row.id,
        filename: row.filename,
        data: Buffer.alloc(0), // Not used for EPUB — file:// URLs are used instead
        mimeType: row.mime_type,
        altText: row.alt_text,
        caption: row.caption,
        source: row.source,
        license: row.license,
      },
    };
  });
  return resolvedHtml;
}
