import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterRepo from "./chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as VelocityService from "../velocity/velocity.service";
import type { ChapterRow, ChapterWithLabel, RestoredChapterResponse } from "./chapters.types";

// --- Injectable velocity service for testing ---

interface VelocityServiceInterface {
  recordSave(projectId: string, chapterId: string, wordCount: number): Promise<void>;
  updateDailySnapshot(projectId: string): Promise<void>;
}

let velocityServiceOverride: VelocityServiceInterface | null = null;

export function setVelocityService(svc: VelocityServiceInterface): void {
  velocityServiceOverride = svc;
}

export function resetVelocityService(): void {
  velocityServiceOverride = null;
}

function getVelocityService(): VelocityServiceInterface {
  return velocityServiceOverride ?? VelocityService;
}

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

  const updates: Record<string, unknown> = {
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

  await db.transaction(async (trx) => {
    await ChapterRepo.update(trx, id, updates);
    await ProjectRepo.updateTimestamp(trx, chapter.project_id);
  });

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

  const parentProject = await ProjectRepo.findByIdIncludingDeleted(db, chapter.project_id);
  if (!parentProject) return "purged";

  try {
    await db.transaction(async (trx) => {
      const maxSort = await ChapterRepo.getMaxSortOrder(trx, chapter.project_id);
      await ChapterRepo.restore(trx, id, maxSort + 1);

      if (parentProject.deleted_at) {
        const freshSlug = await ProjectRepo.resolveUniqueSlug(
          trx,
          generateSlug(parentProject.title),
          parentProject.id,
        );
        const projectUpdate: Record<string, unknown> = {
          deleted_at: null,
          updated_at: new Date().toISOString(),
          slug: freshSlug,
        };
        await ProjectRepo.update(trx, chapter.project_id, projectUpdate);
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
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
