import { getProjectStore } from "../stores/project-store.injectable";
import { UUID_PATTERN } from "./images.paths";

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
        const match = new RegExp(`/api/images/(${UUID_PATTERN})`, "i").exec(attrs.src);
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
