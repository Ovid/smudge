export type SnapshotType = "auto" | "manual" | "pre-destructive-op";

export interface SnapshotRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  snapshot_type: SnapshotType;
  label: string | null;
  content: string;
  created_at: string;
}

export interface CreateSnapshotRow {
  id: string;
  project_id: string;
  chapter_id: string | null;
  snapshot_type: SnapshotType;
  label: string | null;
  content: string;
  created_at: string;
}

export interface SnapshotStore {
  insertSnapshot(data: CreateSnapshotRow): Promise<SnapshotRow>;
  findSnapshotById(id: string): Promise<SnapshotRow | null>;
  listSnapshotsByProject(projectId: string): Promise<SnapshotRow[]>;
  listSnapshotsByChapter(chapterId: string): Promise<SnapshotRow[]>;
  deleteSnapshot(id: string): Promise<void>;
}
