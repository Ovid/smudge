import { countWords } from "@smudge/shared";
import { applyImageRefDiff } from "../images/images.references";
import type { ProjectStore } from "../stores/project-store.types";

/**
 * Write new content to a chapter inside an open transaction, keeping the three
 * things that must move together in one call: the content itself, the word
 * count derived from it, and the image reference-count diff between the old and
 * new content.
 *
 * The coupling is the point (architecture finding F-03). Writing content
 * without re-running {@link applyImageRefDiff} leaves an image referenced by the
 * chapter but counted as unreferenced, so the reaper garbage-collects a picture
 * that is still on the page; writing it without recounting leaves `word_count`
 * describing the previous revision, which the dashboard and velocity snapshots
 * then report as the writer's progress.
 *
 * Deliberately NOT included, because they are not uniform across callers:
 * - **The project `updated_at` bump.** `restoreSnapshot` bumps once per chapter,
 *   but `replaceInProject` bumps once per *replace*, outside its per-chapter
 *   loop. Folding it in here would silently convert the latter to per-chapter;
 *   `search.service.test.ts` ("bumps the project's updated_at exactly once, not
 *   once per chapter") fails if that happens.
 * - **The pre-write auto-snapshot** (`insertAutoSnapshotIfChanged`) and the
 *   in-transaction re-read, which differ per caller.
 * - **The post-commit velocity snapshot**, which by definition runs after the
 *   transaction this executes inside — see `fireDailySnapshot`.
 *
 * `chapters.service.updateChapter` deliberately does not use this helper: its
 * content is optional and travels in the same `updateChapter` call as title and
 * status, so routing it through here would turn one UPDATE into two.
 *
 * @param txStore  A transaction-scoped store. Must be inside an open transaction —
 *                 the content write and the reference-count adjustment have to
 *                 commit or roll back together.
 */
export async function writeChapterContent(
  txStore: Pick<ProjectStore, "updateChapter" | "incrementImageReferenceCount" | "findImagesByIds">,
  args: {
    chapterId: string;
    projectId: string;
    /** Content currently stored for the chapter; null for a never-saved chapter. */
    previousContent: string | null;
    /** The new content, already serialized — the exact bytes to store. */
    nextContent: string;
    /** The same document as `nextContent`, parsed. Word count is derived from it. */
    nextDoc: Record<string, unknown>;
    now: string;
  },
): Promise<void> {
  await txStore.updateChapter(args.chapterId, {
    content: args.nextContent,
    word_count: countWords(args.nextDoc),
    updated_at: args.now,
  });
  await applyImageRefDiff(txStore, args.previousContent, args.nextContent, args.projectId);
}
