import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ImageRow } from "@smudge/shared";
import { mimeToExt, getImagePath, IMAGE_SRC_REGEX } from "../images/images.paths";
import { logger } from "../logger";
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

/**
 * Shared by both resolvers below so an operator grepping for this line finds
 * every export path that dropped an image, and so the two cannot drift apart.
 */
const MISSING_IMAGE_FILE_MSG = "Export image file missing on disk; omitting it from the export";

/**
 * Wrap an image lookup so it only ever yields images owned by `projectId`.
 *
 * I1 (dedup review 2026-07-26): the ownership rule — "an image id found in
 * chapter content is honoured only if `image.project_id` matches the project
 * being operated on" — was applied by `applyImageRefDiff` (warn + skip the
 * refcount update) and by the EPUB cover path (`row.project_id === project.id`),
 * but NOT on the export resolution path, which had no project parameter at all.
 * A stale paste of `/api/images/<other-project-uuid>` between two of the
 * writer's own projects — an entirely ordinary relative src, no hostile input
 * needed — therefore embedded the other project's bytes into this project's
 * export, in all five formats.
 *
 * The check lives HERE, at the injected boundary, rather than as a `projectId`
 * argument threaded through `resolveImage` / `resolveImagesInHtml` /
 * `resolveImagesForEpub` / the DOCX build state. `ImageSource` is already the
 * one narrow seam every renderer resolves images through (F-12), so scoping it
 * once at construction means a renderer cannot omit the check — including a
 * renderer that does not exist yet. The EPUB cover's own `project_id` compare is
 * left in place: it is now redundant, but it is the documented second layer and
 * costs nothing.
 */
export function projectScopedImageSource(source: ImageSource, projectId: string): ImageSource {
  return {
    async findImageById(id: string): Promise<ImageRow | null> {
      const row = await source.findImageById(id);
      return row && row.project_id === projectId ? row : null;
    },
  };
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
  // I1 (agentic-review 2026-08-05): canonicalize HERE, not only in
  // resolveImageSrcs — DOCX is the documented exception that never goes through
  // that pipeline (it walks TipTap JSON straight into Word paragraphs), so
  // OOSS1's fix reached four export formats and not the fifth. Both allowlist
  // regexes carry the "i" flag while `findImageById` ends at `where({ id })`
  // under SQLite's BINARY collation, and ids are minted lowercase
  // (randomUUID) — so lowercase IS the canonical spelling. At the lookup, every
  // renderer inherits it, including one that does not exist yet.
  const row = await source.findImageById(imageId.toLowerCase());
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
  } catch (err: unknown) {
    // The DB row outlived its bytes. The image silently disappears from the
    // writer's manuscript and the export still reports success, so this is the
    // only signal that it happened — and it is operator-actionable (restore the
    // file from a backup). Degrading to null is correct; degrading in silence
    // is not.
    //
    // ponytail: log-only — the WRITER is still never told. resolveImageSrcs
    // strips the unresolved <img> outright, so the exported file carries no
    // trace and the export reports success. Left here deliberately: checked
    // 2026-08-16 against the live data dir and the manuscript uses zero images
    // (no rows, no files, no /api/images/ refs), so a UI for this would guard a
    // path nothing reaches. Upgrade when a chapter actually carries an image —
    // the client fetches the export as a blob and only writes it to disk by
    // synthesising a click (ExportDialog handleExport), so the missing-image
    // list can ride on the export response and the download can be held until
    // the writer confirms. That needs no new endpoint; it was priced as if it
    // did.
    logger.warn({ err, image_id: row.id, project_id: row.project_id }, MISSING_IMAGE_FILE_MSG);
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
  // OOSS1 (agentic-review 2026-08-04): canonicalize BEFORE resolving, not just
  // when keying the maps below. `resolve(id)` ends at `where({ id })` under
  // SQLite's BINARY collation, so an uppercase-only reference resolved to null
  // and was then deleted outright by the unresolved-image catch-all — the image
  // gone from every HTML-route export with no warning, after two i-flagged
  // regexes had accepted it. Ids are minted lowercase (randomUUID), so lowercase
  // IS the canonical spelling.
  const uniqueIds = [
    ...new Set(matches.map((m) => m[1]?.toLowerCase()).filter(Boolean)),
  ] as string[];

  const images = new Map<string, ResolvedImage>();
  const srcById = new Map<string, string>();

  for (const id of uniqueIds) {
    const result = await resolve(id);
    if (result) {
      // S6: keyed by the CANONICAL lowercase id, matching srcById below and the
      // `data-image-id` the rewrite emits. Keying by the id as matched let two
      // differently-cased references to one image become two map entries whose
      // "g"-only caption regexes each missed the other's tag.
      images.set(id.toLowerCase(), result.image);
      srcById.set(id.toLowerCase(), result.src);
    }
  }

  // C1 (dedup review 2026-07-26): substitute in ONE pass driven by the same
  // IMAGE_SRC_REGEX that found the ids, rather than rebuilding a second
  // `src="/api/images/${id}"` pattern per image. The rebuilt pattern was a
  // third encoding of "is this src an image reference?" and it had already
  // drifted from this one — it could not match a src carrying a `?query`
  // suffix, so an id found by the scanner still failed to substitute and the
  // catch-all below then dropped the whole tag. One regex, no drift surface.
  // An unresolved src is left untouched here on purpose: the catch-all is what
  // strips it, so the fail-closed behaviour is unchanged.
  let resolvedHtml = html.replace(IMAGE_SRC_REGEX, (whole, id: string) => {
    const src = srcById.get(id.toLowerCase());
    // S6: emit the canonical lowercase id, so the caption pass below (and the
    // plaintext renderer's own `data-image-id` matcher) sees one spelling.
    return src ? `data-image-id="${id.toLowerCase()}" src="${src}"` : whole;
  });

  // Add figure/figcaption for images with captions or attribution
  for (const [id, img] of images) {
    const fullCaption = buildCaptionText(img);
    if (fullCaption) {
      // OOSI1: a FUNCTION replacer, matching the sibling rewrite above. As a
      // string, every `$` token in the caption is interpolated by the engine —
      // and escapeHtml manufactures the hazard rather than closing it, since it
      // rewrites `&` to `&amp;` and leaves the `$&` match token intact. `$\``
      // splices the whole preceding rendered document into a figcaption meant
      // to hold escaped text; ordinary prose ("Sold for US$1,200") is enough to
      // trigger it. Captions are user-settable via PATCH /api/images/:id.
      const caption = escapeHtml(fullCaption);
      resolvedHtml = resolvedHtml.replace(
        new RegExp(`(<img[^>]*data-image-id="${id}"[^>]*>)`, "g"),
        (tag) => `<figure>${tag}<figcaption>${caption}</figcaption></figure>`,
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
    } catch (err: unknown) {
      // Same anomaly as resolveImage above, on the EPUB path.
      logger.warn({ err, image_id: row.id, project_id: row.project_id }, MISSING_IMAGE_FILE_MSG);
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
