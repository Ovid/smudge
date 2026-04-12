import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import {
  getVelocityService,
  setVelocityService,
  resetVelocityService,
} from "../velocity/velocity.injectable";
import type {
  ChapterRow,
  ChapterWithLabel,
  RestoredChapterResponse,
  UpdateChapterData,
} from "./chapters.types";

export { setVelocityService, resetVelocityService };

// --- Helpers ---

export function isCorruptChapter(chapter: { content_corrupt?: boolean }): boolean {
  return chapter.content_corrupt === true;
}

export function stripCorruptFlag(chapter: ChapterRow): Omit<ChapterRow, "content_corrupt"> {
  const { content_corrupt: _, ...rest } = chapter;
  return rest;
}

// --- Service functions ---

export async function getChapter(id: string): Promise<ChapterWithLabel | null | "corrupt"> {
  const store = getProjectStore();
  const chapter = await store.findChapterById(id);
  if (!chapter) return null;

  if (isCorruptChapter(chapter)) return "corrupt";

  const clean = stripCorruptFlag(chapter);
  const status_label = await store.getStatusLabel(chapter.status);
  return { ...clean, status_label };
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
    await txStore.updateProjectTimestamp(chapter.project_id);
    return count;
  });

  if (rowsUpdated === 0) return null;

  // Fire velocity side-effects (best-effort — must not break the save)
  if (parsed.data.content !== undefined) {
    try {
      const svc = getVelocityService();
      await svc.recordSave(chapter.project_id);
    } catch (err: unknown) {
      console.error("Velocity recordSave failed (best-effort):", err);
    }
  }

  const updated = await store.findChapterById(id);
  if (!updated) return "read_after_update_failure";

  // Only check corruption when content was part of the update
  if (parsed.data.content !== undefined && isCorruptChapter(updated)) {
    return { corrupt: true };
  }

  const clean = stripCorruptFlag(updated);
  const updatedStatusLabel = await store.getStatusLabel(updated.status);
  return {
    chapter: {
      ...clean,
      status_label: updatedStatusLabel,
    },
  };
}

export async function deleteChapter(id: string): Promise<boolean> {
  const store = getProjectStore();
  const chapter = await store.findChapterByIdRaw(id);
  if (!chapter) return false;

  const now = new Date().toISOString();
  await store.transaction(async (txStore) => {
    await txStore.softDeleteChapter(id, now);
    await txStore.updateProjectTimestamp(chapter.project_id);
  });

  try {
    await getVelocityService().updateDailySnapshot(chapter.project_id);
  } catch (err: unknown) {
    console.error("Velocity updateDailySnapshot failed (best-effort):", err);
  }
  return true;
}

export async function restoreChapter(
  id: string,
): Promise<RestoredChapterResponse | null | "purged" | "conflict" | "read_failure"> {
  const store = getProjectStore();
  const chapter = await store.findDeletedChapterById(id);
  if (!chapter) return null;

  try {
    const now = new Date().toISOString();
    await store.transaction(async (txStore) => {
      const parentProject = await txStore.findProjectByIdIncludingDeleted(chapter.project_id);
      if (!parentProject) {
        throw new Error("PARENT_PURGED");
      }

      const maxSort = await txStore.getMaxChapterSortOrder(chapter.project_id);
      const restoredCount = await txStore.restoreChapter(id, maxSort + 1, now);
      if (restoredCount === 0) {
        throw new Error("CHAPTER_PURGED");
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
        await txStore.updateProjectTimestamp(chapter.project_id);
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "PARENT_PURGED") {
      return "purged";
    }
    if (err instanceof Error && err.message === "CHAPTER_PURGED") {
      return "purged";
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
      return "conflict";
    }
    throw err;
  }

  try {
    await getVelocityService().updateDailySnapshot(chapter.project_id);
  } catch (err: unknown) {
    console.error("Velocity updateDailySnapshot failed (best-effort):", err);
  }

  const restored = await store.findChapterById(id);
  if (!restored) return "read_failure";

  const clean = stripCorruptFlag(restored);
  const updatedProject = await store.findProjectByIdIncludingDeleted(chapter.project_id);
  if (!updatedProject) return "read_failure";
  const restoredStatusLabel = await store.getStatusLabel(restored.status);

  return {
    ...clean,
    status_label: restoredStatusLabel,
    project_slug: updatedProject.slug,
  };
}
