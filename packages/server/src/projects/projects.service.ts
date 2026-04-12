import { v4 as uuid } from "uuid";
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  ReorderChaptersSchema,
  generateSlug,
  UNTITLED_CHAPTER,
} from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { stripCorruptFlag } from "../chapters/chapters.service";
import type { ProjectRow, ProjectListRow, UpdateProjectData } from "./projects.types";
import type {
  ChapterWithLabel,
  ChapterMetadataRow,
  DeletedChapterRow,
} from "../chapters/chapters.types";

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
  const store = getProjectStore();

  const projectId = uuid();
  const chapterId = uuid();
  const now = new Date().toISOString();

  const project = await store.transaction(async (txStore) => {
    const existing = await txStore.findProjectByTitle(title);
    if (existing) {
      throw new ProjectTitleExistsError();
    }

    const slug = await txStore.resolveUniqueSlug(generateSlug(title));

    const inserted = await txStore.insertProject({
      id: projectId,
      title,
      slug,
      mode,
      created_at: now,
      updated_at: now,
    });

    await txStore.insertChapter({
      id: chapterId,
      project_id: projectId,
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 0,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });

    return inserted;
  });

  return { project };
}

export async function listProjects(): Promise<ProjectListRow[]> {
  const store = getProjectStore();
  return store.listProjects();
}

export async function getProject(
  slug: string,
): Promise<{ project: ProjectRow; chapters: ChapterWithLabel[] } | null> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return null;

  const chapters = await store.listChaptersByProject(project.id);
  const statusLabelMap = await store.getStatusLabelMap();

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

  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
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
  await store.transaction(async (txStore) => {
    if (parsed.data.title !== undefined) {
      const existingTitle = await txStore.findProjectByTitle(parsed.data.title, project.id);
      if (existingTitle) {
        throw new ProjectTitleExistsError();
      }
      const newSlug = await txStore.resolveUniqueSlug(generateSlug(parsed.data.title), project.id);
      updates.title = parsed.data.title;
      updates.slug = newSlug;
    }
    await txStore.updateProject(project.id, updates);
  });

  const updated = await store.findProjectById(project.id);
  if (!updated) {
    throw new Error(`Project ${project.id} not found after update`);
  }
  return { project: updated };
}

export async function deleteProject(slug: string): Promise<boolean> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return false;

  const now = new Date().toISOString();

  await store.transaction(async (txStore) => {
    await txStore.softDeleteChaptersByProject(project.id, now);
    await txStore.softDeleteProject(project.id, now);
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
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return "project_not_found";

  const chapterId = uuid();
  const now = new Date().toISOString();

  await store.transaction(async (txStore) => {
    const maxOrder = await txStore.getMaxChapterSortOrder(project.id);
    await txStore.insertChapter({
      id: chapterId,
      project_id: project.id,
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: maxOrder + 1,
      word_count: 0,
      created_at: now,
      updated_at: now,
    });
    await txStore.updateProjectTimestamp(project.id);
  });

  const chapter = await store.findChapterById(chapterId);
  if (!chapter) return "read_after_create_failure";

  const clean = stripCorruptFlag(chapter);
  const statusLabelMap = await store.getStatusLabelMap();
  return {
    ...clean,
    status_label: statusLabelMap[chapter.status] ?? chapter.status,
  };
}

export async function reorderChapters(
  slug: string,
  body: unknown,
): Promise<{ success: true } | { validationError: string } | { mismatch: true } | null> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return null;

  const parsed = ReorderChaptersSchema.safeParse(body);
  if (!parsed.success) {
    return {
      validationError: parsed.error.issues[0]?.message ?? "chapter_ids must be an array of UUIDs.",
    };
  }
  const { chapter_ids } = parsed.data;

  return store.transaction(async (txStore) => {
    const existingIds = (await txStore.listChapterIdsByProject(project.id)).sort();
    const providedIds = [...chapter_ids].sort();

    if (
      existingIds.length !== providedIds.length ||
      !existingIds.every((id, i) => id === providedIds[i])
    ) {
      return { mismatch: true } as const;
    }

    const orders = chapter_ids.map((id, i) => ({ id, sort_order: i }));
    await txStore.updateChapterSortOrders(orders);
    await txStore.updateProjectTimestamp(project.id);

    return { success: true } as const;
  });
}

export async function getDashboard(slug: string): Promise<DashboardResponse | null> {
  const store = getProjectStore();
  const project = await store.findProjectBySlug(slug);
  if (!project) return null;

  const chapters = await store.listChapterMetadataByProject(project.id);

  const allStatuses = await store.listStatuses();
  const statusLabelMap: Record<string, string> = Object.fromEntries(
    allStatuses.map((s) => [s.status, s.label]),
  );

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
  const store = getProjectStore();
  const project = await store.findProjectBySlugIncludingDeleted(slug);
  if (!project) return null;

  return store.listDeletedChaptersByProject(project.id);
}
