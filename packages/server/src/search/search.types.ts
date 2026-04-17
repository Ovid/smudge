import type { SearchMatch } from "@smudge/shared";

export interface SearchResult {
  total_count: number;
  chapters: Array<{
    chapter_id: string;
    chapter_title: string;
    matches: SearchMatch[];
  }>;
  /** Chapter IDs skipped due to corrupt JSON content. Omitted when empty. */
  skipped_chapter_ids?: string[];
}
