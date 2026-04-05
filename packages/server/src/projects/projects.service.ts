import { v4 as uuid } from "uuid";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ReorderChaptersSchema,
  generateSlug,
  UNTITLED_CHAPTER,
} from "@smudge/shared";
import { getDb } from "../db/connection";
import * as ProjectRepo from "./projects.repository";
import * as ChapterRepo from "../chapters/chapters.repository";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import * as VelocityService from "../velocity/velocity.service";
import type { ProjectRow, ProjectListRow } from "./projects.types";
import type { ChapterRow } from "../chapters/chapters.types";

// --- Errors ---

export class ProjectTitleExistsError extends Error {
  constructor() {
    super("A project with that title already exists");
    this.name = "ProjectTitleExistsError";
  }
}

// --- Service functions ---

export async function createProject(
  body: unknown,
): Promise<{ project: ProjectRow; validationError?: undefined } | { validationError: string }> {
  const parsed = CreateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { title, mode } = parsed.data;
  const db = getDb();

  const existing = await ProjectRepo.findByTitle(db, title);
  if (existing) {
    throw new ProjectTitleExistsError();
  }

  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();

  try {
    await db.transaction(async (trx) => {
      const slug = await ProjectRepo.resolveUniqueSlug(trx, generateSlug(title));

      await ProjectRepo.insert(trx, {
        id: projectId,
        title,
        slug,
        mode,
        created_at: now,
        updated_at: now,
      });

      await ChapterRepo.insert(trx, {
        id: chapterId,
        project_id: projectId,
        title: UNTITLED_CHAPTER,
        content: null,
        sort_order: 0,
        word_count: 0,
        created_at: now,
        updated_at: now,
      });
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new ProjectTitleExistsError();
    }
    throw err;
  }

  const project = await ProjectRepo.findById(db, projectId);
  if (!project) {
    throw new Error(`Project ${projectId} not found after insert`);
  }
  return { project };
}

export async function listProjects(): Promise<ProjectListRow[]> {
  const db = getDb();
  return ProjectRepo.listAll(db);
}

export async function getProject(
  slug: string,
): Promise<{ project: ProjectRow; chapters: Record<string, unknown>[] } | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapters = await ChapterRepo.listByProject(db, project.id);
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);

  const chaptersWithLabels = chapters.map((ch) => {
    const { content_corrupt: _, ...rest } = ch as ChapterRow & { content_corrupt?: boolean };
    return {
      ...rest,
      status_label: statusLabelMap[ch.status] ?? ch.status,
    };
  });

  return { project, chapters: chaptersWithLabels };
}

export async function updateProject(
  slug: string,
  body: unknown,
): Promise<
  | { project: ProjectRow; validationError?: undefined }
  | { validationError: string }
  | null
> {
  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  if (parsed.data.title !== undefined) {
    const existingTitle = await ProjectRepo.findByTitle(db, parsed.data.title, project.id);
    if (existingTitle) {
      throw new ProjectTitleExistsError();
    }
  }

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (parsed.data.target_word_count !== undefined) {
    updates.target_word_count = parsed.data.target_word_count;
  }
  if (parsed.data.target_deadline !== undefined) {
    updates.target_deadline = parsed.data.target_deadline;
  }
  if (parsed.data.completion_threshold !== undefined) {
    updates.completion_threshold = parsed.data.completion_threshold;
  }

  try {
    await db.transaction(async (trx) => {
      if (parsed.data.title !== undefined) {
        const newSlug = await ProjectRepo.resolveUniqueSlug(
          trx,
          generateSlug(parsed.data.title),
          project.id,
        );
        updates.title = parsed.data.title;
        updates.slug = newSlug;
      }
      await ProjectRepo.update(trx, project.id, updates);
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      throw new ProjectTitleExistsError();
    }
    throw err;
  }

  const updated = await ProjectRepo.findById(db, project.id);
  if (!updated) {
    throw new Error(`Project ${project.id} not found after update`);
  }
  return { project: updated };
}

export async function deleteProject(slug: string): Promise<boolean> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return false;

  const now = new Date().toISOString();

  await db.transaction(async (trx) => {
    await ChapterRepo.softDeleteByProject(trx, project.id, now);
    await ProjectRepo.softDelete(trx, project.id, now);
  });

  await VelocityService.updateDailySnapshot(project.id);

  return true;
}

export async function createChapter(
  slug: string,
): Promise<Record<string, unknown> | null | "project_not_found"> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return "project_not_found";

  const chapterId = uuid();
  const now = new Date().toISOString();

  await db.transaction(async (trx) => {
    const maxOrder = await ChapterRepo.getMaxSortOrder(trx, project.id);
    await ChapterRepo.insert(trx, {
      id: chapterId,
      project_id: project.id,
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: maxOrder + 1,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });
    await ProjectRepo.updateTimestamp(trx, project.id);
  });

  const chapter = await ChapterRepo.findById(db, chapterId);
  if (!chapter) return null;

  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);
  return {
    ...chapter,
    status_label: statusLabelMap[chapter.status] ?? chapter.status,
  };
}

export async function reorderChapters(
  slug: string,
  body: unknown,
): Promise<
  | { success: true }
  | { validationError: string }
  | { mismatch: true }
  | null
> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const parsed = ReorderChaptersSchema.safeParse(body);
  if (!parsed.success) {
    return {
      validationError:
        parsed.error.issues[0]?.message ?? "chapter_ids must be an array of UUIDs.",
    };
  }
  const { chapter_ids } = parsed.data;

  const existingIds = (await ChapterRepo.listIdsByProject(db, project.id)).sort();
  const providedIds = [...chapter_ids].sort();

  if (
    existingIds.length !== providedIds.length ||
    !existingIds.every((id, i) => id === providedIds[i])
  ) {
    return { mismatch: true };
  }

  await db.transaction(async (trx) => {
    const orders = chapter_ids.map((id, i) => ({ id, sort_order: i }));
    await ChapterRepo.updateSortOrders(trx, orders);
    await ProjectRepo.updateTimestamp(trx, project.id);
  });

  return { success: true };
}

export async function getDashboard(slug: string): Promise<Record<string, unknown> | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapters = await ChapterRepo.listMetadataByProject(db, project.id);

  const allStatuses = await ChapterStatusRepo.list(db);
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);

  const chaptersWithLabels = chapters.map((ch) => ({
    ...ch,
    status_label: statusLabelMap[ch.status as string] ?? (ch.status as string),
  }));

  const statusSummary: Record<string, number> = {};
  for (const s of allStatuses) {
    statusSummary[s.status] = 0;
  }
  for (const ch of chapters) {
    const status = ch.status as string;
    if (status in statusSummary) {
      statusSummary[status] = (statusSummary[status] ?? 0) + 1;
    }
  }

  const totalWordCount = chapters.reduce(
    (sum, ch) => sum + (ch.word_count as number),
    0,
  );
  const updatedAts = chapters.map((ch) => ch.updated_at as string);
  const mostRecentEdit =
    updatedAts.length > 0 ? updatedAts.reduce((a, b) => (a > b ? a : b)) : null;
  const leastRecentEdit =
    updatedAts.length > 0 ? updatedAts.reduce((a, b) => (a < b ? a : b)) : null;

  return {
    chapters: chaptersWithLabels,
    status_summary: statusSummary,
    totals: {
      word_count: totalWordCount,
      chapter_count: chapters.length,
      most_recent_edit: mostRecentEdit,
      least_recent_edit: leastRecentEdit,
    },
  };
}

export async function getTrash(slug: string): Promise<Record<string, unknown>[] | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  return ChapterRepo.listDeletedByProject(db, project.id);
}
