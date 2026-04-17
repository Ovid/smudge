import type { SearchResult as SharedSearchResult } from "@smudge/shared";

/**
 * Server-extended SearchResult: adds skipped_chapter_ids for chapters
 * that couldn't be parsed. The public wire shape in @smudge/shared
 * already marks this field optional.
 */
export type SearchResult = SharedSearchResult & {
  skipped_chapter_ids?: string[];
};
