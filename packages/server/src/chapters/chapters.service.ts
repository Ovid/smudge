import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterRepo from "./chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
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
  const db = getDb();
  const chapter = await ChapterRepo.findById(db, id);
  if (!chapter) return null;

  if (isCorruptChapter(chapter)) return "corrupt";

  const clean = stripCorruptFlag(chapter);
  const status_label = await ChapterStatusRepo.getStatusLabel(db, chapter.status);
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

  const db = getDb();
  const chapter = await ChapterRepo.findByIdRaw(db, id);
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

  if (parsed.data.target_word_count !== undefined) {
    updates.target_word_count = parsed.data.target_word_count;
  }

  if (parsed.data.status !== undefined) {
    const valid = !!(await ChapterStatusRepo.findByStatus(db, parsed.data.status));
    if (!valid) {
      return { validationError: `Invalid status: ${parsed.data.status}` };
    }
    updates.status = parsed.data.status;
  }

  const rowsUpdated = await db.transaction(async (trx) => {
    const count = await ChapterRepo.update(trx, id, updates);
    if (count === 0) return 0;
    await ProjectRepo.updateTimestamp(trx, chapter.project_id);
    return count;
  });

  if (rowsUpdated === 0) return null;

  // Fire velocity side-effects (best-effort — must not break the save)
  if (parsed.data.content !== undefined) {
    try {
      const svc = getVelocityService();
      await svc.recordSave(chapter.project_id, chapter.id, updates.word_count as number);
    } catch {
      // Velocity tracking is best-effort; save must still succeed
    }
  }

  const updated = await ChapterRepo.findById(db, id);
  if (!updated) return "read_after_update_failure";

  // Only check corruption when content was part of the update
  if (parsed.data.content !== undefined && isCorruptChapter(updated)) {
    return { corrupt: true };
  }

  const clean = stripCorruptFlag(updated);
  const updatedStatusLabel = await ChapterStatusRepo.getStatusLabel(db, updated.status);
  return {
    chapter: {
      ...clean,
      status_label: updatedStatusLabel,
    },
  };
}

export async function deleteChapter(id: string): Promise<boolean> {
  const db = getDb();
  const chapter = await ChapterRepo.findByIdRaw(db, id);
  if (!chapter) return false;

  const now = new Date().toISOString();
  await db.transaction(async (trx) => {
    await ChapterRepo.softDelete(trx, id, now);
    await ProjectRepo.updateTimestamp(trx, chapter.project_id);
  });

  try {
    await getVelocityService().updateDailySnapshot(chapter.project_id);
  } catch {
    // Velocity tracking is best-effort; delete must still succeed
  }
  return true;
}

export async function restoreChapter(
  id: string,
): Promise<RestoredChapterResponse | null | "purged" | "conflict" | "read_failure"> {
  const db = getDb();
  const chapter = await ChapterRepo.findDeletedById(db, id);
  if (!chapter) return null;

  try {
    const now = new Date().toISOString();
    await db.transaction(async (trx) => {
      const parentProject = await ProjectRepo.findByIdIncludingDeleted(trx, chapter.project_id);
      if (!parentProject) {
        throw new Error("PARENT_PURGED");
      }

      const maxSort = await ChapterRepo.getMaxSortOrder(trx, chapter.project_id);
      await ChapterRepo.restore(trx, id, maxSort + 1, now);
      await ProjectRepo.updateTimestamp(trx, chapter.project_id);

      if (parentProject.deleted_at) {
        const freshSlug = await ProjectRepo.resolveUniqueSlug(
          trx,
          generateSlug(parentProject.title),
          parentProject.id,
        );
        await ProjectRepo.updateIncludingDeleted(trx, chapter.project_id, {
          deleted_at: null,
          updated_at: now,
          slug: freshSlug,
        });
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "PARENT_PURGED") {
      return "purged";
    }
    if ((err as Record<string, unknown>).code === "SQLITE_CONSTRAINT_UNIQUE") {
      // Slug collision when restoring the parent project — a different
      // active project now occupies the slug. Report as a conflict so the
      // route can return an appropriate error to the client.
      return "conflict";
    }
    throw err;
  }

  try {
    await getVelocityService().updateDailySnapshot(chapter.project_id);
  } catch {
    // Velocity tracking is best-effort; restore must still succeed
  }

  const restored = await ChapterRepo.findById(db, id);
  if (!restored) return "read_failure";

  const clean = stripCorruptFlag(restored);
  const updatedProject = await ProjectRepo.findById(db, chapter.project_id);
  const restoredStatusLabel = await ChapterStatusRepo.getStatusLabel(db, restored.status);

  return {
    ...clean,
    status_label: restoredStatusLabel,
    project_slug: updatedProject?.slug,
  };
}
