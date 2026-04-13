import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { getVelocityService } from "../velocity/velocity.injectable";
import { logger } from "../logger";
import {
  isCorruptChapter,
  enrichChapterWithLabel,
  type ChapterWithLabel,
  type RestoredChapterResponse,
  type UpdateChapterData,
} from "./chapters.types";

// --- Transaction control-flow errors ---

export class ParentPurgedError extends Error {
  constructor() {
    super("The parent project has been permanently deleted");
    this.name = "ParentPurgedError";
  }
}

export class ChapterPurgedError extends Error {
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
  const chapter = await store.findChapterByIdRaw(id);
  if (!chapter) return null;

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

  const rowsUpdated = await store.transaction(async (txStore) => {
    const count = await txStore.updateChapter(id, updates);
    if (count === 0) return 0;
    await txStore.updateProjectTimestamp(chapter.project_id, updates.updated_at);
    return count;
  });

  if (rowsUpdated === 0) return null;

  // Fire velocity side-effects (best-effort — must not break the save)
  if (parsed.data.content !== undefined) {
    try {
      const svc = getVelocityService();
      await svc.recordSave(chapter.project_id);
    } catch (err: unknown) {
      logger.error(
        { err, project_id: chapter.project_id, chapter_id: id },
        "Velocity recordSave failed (best-effort)",
      );
    }
  }

  const updated = await store.findChapterById(id);
  if (!updated) return "read_after_update_failure";

  // Only check corruption when content was part of the update
  if (parsed.data.content !== undefined && isCorruptChapter(updated)) {
    return { corrupt: true };
  }

  return {
    chapter: await enrichChapterWithLabel(store, updated),
  };
}

export async function deleteChapter(id: string): Promise<boolean> {
  const store = getProjectStore();
  const chapter = await store.findChapterByIdRaw(id);
  if (!chapter) return false;

  const now = new Date().toISOString();
  await store.transaction(async (txStore) => {
    await txStore.softDeleteChapter(id, now);
    await txStore.updateProjectTimestamp(chapter.project_id, now);
  });

  try {
    await getVelocityService().updateDailySnapshot(chapter.project_id);
  } catch (err: unknown) {
    logger.error(
      { err, project_id: chapter.project_id, chapter_id: id },
      "Velocity updateDailySnapshot failed (best-effort)",
    );
  }
  return true;
}

export async function restoreChapter(
  id: string,
): Promise<
  RestoredChapterResponse | null | "parent_purged" | "chapter_purged" | "conflict" | "read_failure"
> {
  const store = getProjectStore();
  const chapter = await store.findDeletedChapterById(id);
  if (!chapter) return null;

  try {
    const now = new Date().toISOString();
    await store.transaction(async (txStore) => {
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
          return; // Already restored by another request — no action needed
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

  try {
    await getVelocityService().updateDailySnapshot(chapter.project_id);
  } catch (err: unknown) {
    logger.error(
      { err, project_id: chapter.project_id, chapter_id: id },
      "Velocity updateDailySnapshot failed (best-effort)",
    );
  }

  const restored = await store.findChapterById(id);
  if (!restored) return "read_failure";

  const updatedProject = await store.findProjectByIdIncludingDeleted(chapter.project_id);
  if (!updatedProject) return "read_failure";

  const enriched = await enrichChapterWithLabel(store, restored);
  return {
    ...enriched,
    project_slug: updatedProject.slug,
  };
}
