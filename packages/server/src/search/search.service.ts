import { v4 as uuidv4 } from "uuid";
import {
  searchInDoc,
  replaceInDoc,
  countWords,
  assertSafeRegexPattern,
  RegExpSafetyError,
  MAX_MATCHES_PER_REQUEST,
} from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { getVelocityService } from "../velocity/velocity.injectable";
import { logger } from "../logger";
import { applyImageRefDiff } from "../images/images.references";
import type { SearchResult } from "./search.types";

/**
 * Truncate a user-supplied string for display in a snapshot label:
 *   - strip control chars (other than tab) which corrupt logs and UI;
 *   - truncate by grapheme (not code unit) to avoid splitting surrogate
 *     pairs or combining sequences.
 */
function truncateForLabel(s: string, max = 30): string {
  const cleaned = s.replace(/[\u0000-\u0008\u000A-\u001F\u007F]/g, "");
  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  if (!segmenter) {
    return cleaned.length > max ? cleaned.slice(0, max) + "..." : cleaned;
  }
  const graphemes: string[] = [];
  for (const { segment } of segmenter.segment(cleaned)) {
    graphemes.push(segment);
    if (graphemes.length > max) break;
  }
  if (graphemes.length > max) {
    return graphemes.slice(0, max).join("") + "...";
  }
  return cleaned;
}

class MatchCapExceeded extends Error {
  constructor() {
    super(`Too many matches (>${MAX_MATCHES_PER_REQUEST}); refine your search.`);
    this.name = "MatchCapExceeded";
  }
}

function validatePattern(
  pattern: string,
  regexMode: boolean | undefined,
): { validationError: string } | null {
  if (!regexMode) return null;
  try {
    assertSafeRegexPattern(pattern);
    new RegExp(pattern);
  } catch (e) {
    if (e instanceof RegExpSafetyError) return { validationError: e.message };
    return { validationError: (e as Error).message };
  }
  return null;
}

export async function searchProject(
  projectId: string,
  query: string,
  options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
): Promise<SearchResult | null | { validationError: string }> {
  const regexError = validatePattern(query, options?.regex);
  if (regexError) return regexError;

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  const chapters = await store.listChapterContentByProject(projectId);
  const result: SearchResult = { total_count: 0, chapters: [], skipped_chapter_ids: [] };

  for (const chapter of chapters) {
    if (!chapter.content) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(chapter.content);
    } catch {
      logger.warn(
        { chapter_id: chapter.id, project_id: projectId },
        "Skipping chapter with corrupt JSON during search",
      );
      result.skipped_chapter_ids!.push(chapter.id);
      continue;
    }

    const matches = searchInDoc(parsed, query, options);
    if (matches.length > 0) {
      result.total_count += matches.length;
      if (result.total_count > MAX_MATCHES_PER_REQUEST) {
        return {
          validationError: `Too many matches (>${MAX_MATCHES_PER_REQUEST}); refine your search.`,
        };
      }
      result.chapters.push({
        chapter_id: chapter.id,
        chapter_title: chapter.title,
        matches,
      });
    }
  }

  if (result.skipped_chapter_ids!.length === 0) {
    delete result.skipped_chapter_ids;
  }
  return result;
}

export async function replaceInProject(
  projectId: string,
  search: string,
  replace: string,
  options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
  scope?: { type: "project" } | { type: "chapter"; chapter_id: string; match_index?: number },
): Promise<
  | {
      replaced_count: number;
      affected_chapter_ids: string[];
      skipped_chapter_ids?: string[];
    }
  | null
  | { validationError: string }
> {
  // Validate regex up front
  const regexError = validatePattern(search, options?.regex);
  if (regexError) return regexError;

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  const txResult = await store.transaction(async (txStore) => {
    // Get chapters to process
    let chapters: Array<{ id: string; title: string; content: string | null; word_count: number }>;

    if (scope?.type === "chapter") {
      const chapter = await txStore.findChapterByIdRaw(scope.chapter_id);
      if (!chapter || chapter.project_id !== projectId) {
        return { replaced_count: 0, affected_chapter_ids: [] };
      }
      chapters = [
        {
          id: chapter.id,
          title: chapter.title,
          content: chapter.content,
          word_count: chapter.word_count,
        },
      ];
    } else {
      chapters = await txStore.listChapterContentByProject(projectId);
    }

    let totalReplaced = 0;
    const affectedIds: string[] = [];
    const skippedIds: string[] = [];

    for (const chapter of chapters) {
      if (!chapter.content) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(chapter.content);
      } catch {
        logger.warn(
          { chapter_id: chapter.id, project_id: projectId },
          "Skipping chapter with corrupt JSON during replace",
        );
        skippedIds.push(chapter.id);
        continue;
      }

      const replaceOptions =
        scope?.type === "chapter" && typeof scope.match_index === "number"
          ? { ...options, match_index: scope.match_index }
          : options;
      const { doc: newDoc, count } = replaceInDoc(parsed, search, replace, replaceOptions);
      if (count === 0) continue;

      totalReplaced += count;
      if (totalReplaced > MAX_MATCHES_PER_REQUEST) {
        throw new MatchCapExceeded();
      }
      affectedIds.push(chapter.id);

      const label = `Before find-and-replace: '${truncateForLabel(search)}' → '${truncateForLabel(replace)}'`;

      // Auto-snapshot before replacement (using DB-committed word_count)
      await txStore.insertSnapshot({
        id: uuidv4(),
        chapter_id: chapter.id,
        label,
        content: chapter.content,
        word_count: chapter.word_count,
        is_auto: true,
        created_at: new Date().toISOString(),
      });

      // Update chapter content
      const newContentJson = JSON.stringify(newDoc);
      const newWordCount = countWords(newDoc);
      const now = new Date().toISOString();

      await txStore.updateChapter(chapter.id, {
        content: newContentJson,
        word_count: newWordCount,
        updated_at: now,
      });

      // Adjust image reference counts
      await applyImageRefDiff(txStore, chapter.content, newContentJson);
    }

    // Bump the project's updated_at once per replace, not once per chapter
    if (affectedIds.length > 0) {
      await txStore.updateProjectTimestamp(projectId, new Date().toISOString());
    }

    return {
      replaced_count: totalReplaced,
      affected_chapter_ids: affectedIds,
      skipped_chapter_ids: skippedIds,
    };
  }).catch((err) => {
    if (err instanceof MatchCapExceeded) {
      return { validationError: err.message } as const;
    }
    throw err;
  });

  if ("validationError" in txResult) return txResult;

  // Fire velocity side-effects after the transaction commits
  if (txResult.affected_chapter_ids.length > 0) {
    try {
      const svc = getVelocityService();
      await svc.recordSave(projectId);
    } catch (err: unknown) {
      logger.error(
        { err, project_id: projectId },
        "Velocity recordSave failed after replace (best-effort)",
      );
    }
  }

  const final = {
    replaced_count: txResult.replaced_count,
    affected_chapter_ids: txResult.affected_chapter_ids,
    ...(txResult.skipped_chapter_ids && txResult.skipped_chapter_ids.length > 0
      ? { skipped_chapter_ids: txResult.skipped_chapter_ids }
      : {}),
  };
  return final;
}
