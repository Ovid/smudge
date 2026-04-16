export interface SnapshotRow {
  id: string;
  chapter_id: string;
  label: string | null;
  content: string;
  word_count: number;
  is_auto: boolean;
  created_at: string;
}

export interface SnapshotListItem {
  id: string;
  chapter_id: string;
  label: string | null;
  word_count: number;
  is_auto: boolean;
  created_at: string;
}

export interface CreateSnapshotData {
  id: string;
  chapter_id: string;
  label: string | null;
  content: string;
  word_count: number;
  is_auto: boolean;
  created_at: string;
}
