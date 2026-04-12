import type { Knex } from "knex";
import type { ProjectStore } from "./project-store.types";
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
import * as projectsRepo from "../projects/projects.repository";
import * as chaptersRepo from "../chapters/chapters.repository";
import * as statusesRepo from "../chapter-statuses/chapter-statuses.repository";
import * as velocityRepo from "../velocity/velocity.repository";

export class SqliteProjectStore implements ProjectStore {
  constructor(private db: Knex.Transaction | Knex) {}

  // --- Projects ---

  insertProject(data: CreateProjectRow): Promise<ProjectRow> {
    return projectsRepo.insert(this.db, data);
  }

  findProjectById(id: string): Promise<ProjectRow | null> {
    return projectsRepo.findById(this.db, id);
  }

  findProjectByIdIncludingDeleted(id: string): Promise<ProjectRow | null> {
    return projectsRepo.findByIdIncludingDeleted(this.db, id);
  }

  findProjectBySlug(slug: string): Promise<ProjectRow | null> {
    return projectsRepo.findBySlug(this.db, slug);
  }

  findProjectBySlugIncludingDeleted(slug: string): Promise<ProjectRow | null> {
    return projectsRepo.findBySlugIncludingDeleted(this.db, slug);
  }

  findProjectByTitle(title: string, excludeId?: string): Promise<ProjectRow | null> {
    return projectsRepo.findByTitle(this.db, title, excludeId);
  }

  listProjects(): Promise<ProjectListRow[]> {
    return projectsRepo.listAll(this.db);
  }

  updateProject(id: string, data: UpdateProjectData): Promise<ProjectRow> {
    return projectsRepo.update(this.db, id, data);
  }

  updateProjectIncludingDeleted(id: string, data: UpdateProjectData): Promise<ProjectRow> {
    return projectsRepo.updateIncludingDeleted(this.db, id, data);
  }

  updateProjectTimestamp(id: string, now: string): Promise<void> {
    return projectsRepo.updateTimestamp(this.db, id, now);
  }

  softDeleteProject(id: string, now: string): Promise<void> {
    return projectsRepo.softDelete(this.db, id, now);
  }

  resolveUniqueSlug(baseSlug: string, excludeProjectId?: string): Promise<string> {
    return projectsRepo.resolveUniqueSlug(this.db, baseSlug, excludeProjectId);
  }

  // --- Chapters ---

  insertChapter(data: CreateChapterRow): Promise<void> {
    return chaptersRepo.insert(this.db, data);
  }

  findChapterById(id: string): Promise<ChapterRow | null> {
    return chaptersRepo.findById(this.db, id);
  }

  findDeletedChapterById(id: string): Promise<ChapterRawRow | null> {
    return chaptersRepo.findDeletedById(this.db, id);
  }

  findChapterByIdRaw(id: string): Promise<ChapterRawRow | null> {
    return chaptersRepo.findByIdRaw(this.db, id);
  }

  listChaptersByProject(projectId: string): Promise<ChapterRow[]> {
    return chaptersRepo.listByProject(this.db, projectId);
  }

  listChapterMetadataByProject(projectId: string): Promise<ChapterMetadataRow[]> {
    return chaptersRepo.listMetadataByProject(this.db, projectId);
  }

  listDeletedChaptersByProject(projectId: string): Promise<DeletedChapterRow[]> {
    return chaptersRepo.listDeletedByProject(this.db, projectId);
  }

  listChapterIdsByProject(projectId: string): Promise<string[]> {
    return chaptersRepo.listIdsByProject(this.db, projectId);
  }

  sumChapterWordCountByProject(projectId: string): Promise<number> {
    return chaptersRepo.sumWordCountByProject(this.db, projectId);
  }

  getMaxChapterSortOrder(projectId: string): Promise<number> {
    return chaptersRepo.getMaxSortOrder(this.db, projectId);
  }

  updateChapter(id: string, updates: UpdateChapterData): Promise<number> {
    return chaptersRepo.update(this.db, id, updates);
  }

  updateChapterSortOrders(orders: Array<{ id: string; sort_order: number }>): Promise<void> {
    return chaptersRepo.updateSortOrders(this.db, orders);
  }

  softDeleteChapter(id: string, now: string): Promise<void> {
    return chaptersRepo.softDelete(this.db, id, now);
  }

  softDeleteChaptersByProject(projectId: string, now: string): Promise<void> {
    return chaptersRepo.softDeleteByProject(this.db, projectId, now);
  }

  restoreChapter(id: string, sortOrder: number, now: string): Promise<number> {
    return chaptersRepo.restore(this.db, id, sortOrder, now);
  }

  // --- Chapter statuses ---

  listStatuses(): Promise<ChapterStatusRow[]> {
    return statusesRepo.list(this.db);
  }

  findStatusByStatus(status: string): Promise<ChapterStatusRow | undefined> {
    return statusesRepo.findByStatus(this.db, status);
  }

  getStatusLabel(status: string): Promise<string> {
    return statusesRepo.getStatusLabel(this.db, status);
  }

  getStatusLabelMap(): Promise<Record<string, string>> {
    return statusesRepo.getStatusLabelMap(this.db);
  }

  // --- Velocity ---

  upsertDailySnapshot(projectId: string, date: string, totalWordCount: number): Promise<void> {
    return velocityRepo.upsertDailySnapshot(this.db, projectId, date, totalWordCount);
  }

  // --- Transactions ---

  async transaction<T>(
    fn: (txStore: ProjectStore) => Promise<T>,
  ): Promise<T> {
    if (this.db.isTransaction) {
      throw new Error("Nested transactions are not supported");
    }
    return (this.db as Knex).transaction(async (trx) => {
      const txStore = new SqliteProjectStore(trx);
      return fn(txStore);
    });
  }
}
