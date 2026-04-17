import { v4 as uuidv4 } from "uuid";
import {
  searchInDoc,
  replaceInDoc,
  buildRegex,
  countWords,
  assertSafeRegexPattern,
  RegExpSafetyError,
  RegExpTimeoutError,
  MatchCapExceededError,
  MAX_MATCHES_PER_REQUEST,
} from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { getVelocityService } from "../velocity/velocity.injectable";
import { logger } from "../logger";
import { applyImageRefDiff } from "../images/images.references";
import type { SearchResult } from "./search.types";

/**
 * Hard wall-clock budget for a single search/replace request. Bounds the
 * event-loop time a single pathological pattern can consume, even if
 * assertSafeRegexPattern lets a ReDoS shape through. Chosen conservatively
 * — legitimate project-wide searches on large books finish well under this.
 */
const REGEX_DEADLINE_MS = 2_000;

/** Distinct codes for 400 responses so the client can show specific copy. */
export const SEARCH_ERROR_CODES = {
  INVALID_REGEX: "INVALID_REGEX",
  MATCH_CAP_EXCEEDED: "MATCH_CAP_EXCEEDED",
  REGEX_TIMEOUT: "REGEX_TIMEOUT",
} as const;
export type SearchErrorCode = (typeof SEARCH_ERROR_CODES)[keyof typeof SEARCH_ERROR_CODES];

export interface SearchValidationError {
  validationError: string;
  code: SearchErrorCode;
}

/**
 * Truncate a user-supplied string for display in a snapshot label:
 *   - strip control chars (other than tab) which corrupt logs and UI;
 *   - truncate by grapheme (not code unit) to avoid splitting surrogate
 *     pairs or combining sequences.
 */
function truncateForLabel(s: string, max = 30): string {
  // eslint-disable-next-line no-control-regex -- intentionally strips control chars
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

function validatePattern(
  pattern: string,
  options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
): SearchValidationError | null {
  if (!options?.regex) return null;
  try {
    assertSafeRegexPattern(pattern);
    // Compile with the SAME flags / wrapper that runtime will use, so a
    // pattern that is valid sans-`u` but invalid with `u` (e.g. `\p{L}`,
    // `\u{...}`, identity escapes) is caught here as a 400 rather than
    // surfacing later as a 500 from inside the search loop.
    buildRegex(pattern, options);
  } catch (e) {
    if (e instanceof RegExpSafetyError) {
      return { validationError: e.message, code: SEARCH_ERROR_CODES.INVALID_REGEX };
    }
    return {
      validationError: (e as Error).message,
      code: SEARCH_ERROR_CODES.INVALID_REGEX,
    };
  }
  return null;
}

function matchCapValidationError(): SearchValidationError {
  return {
    validationError: `Too many matches (>${MAX_MATCHES_PER_REQUEST}); refine your search.`,
    code: SEARCH_ERROR_CODES.MATCH_CAP_EXCEEDED,
  };
}

function regexTimeoutValidationError(): SearchValidationError {
  return {
    validationError: `Search timed out after ${REGEX_DEADLINE_MS}ms; refine your pattern.`,
    code: SEARCH_ERROR_CODES.REGEX_TIMEOUT,
  };
}

export async function searchProject(
  projectId: string,
  query: string,
  options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
): Promise<SearchResult | null | SearchValidationError> {
  const regexError = validatePattern(query, options);
  if (regexError) return regexError;

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  const chapters = await store.listChapterContentByProject(projectId);
  const skippedIds: string[] = [];
  const result: SearchResult = { total_count: 0, chapters: [] };
  const deadline = Date.now() + REGEX_DEADLINE_MS;

  for (const chapter of chapters) {
    if (!chapter.content) continue;
    if (Date.now() > deadline) return regexTimeoutValidationError();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(chapter.content);
    } catch {
      logger.warn(
        { chapter_id: chapter.id, project_id: projectId },
        "Skipping chapter with corrupt JSON during search",
      );
      skippedIds.push(chapter.id);
      continue;
    }

    let matches;
    try {
      matches = searchInDoc(parsed, query, { ...options, deadline });
    } catch (err) {
      if (err instanceof MatchCapExceededError) return matchCapValidationError();
      if (err instanceof RegExpTimeoutError) return regexTimeoutValidationError();
      throw err;
    }
    if (matches.length > 0) {
      result.total_count += matches.length;
      if (result.total_count > MAX_MATCHES_PER_REQUEST) {
        return matchCapValidationError();
      }
      result.chapters.push({
        chapter_id: chapter.id,
        chapter_title: chapter.title,
        matches,
      });
    }
  }

  if (skippedIds.length > 0) result.skipped_chapter_ids = skippedIds;
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
  | SearchValidationError
> {
  // Validate regex up front
  const regexError = validatePattern(search, options);
  if (regexError) return regexError;

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  const txResult = await store
    .transaction(async (txStore) => {
      // Get chapters to process
      let chapters: Array<{
        id: string;
        title: string;
        content: string | null;
        word_count: number;
      }>;

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
      const deadline = Date.now() + REGEX_DEADLINE_MS;

      for (const chapter of chapters) {
        if (!chapter.content) continue;
        if (Date.now() > deadline) {
          throw new RegExpTimeoutError(REGEX_DEADLINE_MS);
        }

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

        const replaceOptions = {
          ...(scope?.type === "chapter" && typeof scope.match_index === "number"
            ? { ...options, match_index: scope.match_index }
            : options),
          deadline,
        };
        const { doc: newDoc, count } = replaceInDoc(parsed, search, replace, replaceOptions);
        if (count === 0) continue;

        totalReplaced += count;
        if (totalReplaced > MAX_MATCHES_PER_REQUEST) {
          throw new MatchCapExceededError(MAX_MATCHES_PER_REQUEST);
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
    })
    .catch((err): SearchValidationError | never => {
      if (err instanceof MatchCapExceededError) {
        return matchCapValidationError();
      }
      if (err instanceof RegExpTimeoutError) {
        return regexTimeoutValidationError();
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
