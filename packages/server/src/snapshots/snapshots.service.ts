import { randomUUID as uuidv4 } from "node:crypto";
import { TipTapDocSchema, sanitizeSnapshotLabel, stripImageNodes } from "@smudge/shared";
import { truncateGraphemes } from "../utils/grapheme";
import { buildAutoSnapshotLabel } from "./labels";
import { insertAutoSnapshotIfChanged } from "./auto-snapshot";
import { writeChapterContent } from "../chapters/chapter-content-write";
import { fireDailySnapshot } from "../velocity/velocity.side-effects";
import { getProjectStore } from "../stores/project-store.injectable";
import { logger } from "../logger";
import { extractImageIds, imageIdFromNode } from "../images/images.references";
import { enrichChapterWithLabel, type ChapterWithLabel } from "../chapters/chapters.types";
import { canonicalContentHash } from "./content-hash";
import { MAX_CHAPTER_CONTENT_BYTES } from "../constants";
import type { SnapshotRow, SnapshotListItem } from "./snapshots.types";

/**
 * How much of the restored snapshot's own label may be embedded in the
 * generated "Before restore to ‘…’" label.
 *
 * I4 (dedup review 2026-07-26): this was a bare 450 with no stated link to the
 * cap it sits under. It is deliberately well below LABEL_MAX_UNITS rather than
 * derived from it (the template's own 20 units would leave 480): the headroom
 * lets the template text grow without silently eating into the user's
 * fragment. It is a budget, not the enforcement — buildAutoSnapshotLabel's
 * clamp is what guarantees the result fits.
 */
const EMBEDDED_LABEL_MAX = 450;

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
      // S9 (dedup review 2026-07-26): the review called this `.trim()` dead,
      // because sanitizedLabelBase already trims and the route is the only
      // production caller. True of that path — but createSnapshot is a service
      // function callable directly, snapshots.service.test.ts asserts it trims
      // as its own contract, and dropping it would be a behaviour change with
      // no user-visible benefit. It stays. The substance of S9 — the
      // `.optional()`/`.nullish()` disagreement with the outtake twin — is
      // fixed in schemas.ts.
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
  // F-29: the liveness check and the read are ONE transaction, matching
  // listOuttakes (outtakes.service.ts) and deleteSnapshot below. Split across
  // two round trips, a chapter soft-delete landing between them answered
  // 200-with-data for a chapter the writer had just trashed.
  //
  // Every call below must go through txStore, never the outer store: Knex's
  // better-sqlite3 pool is max:1, so a non-scoped call from inside a
  // transaction starves on the sole connection until timeout rather than
  // failing fast.
  return store.transaction(async (txStore) => {
    const chapter = await txStore.findChapterById(chapterId);
    if (!chapter) return null;
    return txStore.listSnapshotsByChapter(chapterId);
  });
}

export async function getSnapshot(id: string): Promise<SnapshotRow | null> {
  const store = getProjectStore();
  // F-29: both reads in ONE transaction — see listSnapshots above for the
  // rationale and the txStore-only rule.
  return store.transaction(async (txStore) => {
    const snap = await txStore.findSnapshotById(id);
    if (!snap) return null;
    // Treat snapshots whose parent chapter is soft-deleted as 404. CLAUDE.md
    // requires every query to filter deleted_at IS NULL; the raw snapshot
    // read bypasses the join, so enforce it here.
    const chapter = await txStore.findChapterByIdRaw(snap.chapter_id);
    if (!chapter) return null;
    return snap;
  });
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

export type RestoreFailure = "corrupt_snapshot" | "cross_project_image";

/**
 * `dropped_image_count` is the number of DISTINCT IMAGES removed because they
 * no longer exist (F-05) — `missingIds.size`, not a node tally. Two nodes
 * pointing at the same dead image count once, which is what the user-facing
 * copy ("One image was left out") already says. Zero on the ordinary path. It
 * is a COUNT and not a message: the client owns the user-facing copy, per
 * CLAUDE.md §API Design.
 */
export interface RestoreSuccess {
  chapter: ChapterWithLabel;
  dropped_image_count: number;
}

export async function restoreSnapshot(
  snapshotId: string,
): Promise<RestoreSuccess | null | RestoreFailure> {
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

    // Two DIFFERENT conditions used to share this one arm, which is what made
    // F-05 both permanent and mislabelled:
    //
    //  - image exists but belongs to ANOTHER project → still a hard refusal.
    //    Writing the foreign src would silently persist a link that 404s once
    //    the other project is purged, and adopting another project's asset is
    //    not ours to decide. applyImageRefDiff already refuses to adjust
    //    cross-project ref counts, but that only protects ref-count integrity —
    //    the broken src still ends up persisted.
    //
    //  - image is GONE (deleted; images have no soft-delete and the bytes are
    //    unlinked immediately) → restore the prose and drop the dead node.
    //    Refusing cannot bring the image back, so it only ALSO withholds the
    //    writer's words; the snapshot was otherwise readable but permanently
    //    un-restorable. The count is returned so the client can say what
    //    happened — this is the one place a restore alters what it restores,
    //    so it must never be silent.
    const restoredIds = extractImageIds(newParsed);
    const missingIds = new Set<string>();
    if (restoredIds.length > 0) {
      const rows = await txStore.findImagesByIds(restoredIds);
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const id of restoredIds) {
        const image = byId.get(id);
        if (!image) {
          missingIds.add(id);
          continue;
        }
        if (image.project_id !== chapter.project_id) {
          return "cross_project_image" as const;
        }
      }
    }

    // Only re-serialize when something was actually dropped, so the untouched
    // path keeps writing the snapshot's exact stored bytes.
    let restoreContent = snapshot.content;
    if (missingIds.size > 0) {
      // imageIdFromNode is the same matcher extractImageIds used to build
      // `missingIds`, so the strip and the reference scan cannot disagree
      // about what counts as a reference.
      const stripped = stripImageNodes(newParsed, (node) => {
        const id = imageIdFromNode(node);
        return id !== null && missingIds.has(id);
      });
      restoreContent = JSON.stringify(stripped);
      newParsed = stripped;
      logger.warn(
        {
          chapter_id: chapter.id,
          project_id: chapter.project_id,
          snapshot_id: snapshot.id,
          dropped_image_ids: [...missingIds],
        },
        "Restored snapshot with deleted images dropped from content",
      );
    }

    // Auto-snapshot current content before restore
    const currentContent = chapter.content ?? JSON.stringify({ type: "doc", content: [] });
    // Run the auto-label through the same sanitize + 500-char clamp pipeline
    // CreateSnapshotSchema applies to manual labels. A legacy manual label
    // containing control/bidi chars or near the 500-char limit would otherwise
    // produce an unsanitized or oversized restore-auto-snapshot label.
    //
    // Sanitize BEFORE grapheme-truncating the embedded label: otherwise
    // invisible control/bidi chars count toward the 450-grapheme budget and
    // get stripped downstream, yielding an oddly-short (or empty-looking)
    // embedded fragment. The final `buildAutoSnapshotLabel` call sanitizes
    // again — that's an idempotent no-op on already-clean input and keeps
    // the guarantee that the stored label is sanitized even if the embed
    // template ever adds bidi chars literally.
    const sanitizedEmbed = snapshot.label ? sanitizeSnapshotLabel(snapshot.label) : null;
    const embedded = sanitizedEmbed ? truncateGraphemes(sanitizedEmbed, EMBEDDED_LABEL_MAX) : null;
    const rawLabel = embedded
      ? `Before restore to \u2018${embedded}\u2019`
      : `Before restore to snapshot from ${snapshot.created_at}`;
    const snapshotLabel = buildAutoSnapshotLabel(rawLabel);

    // Auto-snapshot the pre-restore content, deduped against the latest
    // snapshot of ANY kind (F-15) — including a re-restore whose pre-restore
    // content already matches the most recent snapshot. See
    // insertAutoSnapshotIfChanged for the full rationale.
    await insertAutoSnapshotIfChanged(txStore, chapter, currentContent, snapshotLabel);

    // Replace content using the validated, parsed snapshot content.
    // `restoreContent` is the snapshot's own bytes unless dead images were
    // dropped above, in which case it is the stripped re-serialization —
    // word count, the persisted row, and the ref-count diff must all agree on
    // ONE content value, or the chapter would hold content whose images the
    // refcounter never saw.
    // writeChapterContent does NOT enforce that agreement, it only co-locates
    // it: `nextContent` (the bytes it stores) and `nextDoc` (the document it
    // counts) are two independent parameters with no assertion and no
    // derivation linking them. Keeping them the same document is THIS caller's
    // obligation, which is why the strip branch above assigns `restoreContent`
    // and `newParsed` together. A new conditional transform of `restoreContent`
    // must reassign `newParsed` alongside it, or the chapter stores one
    // document while `word_count` describes another and the dashboard reports
    // the wrong daily progress with no error anywhere.
    // `previousContent` is the coalesced `currentContent` used for
    // the pre-restore auto-snapshot above, not `chapter.content`, so a
    // never-saved chapter (NULL content) is treated as the empty doc here too.
    const now = new Date().toISOString();
    await writeChapterContent(txStore, {
      chapterId: chapter.id,
      projectId: chapter.project_id,
      previousContent: currentContent,
      nextContent: restoreContent,
      nextDoc: newParsed,
      now,
    });
    // Bumped here, per chapter, rather than inside writeChapterContent —
    // replaceInProject bumps once per replace instead, so the helper
    // deliberately leaves this to the caller.
    await txStore.updateProjectTimestamp(chapter.project_id, now);

    // Re-read inside the transaction so a concurrent autosave landing
    // between commit and a post-tx read cannot overwrite the response
    // body with stale content (silently undoing the restore in the UI).
    const updated = await txStore.findChapterById(chapter.id);
    if (!updated) return null;
    return {
      chapter: updated,
      project_id: chapter.project_id,
      chapter_id: chapter.id,
      dropped_image_count: missingIds.size,
    };
  });

  if (result === "cross_project_image") return result;
  if (!result) return null;

  // Fire velocity side-effects after the transaction commits
  await fireDailySnapshot({
    projectId: result.project_id,
    failureMessage: "Velocity updateDailySnapshot failed after restore (best-effort)",
    context: { chapter_id: result.chapter_id },
  });

  // Enrich with status_label to match every other chapter-returning endpoint
  // (updateChapter, restoreChapter, etc). The client types the response as
  // Chapter so consumers expect status_label to be present. The transaction
  // has already committed, so a status-lookup failure doesn't unmake the
  // restore — fall back to `status` as the label so the client sees a
  // successful restore, matching the pattern in chapters.service.updateChapter.
  // The degrade-to-status-as-label fallback that used to be wrapped here now
  // lives inside enrichChapterWithLabel, so every caller gets it (OOSI1).
  return {
    chapter: await enrichChapterWithLabel(store, result.chapter),
    dropped_image_count: result.dropped_image_count,
  };
}
