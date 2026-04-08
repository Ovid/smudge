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
import { stripCorruptFlag } from "../chapters/chapters.service";
import * as ChapterStatusRepo from "../chapter-statuses/chapter-statuses.repository";
import {
  getVelocityService,
  setVelocityService,
  resetVelocityService,
} from "../velocity/velocity.injectable";
import type { ProjectRow, ProjectListRow, UpdateProjectData } from "./projects.types";
import type {
  ChapterWithLabel,
  ChapterMetadataRow,
  DeletedChapterRow,
} from "../chapters/chapters.types";

export { setVelocityService, resetVelocityService };

// --- Dashboard types ---

interface ChapterMetadataWithLabel extends ChapterMetadataRow {
  status_label: string;
}

export interface DashboardResponse {
  chapters: ChapterMetadataWithLabel[];
  status_summary: Record<string, number>;
  totals: {
    word_count: number;
    chapter_count: number;
    most_recent_edit: string | null;
    least_recent_edit: string | null;
  };
}

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

  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();

  await db.transaction(async (trx) => {
    const existing = await ProjectRepo.findByTitle(trx, title);
    if (existing) {
      throw new ProjectTitleExistsError();
    }

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
): Promise<{ project: ProjectRow; chapters: ChapterWithLabel[] } | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapters = await ChapterRepo.listByProject(db, project.id);
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);

  const chaptersWithLabels = chapters.map((ch) => {
    const clean = stripCorruptFlag(ch);
    return {
      ...clean,
      status_label: statusLabelMap[ch.status] ?? ch.status,
    };
  });

  return { project, chapters: chaptersWithLabels };
}

export async function updateProject(
  slug: string,
  body: unknown,
): Promise<
  { project: ProjectRow; validationError?: undefined } | { validationError: string } | null
> {
  const parsed = UpdateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return { validationError: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const updates: UpdateProjectData = {
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

  await db.transaction(async (trx) => {
    if (parsed.data.title !== undefined) {
      const existingTitle = await ProjectRepo.findByTitle(trx, parsed.data.title, project.id);
      if (existingTitle) {
        throw new ProjectTitleExistsError();
      }
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

  // Intentionally skip updateDailySnapshot here: all chapters are now
  // soft-deleted, so sumWordCountByProject would return 0 and record a
  // false 0-word snapshot that corrupts velocity history if the project
  // is later restored. The snapshot will be corrected on restore or on
  // the next save in any active project.

  return true;
}

export async function createChapter(
  slug: string,
): Promise<ChapterWithLabel | "project_not_found" | "read_after_create_failure"> {
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
  if (!chapter) return "read_after_create_failure";

  const clean = stripCorruptFlag(chapter);
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);
  return {
    ...clean,
    status_label: statusLabelMap[chapter.status] ?? chapter.status,
  };
}

export async function reorderChapters(
  slug: string,
  body: unknown,
): Promise<{ success: true } | { validationError: string } | { mismatch: true } | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const parsed = ReorderChaptersSchema.safeParse(body);
  if (!parsed.success) {
    return {
      validationError: parsed.error.issues[0]?.message ?? "chapter_ids must be an array of UUIDs.",
    };
  }
  const { chapter_ids } = parsed.data;

  return db.transaction(async (trx) => {
    const existingIds = (await ChapterRepo.listIdsByProject(trx, project.id)).sort();
    const providedIds = [...chapter_ids].sort();

    if (
      existingIds.length !== providedIds.length ||
      !existingIds.every((id, i) => id === providedIds[i])
    ) {
      return { mismatch: true } as const;
    }

    const orders = chapter_ids.map((id, i) => ({ id, sort_order: i }));
    await ChapterRepo.updateSortOrders(trx, orders);
    await ProjectRepo.updateTimestamp(trx, project.id);

    return { success: true } as const;
  });
}

export async function getDashboard(slug: string): Promise<DashboardResponse | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlug(db, slug);
  if (!project) return null;

  const chapters = await ChapterRepo.listMetadataByProject(db, project.id);

  const allStatuses = await ChapterStatusRepo.list(db);
  const statusLabelMap = await ChapterStatusRepo.getStatusLabelMap(db);

  const chaptersWithLabels = chapters.map((ch) => ({
    ...ch,
    status_label: statusLabelMap[ch.status] ?? ch.status,
  }));

  const statusSummary: Record<string, number> = {};
  for (const s of allStatuses) {
    statusSummary[s.status] = 0;
  }
  for (const ch of chapters) {
    if (ch.status in statusSummary) {
      statusSummary[ch.status] = (statusSummary[ch.status] ?? 0) + 1;
    }
  }

  const totalWordCount = chapters.reduce((sum, ch) => sum + ch.word_count, 0);
  const updatedAts = chapters.map((ch) => ch.updated_at);
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

export async function getTrash(slug: string): Promise<DeletedChapterRow[] | null> {
  const db = getDb();
  const project = await ProjectRepo.findBySlugIncludingDeleted(db, slug);
  if (!project) return null;

  return ChapterRepo.listDeletedByProject(db, project.id);
}
