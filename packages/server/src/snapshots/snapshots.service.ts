import { v4 as uuidv4 } from "uuid";
import { countWords, validateTipTapDepth } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { getVelocityService } from "../velocity/velocity.injectable";
import { logger } from "../logger";
import { applyImageRefDiff } from "../images/images.references";
import { enrichChapterWithLabel } from "../chapters/chapters.types";
import { canonicalContentHash } from "./content-hash";
import { MAX_CHAPTER_CONTENT_BYTES } from "../search/search.service";
import type { SnapshotRow, SnapshotListItem } from "./snapshots.types";

export async function createSnapshot(
  chapterId: string,
  label?: string | null,
  isAuto = false,
): Promise<SnapshotRow | null | "duplicate"> {
  const store = getProjectStore();
  // Wrap the chapter read, dedup check, and insert in a single transaction.
  // Without this, two concurrent POSTs could both pass the dedup check and
  // produce duplicate manual snapshots.
  return store.transaction(async (txStore) => {
    // findChapterByIdRaw filters deleted_at IS NULL the same as findChapterById;
    // it just returns raw JSON content (needed for hashing) instead of parsed.
    const chapter = await txStore.findChapterByIdRaw(chapterId);
    if (!chapter) return null;

    const content = chapter.content ?? JSON.stringify({ type: "doc", content: [] });

    // Dedup guard: skip if content matches latest snapshot (manual snapshots only).
    if (!isAuto) {
      const contentHash = canonicalContentHash(content);
      const latestHash = await txStore.getLatestSnapshotContentHash(chapterId);
      if (latestHash === contentHash) return "duplicate";
    }

    const now = new Date().toISOString();
    const snapshot = await txStore.insertSnapshot({
      id: uuidv4(),
      chapter_id: chapterId,
      label: label?.trim() || null,
      content,
      word_count: chapter.word_count,
      is_auto: isAuto,
      created_at: now,
    });

    return snapshot;
  });
}

export async function listSnapshots(chapterId: string): Promise<SnapshotListItem[] | null> {
  const store = getProjectStore();
  const chapter = await store.findChapterById(chapterId);
  if (!chapter) return null;
  return store.listSnapshotsByChapter(chapterId);
}

export async function getSnapshot(id: string): Promise<SnapshotRow | null> {
  const store = getProjectStore();
  const snap = await store.findSnapshotById(id);
  if (!snap) return null;
  // Treat snapshots whose parent chapter is soft-deleted as 404. CLAUDE.md
  // requires every query to filter deleted_at IS NULL; the raw snapshot
  // read bypasses the join, so enforce it here.
  const chapter = await store.findChapterByIdRaw(snap.chapter_id);
  if (!chapter) return null;
  return snap;
}

export async function deleteSnapshot(id: string): Promise<boolean> {
  const store = getProjectStore();
  // Mirror getSnapshot's parent-chapter soft-delete check — CLAUDE.md
  // requires every query to filter deleted_at IS NULL, and a stale client
  // should not be able to delete snapshots of a trashed chapter when the
  // snapshot no longer appears in listings. Wrap both reads + the delete
  // in a transaction so a concurrent chapter restore/purge can't see a
  // half-applied state.
  return store.transaction(async (txStore) => {
    const snap = await txStore.findSnapshotById(id);
    if (!snap) return false;
    const chapter = await txStore.findChapterByIdRaw(snap.chapter_id);
    if (!chapter) return false;
    const count = await txStore.deleteSnapshot(id);
    return count > 0;
  });
}

export async function restoreSnapshot(
  snapshotId: string,
): Promise<{ chapter: Record<string, unknown> } | null | "corrupt_snapshot"> {
  const store = getProjectStore();
  const snapshot = await store.findSnapshotById(snapshotId);
  if (!snapshot) return null;

  // Refuse to restore snapshot content that is either corrupt or would
  // produce a chapter that can't subsequently be autosaved. JSON.parse
  // alone is insufficient: `42`, `[]`, `{"foo":1}` all parse but are not
  // TipTap documents and would render as nothing. Also enforce:
  //  - the shared depth cap (MAX_TIPTAP_DEPTH) so downstream recursive
  //    walkers (countWords, applyImageRefDiff) can't blow the stack on
  //    a legacy/imported deeply-nested snapshot — this matches the cap
  //    enforced on incoming chapter updates via TipTapDocSchema.
  //  - MAX_CHAPTER_CONTENT_BYTES so a restored chapter stays within the
  //    autosave request-body limit. Without this, a legacy oversize
  //    snapshot could be restored into a chapter that every subsequent
  //    save would reject with 413.
  let newParsed: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(snapshot.content);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { type?: unknown }).type !== "doc" ||
      !Array.isArray((parsed as { content?: unknown }).content)
    ) {
      return "corrupt_snapshot";
    }
    if (!validateTipTapDepth(parsed)) {
      return "corrupt_snapshot";
    }
    newParsed = parsed as Record<string, unknown>;
  } catch {
    return "corrupt_snapshot";
  }
  if (Buffer.byteLength(snapshot.content, "utf8") > MAX_CHAPTER_CONTENT_BYTES) {
    return "corrupt_snapshot";
  }

  const result = await store.transaction(async (txStore) => {
    const chapter = await txStore.findChapterByIdRaw(snapshot.chapter_id);
    if (!chapter) return null;

    // Auto-snapshot current content before restore
    const currentContent = chapter.content ?? JSON.stringify({ type: "doc", content: [] });
    const snapshotLabel = snapshot.label
      ? `Before restore to '${snapshot.label}'`
      : `Before restore to snapshot from ${snapshot.created_at}`;

    // Always create auto-restore snapshot (no dedup)
    await txStore.insertSnapshot({
      id: uuidv4(),
      chapter_id: chapter.id,
      label: snapshotLabel,
      content: currentContent,
      word_count: chapter.word_count,
      is_auto: true,
      created_at: new Date().toISOString(),
    });

    // Replace content using the validated, parsed snapshot content.
    const newWordCount = countWords(newParsed);
    const now = new Date().toISOString();
    await txStore.updateChapter(chapter.id, {
      content: snapshot.content,
      word_count: newWordCount,
      updated_at: now,
    });
    await txStore.updateProjectTimestamp(chapter.project_id, now);

    // Adjust image reference counts — use the same coalesced content used
    // for the pre-restore auto-snapshot so a never-saved chapter (NULL
    // content) is treated as the empty doc here too.
    await applyImageRefDiff(txStore, currentContent, snapshot.content, chapter.project_id);

    // Re-read inside the transaction so a concurrent autosave landing
    // between commit and a post-tx read cannot overwrite the response
    // body with stale content (silently undoing the restore in the UI).
    const updated = await txStore.findChapterById(chapter.id);
    if (!updated) return null;
    return { chapter: updated, project_id: chapter.project_id, chapter_id: chapter.id };
  });

  if (!result) return null;

  // Fire velocity side-effects after the transaction commits
  try {
    const svc = getVelocityService();
    await svc.recordSave(result.project_id);
  } catch (err: unknown) {
    logger.error(
      { err, project_id: result.project_id, chapter_id: result.chapter_id },
      "Velocity recordSave failed after restore (best-effort)",
    );
  }

  // Enrich with status_label to match every other chapter-returning endpoint
  // (updateChapter, restoreChapter, etc). The client types the response as
  // Chapter so consumers expect status_label to be present.
  const store2 = store;
  let enriched: Record<string, unknown>;
  try {
    enriched = (await enrichChapterWithLabel(store2, result.chapter)) as unknown as Record<
      string,
      unknown
    >;
  } catch {
    const { content_corrupt: _ignored, ...clean } = result.chapter;
    enriched = { ...clean, status_label: result.chapter.status } as Record<string, unknown>;
  }
  return { chapter: enriched };
}
