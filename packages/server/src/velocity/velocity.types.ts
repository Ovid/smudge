export interface SaveEventRow {
  id: string;
  chapter_id: string | null;
  project_id: string;
  word_count: number;
  saved_at: string;
  save_date: string;
}

export interface DailySnapshotRow {
  id: string;
  project_id: string;
  date: string;
  total_word_count: number;
  created_at: string;
}
