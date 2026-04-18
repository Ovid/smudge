import { v4 as uuidv4 } from "uuid";
import { countWords, sanitizeSnapshotLabel, TipTapDocSchema } from "@smudge/shared";
import { truncateGraphemes } from "../utils/grapheme";
import { getProjectStore } from "../stores/project-store.injectable";
import { getVelocityService } from "../velocity/velocity.injectable";
import { logger } from "../logger";
import { applyImageRefDiff, extractImageIds } from "../images/images.references";
import { enrichChapterWithLabel } from "../chapters/chapters.types";
import { canonicalContentHash } from "./content-hash";
import { MAX_CHAPTER_CONTENT_BYTES } from "../constants";
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
  // Cheap size check first so a massive legacy row doesn't pay for
  // JSON.parse + full recursive schema walk before being rejected.
  if (Buffer.byteLength(snapshot.content, "utf8") > MAX_CHAPTER_CONTENT_BYTES) {
    return "corrupt_snapshot";
  }
  let newParsed: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(snapshot.content);
    // Gate on the same TipTap schema we apply to chapter PATCH writes so a
    // legacy/hand-edited snapshot with malformed nodes (numbers in content,
    // etc.) can't be restored into a chapter that every subsequent save
    // would reject. The schema also enforces the shared depth cap.
    const safe = TipTapDocSchema.safeParse(parsed);
    if (!safe.success) return "corrupt_snapshot";
    // Schema allows `content` to be optional (matches chapter PATCH). A doc
    // like `{"type":"doc"}` is a valid empty manuscript, not corrupt — coerce
    // to `content: []` so downstream walkers see a consistent shape.
    const docObj = parsed as Record<string, unknown>;
    if (!Array.isArray(docObj.content)) docObj.content = [];
    newParsed = docObj;
  } catch {
    return "corrupt_snapshot";
  }

  const result = await store.transaction(async (txStore) => {
    const chapter = await txStore.findChapterByIdRaw(snapshot.chapter_id);
    if (!chapter) return null;

    // Reject restore if the snapshot content references images owned by a
    // different project (or missing entirely). Without this the foreign
    // image URL is silently written into the chapter; when the other
    // project is purged the image 404s with no user-visible warning at
    // restore time. applyImageRefDiff already refuses to adjust cross-
    // project ref counts, but that only protects ref-count integrity —
    // the broken src still ends up persisted.
    const restoredIds = extractImageIds(newParsed);
    if (restoredIds.length > 0) {
      const rows = await txStore.findImagesByIds(restoredIds);
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of restoredIds) {
        const image = byId.get(id);
        if (!image || image.project_id !== chapter.project_id) {
          return "corrupt_snapshot" as const;
        }
      }
    }

    // Auto-snapshot current content before restore
    const currentContent = chapter.content ?? JSON.stringify({ type: "doc", content: [] });
    // Run the auto-label through the same sanitize + 500-char clamp pipeline
    // CreateSnapshotSchema applies to manual labels. A legacy manual label
    // containing control/bidi chars or near the 500-char limit would otherwise
    // produce an unsanitized or oversized restore-auto-snapshot label.
    // Grapheme-truncate the embedded user label *and* the final clamp so a
    // surrogate-pair emoji or combining sequence near the 500-char cap is
    // never split mid-grapheme — 450 graphemes can exceed 500 UTF-16 code
    // units on emoji-heavy labels, and a code-unit slice(0,500) would then
    // split a surrogate and store a lone-surrogate label.
    const embedded = snapshot.label ? truncateGraphemes(snapshot.label, 450) : null;
    const rawLabel = embedded
      ? `Before restore to '${embedded}'`
      : `Before restore to snapshot from ${snapshot.created_at}`;
    const snapshotLabel = truncateGraphemes(sanitizeSnapshotLabel(rawLabel), 500);

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

  if (result === "corrupt_snapshot") return "corrupt_snapshot";
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
  // Chapter so consumers expect status_label to be present. The transaction
  // has already committed, so a status-lookup failure doesn't unmake the
  // restore — fall back to `status` as the label so the client sees a
  // successful restore, matching the pattern in chapters.service.updateChapter.
  const store2 = store;
  try {
    const enriched = (await enrichChapterWithLabel(store2, result.chapter)) as unknown as Record<
      string,
      unknown
    >;
    return { chapter: enriched };
  } catch (err: unknown) {
    logger.error(
      { err, project_id: result.project_id, chapter_id: result.chapter_id },
      "enrichChapterWithLabel failed after restore; returning status as label",
    );
    const { content_corrupt: _c, ...clean } = result.chapter as Record<string, unknown> & {
      content_corrupt?: unknown;
    };
    return {
      chapter: { ...clean, status_label: (result.chapter as { status: string }).status },
    };
  }
}
