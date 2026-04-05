export interface ProjectRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  target_word_count: number | null;
  target_deadline: string | null;
  completion_threshold: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateProjectRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectListRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  updated_at: string;
  total_word_count: number;
}
