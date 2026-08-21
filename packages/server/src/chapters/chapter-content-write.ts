import { countWords } from "@smudge/shared";
import { applyImageRefDiff } from "../images/images.references";
import type { ProjectStore } from "../stores/project-store.types";

/**
 * Write new content to a chapter inside an open transaction, keeping the three
 * things that must move together in one call: the content itself, the word
 * count for it, and the image reference-count diff between the old and new
 * content.
 *
 * **Caller obligation, not a guarantee this helper makes.** `nextContent` (the
 * bytes stored) and `nextDoc` (the document counted) are independent
 * parameters; nothing here asserts they describe the same document or derives
 * one from the other. Co-locating the two reads is all this helper does for
 * that pairing. The two-parameter shape is deliberate — `replaceInProject`
 * needs the serialized bytes *before* the call for its
 * `MAX_CHAPTER_CONTENT_BYTES` check, and `restoreSnapshot` must store the
 * snapshot's exact stored bytes rather than a re-serialization — so the
 * agreement is enforced by each caller, at each caller.
 *
 * The coupling is the point (architecture finding F-03). Writing content
 * without re-running {@link applyImageRefDiff} leaves `reference_count`
 * describing the previous revision, so the gallery labels a still-used image
 * "unused" (`ImageGallery.tsx`) until `deleteImage`'s live chapter scan
 * corrects the count. It is NOT a data-loss path: `reapOrphanImages` deletes
 * only files with no DB row and never reads `reference_count`, and the delete
 * gate scans chapter content live rather than trusting the counter. Writing
 * content without recounting words leaves `word_count` describing the previous
 * revision, which the dashboard and velocity snapshots then report as the
 * writer's progress.
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
 *
 *                 Nothing in the type system enforces that, and the sibling
 *                 helper extracted from these same two call sites carries the
 *                 same warning (`auto-snapshot.ts`, S9): the ROOT store from
 *                 `getProjectStore()` satisfies this `Pick<…>` exactly as well
 *                 as a tx-scoped one, and `isTransactionScoped` is private so
 *                 it never crosses the type boundary. The parameter is named
 *                 `txStore` because it MUST be one — call this only from
 *                 inside `store.transaction(...)`, with the `txStore` that
 *                 transaction handed you. Passed the root store from *inside*
 *                 a transaction, the two calls below queue behind the caller's
 *                 own connection until `acquireConnectionTimeout` (60s, knex's
 *                 sqlite pool is `{max:1}`). Passed it from *outside* one — the
 *                 likelier mistake, since nothing stalls — `updateChapter` and
 *                 `applyImageRefDiff` autocommit separately, so a failure
 *                 between them leaves the content new and `reference_count`
 *                 stale (a mislabelled gallery badge, self-healed at delete
 *                 time; see the coupling note above).
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
    /**
     * The document `word_count` is computed from. The caller must ensure this
     * is the same document `nextContent` serializes — see the caller-obligation
     * note above. Unchecked here.
     */
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
