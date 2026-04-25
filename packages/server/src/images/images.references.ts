import { MAX_TIPTAP_DEPTH } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { logger } from "../logger";
import { UUID_PATTERN } from "./images.paths";
import type { ImageRow } from "./images.types";

// Compiled once at module load rather than per image node. The regex has
// no `g` flag so `.exec` has no per-call state to worry about; reusing the
// compiled instance avoids measurable GC pressure during project-wide
// replace-all operations that walk many image nodes in succession.
//
// Anchored at the start so a pasted URL that happens to contain the
// `/api/images/<uuid>` substring inside a query fragment (e.g.
// `https://evil.example/?ref=/api/images/<uuid>/x`) cannot inflate the
// refcount of an image the user did not intentionally reference. A
// legitimate <img> src is either absolute (http(s)://host/api/images/<uuid>)
// or root-relative (/api/images/<uuid>) — accept both via a host-prefix
// alternation, and require that the UUID be immediately followed by a path
// terminator so a UUID inside a query-string can't match.
//
// S1 (review 2026-04-25): wider than the client sanitizer's
// ALLOWED_URI_REGEXP in `packages/client/src/sanitizer.ts`, which
// accepts only the relative form. The asymmetry is intentional — the
// reference scanner walks user-pasted content (which can contain
// either form) and must increment refcounts conservatively, while the
// sanitizer enforces a fail-closed XSS posture against the rendered
// DOM. If a writer ever starts emitting absolute same-origin URLs,
// the resulting "broken `<img>` survives delete-block" symptom is the
// intended signal to revisit both regexes together.
const IMAGE_SRC_RE = new RegExp(
  `^(?:https?://[^/]+)?/api/images/(${UUID_PATTERN})(?:[/?#]|$)`,
  "i",
);

/**
 * Walks TipTap JSON content tree and extracts image UUIDs from
 * nodes with `type: "image"` whose `attrs.src` matches `/api/images/{uuid}`.
 * Returns deduplicated, lowercased UUIDs.
 */
export function extractImageIds(content: Record<string, unknown> | null): string[] {
  if (!content) return [];
  const ids = new Set<string>();

  // Depth cap matches collectLeafBlocks / extractText / canonicalize. Runs
  // on both old (DB-read, never revalidated) and new content inside
  // applyImageRefDiff — a legacy row written before the current write-side
  // cap could otherwise stack-overflow the walker.
  function walk(node: Record<string, unknown>, depth: number) {
    if (depth > MAX_TIPTAP_DEPTH) return;
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
          walk(child as Record<string, unknown>, depth + 1);
        }
      }
    }
  }

  walk(content, 0);
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
    findImagesByIds(ids: string[]): Promise<ImageRow[]>;
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
      // Old content corrupt: treat old image set as empty. This only
      // affects *additions* (images newly referenced), which we're happy
      // to over-count rather than under-count.
    }
  }
  let newContent: Record<string, unknown> | null = null;
  if (newContentJson) {
    try {
      newContent = JSON.parse(newContentJson);
    } catch {
      // New content corrupt: abort. If we proceeded, extractImageIds(null)
      // would return [] and every old id would be classified as removed —
      // silently decrementing every referenced image toward purge. Ref
      // counts must stay conservative, not optimistic. Callers validate
      // content before writing, so this path is latent today but the
      // shared surface must be safe for future writers.
      logger.warn(
        { project_id: projectId },
        "applyImageRefDiff: newContent JSON.parse failed; aborting diff to avoid mass decrement",
      );
      return;
    }
  }

  const oldIds = extractImageIds(oldContent);
  const newIds = extractImageIds(newContent);
  const diff = diffImageReferences(oldIds, newIds);

  // Batch-fetch every image we need in a single whereIn query rather than
  // issuing N serial SELECTs. This matters when a chapter references many
  // images and applyImageRefDiff is called once per affected chapter inside
  // a project-wide replace-all transaction.
  const needed = [...new Set([...diff.added, ...diff.removed])];
  const rows = await txStore.findImagesByIds(needed);
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const id of diff.added) {
    const image = byId.get(id);
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
    const image = byId.get(id);
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
