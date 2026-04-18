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
  SEARCH_ERROR_CODES,
  sanitizeSnapshotLabel,
} from "@smudge/shared";
import type { SearchErrorCode } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { truncateGraphemes } from "../utils/grapheme";
import { MAX_CHAPTER_CONTENT_BYTES } from "../constants";
import { getVelocityService } from "../velocity/velocity.injectable";
import { logger } from "../logger";
import { applyImageRefDiff } from "../images/images.references";
import type { SearchResult } from "@smudge/shared";

/**
 * Hard wall-clock budget for a single search/replace request. Bounds the
 * event-loop time a single pathological pattern can consume, even if
 * assertSafeRegexPattern lets a ReDoS shape through. Chosen conservatively
 * — legitimate project-wide searches on large books finish well under this.
 */
const REGEX_DEADLINE_MS = 2_000;

/**
 * Upper bound on the serialized TipTap JSON a single chapter may reach
 * after a replacement pass. Re-exported from ../constants so search and
 * snapshots share the same source of truth as the Express body limit.
 * Guards against amplification via `$'` / `` $` `` in regex replacements:
 * these splice the entire right/left side of each match into the output,
 * so a short template can blow up stored content by orders of magnitude
 * even when the raw replacement string is well under MAX_REPLACE_LENGTH.
 */
export { MAX_CHAPTER_CONTENT_BYTES };

// Re-export from @smudge/shared so existing `import { SEARCH_ERROR_CODES }
// from "..../search.service"` call sites continue to work while the canonical
// definition lives in shared.
export { SEARCH_ERROR_CODES };
export type { SearchErrorCode };

export interface SearchValidationError {
  validationError: string;
  code: SearchErrorCode;
}

/**
 * Truncate a user-supplied string for display in a snapshot label:
 *   - strip via the shared sanitizer (C0/C1 controls, DEL, bidi overrides,
 *     line/paragraph separators) so auto-snapshot labels cannot spoof
 *     display in the snapshot list;
 *   - truncate by grapheme (not code unit) to avoid splitting surrogate
 *     pairs or combining sequences.
 */
function truncateForLabel(s: string, max = 30): string {
  const cleaned = sanitizeSnapshotLabel(s);
  const truncated = truncateGraphemes(cleaned, max);
  return truncated.length < cleaned.length ? truncated + "..." : cleaned;
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

function contentTooLargeValidationError(): SearchValidationError {
  return {
    validationError:
      "Replacement would produce chapter content over the size limit; refine your replacement.",
    code: SEARCH_ERROR_CODES.CONTENT_TOO_LARGE,
  };
}

/**
 * Thrown inside the replace transaction when a chapter's serialized
 * content would exceed MAX_CHAPTER_CONTENT_BYTES. Caught at the tx
 * boundary and converted to a 400 response. Caught by value, so the
 * transaction rolls back and no partial replacements persist.
 */
class ContentTooLargeError extends Error {
  constructor() {
    super("Replacement produces content over the size cap");
    this.name = "ContentTooLargeError";
  }
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
  | "scope_not_found"
  | SearchValidationError
> {
  // Validate regex up front
  const regexError = validatePattern(search, options);
  if (regexError) return regexError;

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  type TxSuccess = {
    replaced_count: number;
    affected_chapter_ids: string[];
    skipped_chapter_ids?: string[];
  };
  const txResult = await store
    .transaction<TxSuccess | "scope_not_found">(async (txStore) => {
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
          // Signal 404 so the caller can distinguish "wrong project" /
          // "soft-deleted chapter" from "zero matches". Returning 0
          // replacements here silently masks client integration bugs.
          return "scope_not_found";
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

        // Run the auto-label through the same sanitize + 500-char clamp
        // pipeline that CreateSnapshotSchema applies to manual labels. The
        // truncateForLabel helper already sanitizes its argument, but the
        // surrounding template text is authored here; a future change to
        // the template could silently exceed the column cap without this
        // backstop.
        const rawLabel = `Before find-and-replace: '${truncateForLabel(search)}' → '${truncateForLabel(replace)}'`;
        const sanitizedLabel = sanitizeSnapshotLabel(rawLabel).slice(0, 500);
        const label = sanitizedLabel;

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

        // Update chapter content — guard against amplification (`$'` / `$\``
        // in regex replacements can splice the full match context repeatedly)
        // before writing; the tx will roll back cleanly on throw.
        const newContentJson = JSON.stringify(newDoc);
        if (Buffer.byteLength(newContentJson, "utf8") > MAX_CHAPTER_CONTENT_BYTES) {
          throw new ContentTooLargeError();
        }
        const newWordCount = countWords(newDoc);
        const now = new Date().toISOString();

        await txStore.updateChapter(chapter.id, {
          content: newContentJson,
          word_count: newWordCount,
          updated_at: now,
        });

        // Adjust image reference counts
        await applyImageRefDiff(txStore, chapter.content, newContentJson, projectId);
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
      if (err instanceof ContentTooLargeError) {
        return contentTooLargeValidationError();
      }
      throw err;
    });

  if (typeof txResult === "string") {
    // "scope_not_found" — chapter scope points at a different project or
    // is soft-deleted. Distinct from a missing project so the route can
    // surface a chapter-specific 404 rather than "Project not found."
    return "scope_not_found";
  }
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
