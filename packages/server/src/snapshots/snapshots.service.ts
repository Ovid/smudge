import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { countWords } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { applyImageRefDiff } from "../images/images.references";
import type { SnapshotRow, SnapshotListItem } from "./snapshots.types";

export async function createSnapshot(
  chapterId: string,
  label?: string | null,
  isAuto = false,
): Promise<SnapshotRow | null | "duplicate"> {
  const store = getProjectStore();
  const chapter = await store.findChapterByIdRaw(chapterId);
  if (!chapter || chapter.deleted_at) return null;

  const content = chapter.content ?? JSON.stringify({ type: "doc", content: [] });

  // Dedup guard: skip if content matches latest snapshot (manual snapshots only)
  if (!isAuto) {
    const contentHash = createHash("sha256").update(content).digest("hex");
    const latestHash = await store.getLatestSnapshotContentHash(chapterId);
    if (latestHash === contentHash) return "duplicate";
  }

  const now = new Date().toISOString();
  const snapshot = await store.insertSnapshot({
    id: uuidv4(),
    chapter_id: chapterId,
    label: label?.trim() || null,
    content,
    word_count: chapter.word_count,
    is_auto: isAuto,
    created_at: now,
  });

  return snapshot;
}

export async function listSnapshots(chapterId: string): Promise<SnapshotListItem[] | null> {
  const store = getProjectStore();
  const chapter = await store.findChapterById(chapterId);
  if (!chapter) return null;
  return store.listSnapshotsByChapter(chapterId);
}

export async function getSnapshot(id: string): Promise<SnapshotRow | null> {
  const store = getProjectStore();
  return store.findSnapshotById(id);
}

export async function deleteSnapshot(id: string): Promise<boolean> {
  const store = getProjectStore();
  const count = await store.deleteSnapshot(id);
  return count > 0;
}

export async function restoreSnapshot(
  snapshotId: string,
): Promise<{ chapter: Record<string, unknown> } | null> {
  const store = getProjectStore();
  const snapshot = await store.findSnapshotById(snapshotId);
  if (!snapshot) return null;

  const result = await store.transaction(async (txStore) => {
    const chapter = await txStore.findChapterByIdRaw(snapshot.chapter_id);
    if (!chapter || chapter.deleted_at) return null;

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

    // Replace content and recalculate word count
    let newParsed: Record<string, unknown> | null = null;
    try {
      newParsed = JSON.parse(snapshot.content);
    } catch {
      /* corrupt */
    }
    const newWordCount = newParsed ? countWords(newParsed) : 0;
    const now = new Date().toISOString();
    await txStore.updateChapter(chapter.id, {
      content: snapshot.content,
      word_count: newWordCount,
      updated_at: now,
    });
    await txStore.updateProjectTimestamp(chapter.project_id, now);

    // Adjust image reference counts
    await applyImageRefDiff(txStore, chapter.content, snapshot.content);

    return { chapter_id: chapter.id };
  });

  if (!result) return null;

  // Re-read the updated chapter
  const updated = await store.findChapterById(result.chapter_id);
  if (!updated) return null;
  return { chapter: updated as unknown as Record<string, unknown> };
}
