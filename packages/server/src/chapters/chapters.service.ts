import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { fireDailySnapshot } from "../velocity/velocity.side-effects";
import { applyImageRefDiff } from "../images/images.references";
import {
  isCorruptChapter,
  enrichChapterWithLabel,
  type ChapterRow,
  type ChapterWithLabel,
  type RestoredChapterResponse,
  type UpdateChapterData,
} from "./chapters.types";
import type { ProjectRow } from "../projects/projects.types";
import type { ProjectStore } from "../stores/project-store.types";

// --- Transaction control-flow errors ---

class ParentPurgedError extends Error {
  constructor() {
    super("The parent project has been permanently deleted");
    this.name = "ParentPurgedError";
  }
}

class ChapterPurgedError extends Error {
  constructor() {
    super("This chapter has been permanently deleted");
    this.name = "ChapterPurgedError";
  }
}

// --- Service functions ---

export async function getChapter(id: string): Promise<ChapterWithLabel | null | "corrupt"> {
  const store = getProjectStore();
  const chapter = await store.findChapterById(id);
  if (!chapter) return null;

  if (isCorruptChapter(chapter)) return "corrupt";

  return enrichChapterWithLabel(store, chapter);
}

/**
 * Update a chapter row from a validated PATCH body.
 *
 * Side effects beyond writing the `chapters` row (F-8 — intentional, but not
 * evident from the signature):
 * - Bumps the parent project's `updated_at` (within the transaction).
 * - Diffs image reference counts for images added/removed by a content change
 *   (within the transaction, via {@link applyImageRefDiff}).
 * - Fires `velocityService.updateDailySnapshot` after commit when content changed —
 *   best-effort: a throw is logged and swallowed, never failing the save
 *   (writes a `daily_snapshots` row).
 */
export async function updateChapter(
  id: string,
  body: unknown,
): Promise<
  | { chapter: ChapterWithLabel }
  | { validationError: string }
  | { corrupt: true }
  | null
  | "read_after_update_failure"
> {
  const parsed = UpdateChapterSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const store = getProjectStore();

  const updates: UpdateChapterData = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.title !== undefined) {
    updates.title = parsed.data.title;
  }

  if (parsed.data.content !== undefined) {
    updates.content = JSON.stringify(parsed.data.content);
    updates.word_count = countWords(parsed.data.content as Record<string, unknown>);
  }

  if (parsed.data.status !== undefined) {
    const valid = !!(await store.findStatusByStatus(parsed.data.status));
    if (!valid) {
      return { validationError: `Invalid status: ${parsed.data.status}` };
    }
    updates.status = parsed.data.status;
  }

  // Read chapter, compute image diff, apply updates, and re-read the
  // committed row in a single transaction so the response body reflects
  // exactly what this request wrote — without this, a concurrent writer
  // landing between commit and a post-tx findChapterById would let the
  // other writer's content ride back in this response. Mirrors the
  // pattern already used by snapshots.service.restoreSnapshot.
  const txResult = await store.transaction(async (txStore) => {
    const chapter = await txStore.findChapterByIdRaw(id);
    if (!chapter) return null;

    const count = await txStore.updateChapter(id, updates);
    if (count === 0) return null;
    await txStore.updateProjectTimestamp(chapter.project_id, updates.updated_at);

    // Update image reference counts inside the same transaction
    if (parsed.data.content !== undefined) {
      await applyImageRefDiff(
        txStore,
        chapter.content,
        JSON.stringify(parsed.data.content),
        chapter.project_id,
      );
    }

    const updatedRow = await txStore.findChapterById(id);
    if (!updatedRow) return "read_failure" as const;
    return { project_id: chapter.project_id, updated: updatedRow };
  });

  if (!txResult) return null;
  if (txResult === "read_failure") return "read_after_update_failure";
  const { project_id: projectId, updated } = txResult;

  // Fire velocity side-effects (best-effort — must not break the save)
  if (parsed.data.content !== undefined) {
    await fireDailySnapshot({
      projectId,
      failureMessage: "Velocity updateDailySnapshot failed after save (best-effort)",
      context: { chapter_id: id },
    });
  }

  // Only check corruption when content was part of the update
  if (parsed.data.content !== undefined && isCorruptChapter(updated)) {
    return { corrupt: true };
  }

  // The enrichment degrade (log + fall back to status as label) used to be
  // wrapped here. It now lives inside enrichChapterWithLabel itself, because
  // restoreChapter and projects.service.createChapter needed the identical
  // guard and had none (OOSI1). This site keeps no local catch: a second one
  // would only be reachable if the shared guard were removed.
  return { chapter: await enrichChapterWithLabel(store, updated) };
}

/**
 * Soft-delete a chapter.
 *
 * Side effects beyond setting `deleted_at` (F-8 — intentional, but not evident
 * from the signature):
 * - Bumps the parent project's `updated_at` (within the transaction).
 * - Decrements image reference counts for the chapter's referenced images
 *   (within the transaction, via {@link applyImageRefDiff}).
 * - Fires `velocityService.updateDailySnapshot` after commit — best-effort: a
 *   throw is logged and swallowed, never failing the delete.
 */
export async function deleteChapter(id: string): Promise<boolean> {
  const store = getProjectStore();

  const now = new Date().toISOString();
  const projectId = await store.transaction(async (txStore) => {
    // Read content inside the transaction so the image ref diff is based
    // on the committed content state (consistent with deleteProject/updateChapter).
    const chapter = await txStore.findChapterByIdRaw(id);
    if (!chapter) return null;

    await txStore.softDeleteChapter(id, now);
    await txStore.updateProjectTimestamp(chapter.project_id, now);

    // Decrement image reference counts atomically with the soft-delete, routed
    // through the shared helper so the cross-project + existence guards apply.
    await applyImageRefDiff(txStore, chapter.content, null, chapter.project_id);

    return chapter.project_id;
  });

  if (!projectId) return false;

  await fireDailySnapshot({
    projectId,
    failureMessage: "Velocity updateDailySnapshot failed (best-effort)",
    context: { chapter_id: id },
  });
  return true;
}

/**
 * What {@link restoreChapter}'s transaction hands back: either the two rows the
 * response is built from, both read inside the transaction, or the sentinel.
 */
type RestoreTxOutcome = { chapter: ChapterRow; project: ProjectRow } | "read_failure";

/**
 * Re-read the restored chapter and its parent project through the
 * transaction-scoped store, so the response reflects exactly what this
 * transaction wrote.
 *
 * Reports a miss by RETURNING the sentinel rather than throwing, because only a
 * returned sentinel can reach `RESTORE_READ_FAILURE`. `restoreChapter`'s catch
 * discriminates on `ParentPurgedError`, `ChapterPurgedError` and a
 * `SQLITE_CONSTRAINT_UNIQUE` slug collision; a throw from here matches none of
 * them (both calls are SELECTs, which cannot carry a UNIQUE-constraint code), so
 * it is rethrown and rendered as a generic 500 `INTERNAL_ERROR` that no client
 * scope discriminates. Returning is how the specific code gets emitted.
 *
 * An earlier version of this comment said a throw would make
 * `chapter.restore`'s `committedCodes: ["RESTORE_READ_FAILURE"]` (client
 * `scopes.ts`) "actively wrong". That was wrong (S4, 2026-08-21): a throw never
 * reaches that code, so the entry is never consulted. Nor is a throw a
 * correctness hazard — with both reads inside the transaction it rolls the
 * restore BACK, so "the restore failed, retry" is accurate. That is a strict
 * improvement over the pre-F-28 shape, where the confirming read ran after
 * commit and a throw left the chapter restored while reporting failure.
 *
 * "MUST NOT throw" was never enforced either — there is no try/catch here, and
 * none is needed: with both reads inside the transaction neither can miss
 * (`findChapterById` filters `deleted_at IS NULL` and the UPDATE just cleared
 * it; `findProjectByIdIncludingDeleted` filters nothing and read the same row
 * at the top of this transaction), so `"read_failure"` is unreachable in
 * production on every path, `alreadyActive` included. The sentinel is a
 * compile-checked total-function exit, not a live error path.
 */
async function confirmRestore(
  txStore: ProjectStore,
  id: string,
  projectId: string,
): Promise<RestoreTxOutcome> {
  const restored = await txStore.findChapterById(id);
  if (!restored) return "read_failure";

  const project = await txStore.findProjectByIdIncludingDeleted(projectId);
  if (!project) return "read_failure";

  return { chapter: restored, project };
}

/**
 * Restore a soft-deleted chapter.
 *
 * Side effects beyond clearing the chapter's `deleted_at` (F-8 — intentional,
 * but not evident from the signature):
 * - If the parent project was also soft-deleted, restores it too: clears its
 *   `deleted_at`, regenerates a unique slug, and bumps `updated_at`. Otherwise
 *   just bumps the parent's `updated_at` (all within the transaction).
 * - Increments image reference counts for the restored content (within the
 *   transaction, via {@link applyImageRefDiff}).
 * - Fires `velocityService.updateDailySnapshot` after commit — best-effort: a
 *   throw is logged and swallowed, never failing the restore.
 */
export async function restoreChapter(
  id: string,
): Promise<
  RestoredChapterResponse | null | "parent_purged" | "chapter_purged" | "conflict" | "read_failure"
> {
  const store = getProjectStore();
  const chapter = await store.findDeletedChapterById(id);
  if (!chapter) return null;

  // F-28: the confirming reads run INSIDE the transaction. Without that, a
  // concurrent writer landing between commit and a post-tx read would let the
  // other writer's state ride back in this response — the rule stated at
  // updateChapter above and repeated at snapshots.service.restoreSnapshot.
  // There is no observable delta in this process (better-sqlite3 is
  // synchronous and Smudge is single-writer), but roadmap Phase 7g.2 deletes
  // the guard that keeps it single-writer; see 7g.8.
  //
  // Two things deliberately stay OUTSIDE, and both are traps:
  //  - the velocity snapshot, which is a post-commit best-effort side effect;
  //  - enrichChapterWithLabel, which reaches the store for the status label.
  //    Knex's better-sqlite3 pool is max:1, so a non-scoped `store.*` call from
  //    inside a transaction STARVES until timeout rather than failing fast.
  let txOutcome: RestoreTxOutcome;
  try {
    const now = new Date().toISOString();
    txOutcome = await store.transaction<RestoreTxOutcome>(async (txStore) => {
      const parentProject = await txStore.findProjectByIdIncludingDeleted(chapter.project_id);
      if (!parentProject) {
        throw new ParentPurgedError();
      }

      const maxSort = await txStore.getMaxChapterSortOrder(chapter.project_id);
      const restoredCount = await txStore.restoreChapter(id, maxSort + 1, now);
      if (restoredCount === 0) {
        // restoredCount === 0 means the UPDATE matched no rows. This can happen when:
        // 1. The chapter was hard-deleted (purged) between lookup and restore
        // 2. Another request already restored it (deleted_at is now NULL)
        // Distinguish by checking if the chapter exists as active.
        const alreadyActive = await txStore.findChapterById(id);
        if (alreadyActive) {
          // Already restored by another request. The project-restore and the
          // image-ref increment below belong to whichever request did the
          // restore, so they are skipped here — but the response still has to
          // be confirmed, and confirming inside the transaction is the whole
          // point of F-28. Hence a returned outcome rather than a bare return.
          return confirmRestore(txStore, id, chapter.project_id);
        }
        throw new ChapterPurgedError();
      }

      if (parentProject.deleted_at) {
        const freshSlug = await txStore.resolveUniqueSlug(
          generateSlug(parentProject.title),
          parentProject.id,
        );
        await txStore.updateProjectIncludingDeleted(chapter.project_id, {
          deleted_at: null,
          updated_at: now,
          slug: freshSlug,
        });
      } else {
        await txStore.updateProjectTimestamp(chapter.project_id, now);
      }

      // Read content inside the transaction to get the committed state
      // and increment image reference counts atomically with the restore.
      // Route through applyImageRefDiff so the existence-check + missing-
      // image warning is shared with updateChapter / replaceInProject /
      // restoreSnapshot rather than diverging here.
      const restoredRow = await txStore.findChapterByIdRaw(id);
      if (restoredRow?.content) {
        await applyImageRefDiff(txStore, null, restoredRow.content, restoredRow.project_id);
      }

      return confirmRestore(txStore, id, chapter.project_id);
    });
  } catch (err: unknown) {
    if (err instanceof ParentPurgedError) {
      return "parent_purged";
    }
    if (err instanceof ChapterPurgedError) {
      return "chapter_purged";
    }
    if (
      err instanceof Error &&
      "code" in err &&
      (err as unknown as Record<string, unknown>).code === "SQLITE_CONSTRAINT_UNIQUE" &&
      /slug/i.test(err.message)
    ) {
      // Slug collision when restoring the parent project — a different
      // active project now occupies the slug. Defensive: resolveUniqueSlug
      // prevents this under SQLite's serialized writes, but guards against
      // races on future storage backends.
      //
      // Note: the /slug/i regex on err.message is fragile — it depends on
      // SQLite's error message format ("UNIQUE constraint failed: projects.slug").
      // Acceptable because slug is the only UNIQUE constraint on projects that
      // can fire during restore. If new UNIQUE constraints are added, revisit.
      return "conflict";
    }
    throw err;
  }

  await fireDailySnapshot({
    projectId: chapter.project_id,
    failureMessage: "Velocity updateDailySnapshot failed (best-effort)",
    context: { chapter_id: id },
  });

  if (txOutcome === "read_failure") return "read_failure";
  const { chapter: restored, project: updatedProject } = txOutcome;

  const enriched = await enrichChapterWithLabel(store, restored);
  return {
    ...enriched,
    project_slug: updatedProject.slug,
  };
}
