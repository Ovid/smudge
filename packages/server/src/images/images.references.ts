import { getProjectStore } from "../stores/project-store.injectable";
import { logger } from "../logger";
import { UUID_PATTERN } from "./images.paths";
import type { ImageRow } from "./images.types";

// Compiled once at module load rather than per image node. The regex has
// no `g` flag so `.exec` has no per-call state to worry about; reusing the
// compiled instance avoids measurable GC pressure during project-wide
// replace-all operations that walk many image nodes in succession.
const IMAGE_SRC_RE = new RegExp(`/api/images/(${UUID_PATTERN})`, "i");

/**
 * Walks TipTap JSON content tree and extracts image UUIDs from
 * nodes with `type: "image"` whose `attrs.src` matches `/api/images/{uuid}`.
 * Returns deduplicated, lowercased UUIDs.
 */
export function extractImageIds(content: Record<string, unknown> | null): string[] {
  if (!content) return [];
  const ids = new Set<string>();

  function walk(node: Record<string, unknown>) {
    if (node.type === "image" && typeof node.attrs === "object" && node.attrs !== null) {
      const attrs = node.attrs as Record<string, unknown>;
      if (typeof attrs.src === "string") {
        const match = IMAGE_SRC_RE.exec(attrs.src);
        if (match?.[1]) ids.add(match[1].toLowerCase());
      }
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        if (typeof child === "object" && child !== null) {
          walk(child as Record<string, unknown>);
        }
      }
    }
  }

  walk(content);
  return [...ids];
}

/**
 * Compares two arrays of image IDs and returns which were added and removed.
 */
export function diffImageReferences(
  oldIds: string[],
  newIds: string[],
): { added: string[]; removed: string[] } {
  const oldSet = new Set(oldIds);
  const newSet = new Set(newIds);

  const added = newIds.filter((id) => !oldSet.has(id));
  const removed = oldIds.filter((id) => !newSet.has(id));

  return { added, removed };
}

/**
 * Parses old and new content JSON strings, computes the image reference diff,
 * and applies increment/decrement to the store. Shared by chapter update and
 * snapshot restore to avoid duplicating the parse → extract → diff → apply pattern.
 */
export async function applyImageRefDiff(
  txStore: {
    incrementImageReferenceCount(id: string, delta: number): Promise<void>;
    findImageById(id: string): Promise<ImageRow | null>;
  },
  oldContentJson: string | null,
  newContentJson: string | null,
  projectId: string,
): Promise<void> {
  let oldContent: Record<string, unknown> | null = null;
  if (oldContentJson) {
    try {
      oldContent = JSON.parse(oldContentJson);
    } catch {
      /* corrupt */
    }
  }
  let newContent: Record<string, unknown> | null = null;
  if (newContentJson) {
    try {
      newContent = JSON.parse(newContentJson);
    } catch {
      /* corrupt */
    }
  }

  const oldIds = extractImageIds(oldContent);
  const newIds = extractImageIds(newContent);
  const diff = diffImageReferences(oldIds, newIds);

  for (const id of diff.added) {
    const image = await txStore.findImageById(id);
    // An image referenced in restored/replaced content may have been purged
    // since the snapshot was taken, or the chapter may reference an image
    // that belongs to a different project (stale URL, manual paste). Warn
    // but do not fail; skip the ref-count update so cross-project image
    // state cannot be touched via a crafted content payload.
    if (!image || image.project_id !== projectId) {
      logger.warn(
        { image_id: id, project_id: projectId, found_in_project: image?.project_id ?? null },
        "Referenced image missing or in different project; skipping reference-count update",
      );
      continue;
    }
    await txStore.incrementImageReferenceCount(id, 1);
  }
  for (const id of diff.removed) {
    // Decrement only if the image actually belongs to this project — same
    // cross-project guard as the add path.
    const image = await txStore.findImageById(id);
    if (!image || image.project_id !== projectId) {
      continue;
    }
    await txStore.incrementImageReferenceCount(id, -1);
  }
}

/**
 * Scans all non-deleted chapters in a project for references to a specific image.
 * Pure read — does NOT update reference_count in the database.
 */
export async function scanImageReferences(
  imageId: string,
  projectId: string,
): Promise<Array<{ id: string; title: string }>> {
  const store = getProjectStore();
  const chapters = await store.listChapterContentByProject(projectId);

  const referencingChapters: Array<{ id: string; title: string }> = [];

  for (const ch of chapters) {
    if (ch.content) {
      try {
        const parsed = JSON.parse(ch.content) as Record<string, unknown>;
        const ids = extractImageIds(parsed);
        if (ids.includes(imageId.toLowerCase())) {
          referencingChapters.push({ id: ch.id, title: ch.title });
        }
      } catch {
        // Corrupt JSON — skip this chapter
      }
    }
  }

  return referencingChapters;
}
