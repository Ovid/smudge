import { UpdateChapterSchema, countWords, generateSlug } from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ChapterRepo from "./chapters.repository";
import * as ProjectRepo from "../projects/projects.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as VelocityService from "../velocity/velocity.service";

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

export function isCorruptChapter(chapter: Record<string, unknown>): boolean {
  return chapter.content_corrupt === true;
}

export function stripCorruptFlag(chapter: Record<string, unknown>): Record<string, unknown> {
  const { content_corrupt: _, ...rest } = chapter;
  return rest;
}

// --- Service functions ---

export async function getChapter(
  id: string,
): Promise<Record<string, unknown> | null | "corrupt"> {
  const db = getDb();
  const chapter = await ChapterRepo.findById(db, id);
  if (!chapter) return null;

  if (isCorruptChapter(chapter as unknown as Record<string, unknown>)) return "corrupt";

  const status_label = await ChapterStatusRepo.getStatusLabel(db, chapter.status);
  return { ...(chapter as unknown as Record<string, unknown>), status_label };
}

export async function updateChapter(
  id: string,
  body: unknown,
): Promise<
  | { chapter: Record<string, unknown> }
  | { validationError: string }
  | { corrupt: true }
  | null
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
    const valid = await ChapterRepo.validateStatus(db, parsed.data.status);
    if (!valid) {
      return { validationError: `Invalid status: ${parsed.data.status}` };
    }
    updates.status = parsed.data.status;
  }

  await db.transaction(async (trx) => {
    await ChapterRepo.update(trx, id, updates);
    await ProjectRepo.updateTimestamp(trx, chapter.project_id as string);
  });

  // Fire velocity side-effects (best-effort)
  if (parsed.data.content !== undefined) {
    const svc = getVelocityService();
    await svc.recordSave(
      chapter.project_id as string,
      chapter.id as string,
      updates.word_count as number,
    );
  }

  const updated = await ChapterRepo.findById(db, id);
  if (!updated) return null;

  // Only check corruption when content was part of the update
  if (
    parsed.data.content !== undefined &&
    isCorruptChapter(updated as unknown as Record<string, unknown>)
  ) {
    return { corrupt: true };
  }

  const updatedStatusLabel = await ChapterStatusRepo.getStatusLabel(db, updated.status);
  return {
    chapter: { ...(updated as unknown as Record<string, unknown>), status_label: updatedStatusLabel },
  };
}

export async function deleteChapter(id: string): Promise<boolean> {
  const db = getDb();
  const chapter = await ChapterRepo.findByIdRaw(db, id);
  if (!chapter) return false;

  const now = new Date().toISOString();
  await db.transaction(async (trx) => {
    await ChapterRepo.softDelete(trx, id, now);
    await ProjectRepo.updateTimestamp(trx, chapter.project_id as string);
  });

  await getVelocityService().updateDailySnapshot(chapter.project_id as string);
  return true;
}

export async function restoreChapter(
  id: string,
): Promise<Record<string, unknown> | null | "purged" | "conflict"> {
  const db = getDb();
  const chapter = await ChapterRepo.findDeletedById(db, id);
  if (!chapter) return null;

  const parentProject = await ProjectRepo.findByIdIncludingDeleted(db, chapter.project_id as string);
  if (!parentProject) return "purged";

  try {
    await db.transaction(async (trx) => {
      await ChapterRepo.restore(trx, id);

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
        await ProjectRepo.update(trx, chapter.project_id as string, projectUpdate);
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return "conflict";
    }
    throw err;
  }

  await getVelocityService().updateDailySnapshot(chapter.project_id as string);

  const restored = await ChapterRepo.findById(db, id);
  if (!restored) return null;

  const updatedProject = await ProjectRepo.findById(db, chapter.project_id as string);
  const restoredStatusLabel = await ChapterStatusRepo.getStatusLabel(db, restored.status);

  return {
    ...(restored as unknown as Record<string, unknown>),
    status_label: restoredStatusLabel,
    project_slug: updatedProject?.slug,
  };
}
