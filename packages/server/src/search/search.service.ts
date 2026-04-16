import { v4 as uuidv4 } from "uuid";
import { searchInDoc, replaceInDoc, countWords } from "@smudge/shared";
import { getProjectStore } from "../stores/project-store.injectable";
import { applyImageRefDiff } from "../images/images.references";
import type { SearchResult } from "./search.types";

export async function searchProject(
  projectId: string,
  query: string,
  options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
): Promise<SearchResult | null> {
  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  const chapters = await store.listChapterContentByProject(projectId);
  const result: SearchResult = { total_count: 0, chapters: [] };

  for (const chapter of chapters) {
    if (!chapter.content) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(chapter.content);
    } catch {
      // Corrupt JSON — skip
      continue;
    }

    const matches = searchInDoc(parsed, query, options);
    if (matches.length > 0) {
      result.total_count += matches.length;
      result.chapters.push({
        chapter_id: chapter.id,
        chapter_title: chapter.title,
        matches,
      });
    }
  }

  return result;
}

export async function replaceInProject(
  projectId: string,
  search: string,
  replace: string,
  options?: { case_sensitive?: boolean; whole_word?: boolean; regex?: boolean },
  scope?: { type: "project" } | { type: "chapter"; chapter_id: string },
): Promise<
  { replaced_count: number; affected_chapter_ids: string[] } | null | { validationError: string }
> {
  // Validate regex up front
  if (options?.regex) {
    try {
      new RegExp(search);
    } catch (e) {
      return { validationError: (e as Error).message };
    }
  }

  const store = getProjectStore();
  const project = await store.findProjectById(projectId);
  if (!project) return null;

  return store.transaction(async (txStore) => {
    // Get chapters to process
    let chapters: Array<{ id: string; title: string; content: string | null }>;

    if (scope?.type === "chapter") {
      const chapter = await txStore.findChapterByIdRaw(scope.chapter_id);
      if (!chapter || chapter.deleted_at) {
        return { replaced_count: 0, affected_chapter_ids: [] };
      }
      chapters = [{ id: chapter.id, title: chapter.title, content: chapter.content }];
    } else {
      chapters = await txStore.listChapterContentByProject(projectId);
    }

    let totalReplaced = 0;
    const affectedIds: string[] = [];

    for (const chapter of chapters) {
      if (!chapter.content) continue;

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(chapter.content);
      } catch {
        continue;
      }

      const { doc: newDoc, count } = replaceInDoc(parsed, search, replace, options);
      if (count === 0) continue;

      totalReplaced += count;
      affectedIds.push(chapter.id);

      // Truncate label parts to keep it readable
      const truncSearch = search.length > 30 ? search.slice(0, 30) + "..." : search;
      const truncReplace = replace.length > 30 ? replace.slice(0, 30) + "..." : replace;
      const label = `Before find-and-replace: '${truncSearch}' → '${truncReplace}'`;

      // Auto-snapshot before replacement
      await txStore.insertSnapshot({
        id: uuidv4(),
        chapter_id: chapter.id,
        label,
        content: chapter.content,
        word_count: countWords(parsed),
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

      await txStore.updateProjectTimestamp(projectId, now);

      // Adjust image reference counts
      await applyImageRefDiff(txStore, chapter.content, newContentJson);
    }

    return { replaced_count: totalReplaced, affected_chapter_ids: affectedIds };
  });
}
