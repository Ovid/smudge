import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError } from "../errors";
import type { MappedError } from "../errors/apiErrorMapper";
import type { AbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { makeStaleProjectGuard } from "./staleProjectGuard";

export type RefreshTrashResult =
  | { kind: "ok"; trashed: Chapter[] }
  | { kind: "aborted" }
  | { kind: "stale" }
  | { kind: "error"; mapped: MappedError<"trash.load"> };

/**
 * Fetch the trash list for a project, applying the same I2 drift-guard +
 * abort + stale + error pipeline that openTrash and the confirmDeleteChapter
 * post-delete refresh need. Callers own their state writes; the helper owns
 * the pipeline.
 *
 * `projectRef.current` is captured at entry; if the user navigates to a
 * different project mid-flight, the return is `{ kind: "stale" }` so the
 * caller bails out cleanly.
 *
 * S8 (dedup review 2026-07-26): the drift guard was a local id-only copy, and
 * its `startedForProjectId !== undefined` arm was DEAD — it guarded
 * `project.id`, a non-optional string. It now uses the shared full-strength
 * guard, which also covers the pre-load window the id check cannot see; that
 * needs the caller's slug ref, hence the new parameter.
 *
 * Pushback Issue 2 (2026-05-27): extracted to its own file so the unit
 * test imports it directly rather than threading through useTrashManager's
 * public surface.
 */
export async function refreshTrashList(
  project: ProjectWithChapters,
  projectRef: { readonly current: ProjectWithChapters | null },
  projectSlugRef: { readonly current: string | null | undefined },
  trashOp: AbortableAsyncOperation,
): Promise<RefreshTrashResult> {
  const isStaleProject = makeStaleProjectGuard(projectRef, projectSlugRef);
  const { promise, signal } = trashOp.run((s) => api.projects.trash(project.slug, s));
  try {
    const trashed = await promise;
    if (signal.aborted) return { kind: "aborted" };
    if (isStaleProject()) return { kind: "stale" };
    return { kind: "ok", trashed };
  } catch (err) {
    if (signal.aborted) return { kind: "aborted" };
    if (isStaleProject()) return { kind: "stale" };
    return { kind: "error", mapped: mapApiError(err, "trash.load") };
  }
}
