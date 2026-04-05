import type { CompletionThresholdValue } from "@smudge/shared";

export interface ProjectRow {
  id: string;
  title: string;
  slug: string;
  mode: string;
  target_word_count: number | null;
  target_deadline: string | null;
  completion_threshold: CompletionThresholdValue | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
