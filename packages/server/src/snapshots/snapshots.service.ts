import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { countWords } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { getVelocityService } from "../velocity/velocity.injectable";
import { logger } from "../logger";
import { applyImageRefDiff } from "../images/images.references";
import type { SnapshotRow, SnapshotListItem } from "./snapshots.types";

export async function createSnapshot(
  chapterId: string,
  label?: string | null,
  isAuto = false,
): Promise<SnapshotRow | null | "duplicate"> {
  const store = getProjectStore();
  const chapter = await store.findChapterByIdRaw(chapterId);
  if (!chapter) return null;

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
): Promise<{ chapter: Record<string, unknown> } | null | "corrupt_snapshot"> {
  const store = getProjectStore();
  const snapshot = await store.findSnapshotById(snapshotId);
  if (!snapshot) return null;

  // Refuse to restore corrupt snapshot content into a chapter — doing so
  // would silently replace valid content with an unparseable blob and
  // word_count=0, leaving the chapter unrenderable.
  let newParsed: Record<string, unknown>;
  try {
    newParsed = JSON.parse(snapshot.content);
  } catch {
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

    // Adjust image reference counts
    await applyImageRefDiff(txStore, chapter.content, snapshot.content);

    return { chapter_id: chapter.id, project_id: chapter.project_id };
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

  // Re-read the updated chapter
  const updated = await store.findChapterById(result.chapter_id);
  if (!updated) return null;
  return { chapter: updated as unknown as Record<string, unknown> };
}
