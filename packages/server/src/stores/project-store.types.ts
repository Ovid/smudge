import type {
  ProjectRow,
  CreateProjectRow,
  ProjectListRow,
  UpdateProjectData,
} from "../projects/projects.types";
import type {
  ChapterRow,
  ChapterRawRow,
  ChapterMetadataRow,
  DeletedChapterRow,
  CreateChapterRow,
  UpdateChapterData,
} from "../chapters/chapters.types";
import type { ChapterStatusRow } from "../chapter-statuses/chapter-statuses.types";

export interface ProjectStore {
  // --- Projects ---
  insertProject(data: CreateProjectRow): Promise<ProjectRow>;
  findProjectById(id: string): Promise<ProjectRow | null>;
  findProjectByIdIncludingDeleted(id: string): Promise<ProjectRow | null>;
  findProjectBySlug(slug: string): Promise<ProjectRow | null>;
  findProjectBySlugIncludingDeleted(slug: string): Promise<ProjectRow | null>;
  findProjectByTitle(title: string, excludeId?: string): Promise<ProjectRow | null>;
  listProjects(): Promise<ProjectListRow[]>;
  updateProject(id: string, data: UpdateProjectData): Promise<ProjectRow>;
  updateProjectIncludingDeleted(id: string, data: UpdateProjectData): Promise<ProjectRow>;
  updateProjectTimestamp(id: string, now: string): Promise<void>;
  softDeleteProject(id: string, now: string): Promise<void>;
  resolveUniqueSlug(baseSlug: string, excludeProjectId?: string): Promise<string>;

  // --- Chapters ---
  insertChapter(data: CreateChapterRow): Promise<void>;
  findChapterById(id: string): Promise<ChapterRow | null>;
  findDeletedChapterById(id: string): Promise<ChapterRawRow | null>;
  findChapterByIdRaw(id: string): Promise<ChapterRawRow | null>;
  listChaptersByProject(projectId: string): Promise<ChapterRow[]>;
  listChapterMetadataByProject(projectId: string): Promise<ChapterMetadataRow[]>;
  listDeletedChaptersByProject(projectId: string): Promise<DeletedChapterRow[]>;
  listChapterIdsByProject(projectId: string): Promise<string[]>;
  sumChapterWordCountByProject(projectId: string): Promise<number>;
  getMaxChapterSortOrder(projectId: string): Promise<number>;
  updateChapter(id: string, updates: UpdateChapterData): Promise<number>;
  updateChapterSortOrders(orders: Array<{ id: string; sort_order: number }>): Promise<void>;
  softDeleteChapter(id: string, now: string): Promise<void>;
  softDeleteChaptersByProject(projectId: string, now: string): Promise<void>;
  restoreChapter(id: string, sortOrder: number, now: string): Promise<number>;

  // --- Chapter statuses ---
  listStatuses(): Promise<ChapterStatusRow[]>;
  findStatusByStatus(status: string): Promise<ChapterStatusRow | undefined>;
  getStatusLabel(status: string): Promise<string>;
  getStatusLabelMap(): Promise<Record<string, string>>;

  // --- Velocity ---
  upsertDailySnapshot(projectId: string, date: string, totalWordCount: number): Promise<void>;

  // --- Transactions ---

  /**
   * Run a function within a database transaction.
   *
   * The callback receives a transaction-scoped store that shares the
   * underlying transaction. All store operations within the callback
   * are atomic.
   */
  transaction<T>(fn: (txStore: ProjectStore) => Promise<T>): Promise<T>;
}
