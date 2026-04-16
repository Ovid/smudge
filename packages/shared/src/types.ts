import type { z } from "zod";
import type { CreateProjectSchema, ProjectMode } from "./schemas";

export type ProjectMode = z.infer<typeof ProjectMode>;

export interface Project {
  id: string;
  slug: string;
  title: string;
  mode: ProjectMode;
  target_word_count: number | null;
  target_deadline: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  author_name: string | null;
}

export interface Chapter {
  id: string;
  project_id: string;
  title: string;
  content: Record<string, unknown> | null;
  sort_order: number;
  word_count: number;
  status: string;
  status_label?: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;

export interface ProjectListItem {
  id: string;
  slug: string;
  title: string;
  mode: ProjectMode;
  total_word_count: number;
  updated_at: string;
}

export interface ProjectWithChapters extends Project {
  chapters: Chapter[];
}

export interface ChapterStatusRow {
  status: string;
  sort_order: number;
  label: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface ImageRow {
  id: string;
  project_id: string;
  filename: string;
  alt_text: string;
  caption: string;
  source: string;
  license: string;
  mime_type: string;
  size_bytes: number;
  reference_count: number;
  created_at: string;
}

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

export interface VelocityResponse {
  words_today: number;
  daily_average_7d: number | null;
  daily_average_30d: number | null;
  current_total: number;
  target_word_count: number | null;
  remaining_words: number | null;
  target_deadline: string | null;
  days_until_deadline: number | null;
  required_pace: number | null;
  projected_completion_date: string | null;
  today: string;
}
