import { randomUUID as uuidv4 } from "node:crypto";
import type { SnapshotsStore } from "../stores/project-store.types";
import { canonicalContentHash } from "./content-hash";

/**
 * Insert a pre-mutation auto-snapshot, skipping it when the content is
 * byte-identical to the chapter's latest snapshot of ANY kind.
 *
 * Deduped against manual OR auto snapshots (F-15). The manual-snapshot path
 * deliberately dedups against the latest *manual* snapshot only, so that an
 * auto-snapshot cannot block an explicit marker the writer asked for. This
 * insert is itself an auto-snapshot, so it must ALSO be skipped when the
 * pre-mutation content already matches an auto-snapshot left by an earlier
 * restore or replace — that is what removes the identical-content history
 * noise. The caller's mutation always proceeds; only the redundant insert is
 * skipped.
 *
 * S6 (dedup review 2026-07-26): this block, and the ~10 lines of F-15
 * rationale above it, lived verbatim in both snapshots.service.restoreSnapshot
 * and search.service.replaceInProject. Its own history argues for extraction:
 * addd61f added the dedup to both sites in one commit and cb4851b corrected
 * the same wrong lookup at both sites 50 minutes later — the rule living twice
 * meant the same mistake had to be made twice and fixed twice. Four
 * parameters, no strategy flags; `SnapshotsStore` is the exact store slice
 * needed, so the transaction-scoped store satisfies it structurally.
 */
export async function insertAutoSnapshotIfChanged(
  txStore: SnapshotsStore,
  chapter: { id: string; word_count: number },
  content: string,
  label: string,
): Promise<void> {
  const contentHash = canonicalContentHash(content);
  const latestHash = await txStore.getLatestSnapshotContentHashAnyKind(chapter.id);
  if (latestHash === contentHash) return;

  await txStore.insertSnapshot({
    id: uuidv4(),
    chapter_id: chapter.id,
    label,
    content,
    word_count: chapter.word_count,
    is_auto: true,
    created_at: new Date().toISOString(),
  });
}
