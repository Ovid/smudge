import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError } from "../errors";
import type { MappedError } from "../errors/apiErrorMapper";
import type { AbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { makeStaleProjectGuard } from "./staleProjectGuard";
import type { StaleProjectRef, StaleProjectSlugRef } from "./staleProjectGuard";

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
 * The `project` argument is the baseline: if the ref has already moved on, or
 * the user navigates to a different project mid-flight, the return is
 * `{ kind: "stale" }` so the caller bails out cleanly.
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
  projectRef: StaleProjectRef,
  projectSlugRef: StaleProjectSlugRef,
  trashOp: AbortableAsyncOperation,
): Promise<RefreshTrashResult> {
  // I4 (agentic-review 2026-08-05): the OPERATION's project is the baseline.
  // makeStaleProjectGuard reads its baseline off `projectRef.current` at
  // construction, so it only reproduces the pre-S8 semantics when the ref still
  // agrees with the argument. confirmDeleteChapter awaits the delete before
  // calling here, so it can already have advanced to B while `project` — and
  // therefore the slug this GET asks for — is still A: both guard checks then
  // pass and A's deleted chapters paint into B's trash view. Reconciling the two
  // up front keeps the full-strength guard AND the argument-based baseline.
  if (projectRef.current?.id !== project.id) return { kind: "stale" };
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
