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
  completion_threshold: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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
