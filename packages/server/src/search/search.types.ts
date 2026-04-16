import type { SearchMatch } from "@smudge/shared";

export interface SearchResult {
  total_count: number;
  chapters: Array<{
    chapter_id: string;
    chapter_title: string;
    matches: SearchMatch[];
  }>;
}
