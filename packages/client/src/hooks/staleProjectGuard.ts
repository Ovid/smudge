import type { ProjectWithChapters } from "@smudge/shared";

/**
 * "Has the user navigated to a different project since this operation started?"
 *
 * Call at handler entry, BEFORE the await; call the returned predicate after it
 * and bail on true. Every post-await state write and every user-visible banner
 * in a project-scoped async handler needs this — EditorPage stays mounted
 * across project navigation, so an A→B switch mid-request is routine, not
 * exotic.
 *
 * The guard combines two checks, and both are needed:
 *
 *  1. **Project id** captured at start vs `projectRef.current?.id` now. The id
 *     is stable across a rename and changes only on cross-project navigation
 *     AFTER the new project finishes loading — so this distinguishes a rename
 *     (keep the response) from completed cross-project nav (discard it).
 *  2. **Slug, compared two ways** — against the slug captured at start AND
 *     against `projectRef.current?.slug`. Check 1 cannot see the window between
 *     the URL slug changing and loadProject completing: `projectRef` still
 *     holds the old project's id, so id equality passes. In that window
 *     `projectSlugRef` has already advanced to the new URL slug while
 *     `projectRef.slug` still holds the old one, which is what this catches.
 *
 * Check 1 covers post-load cross-nav, check 2 covers pre-load cross-nav, and
 * neither covers what the other does.
 *
 * S8 (dedup review 2026-07-26): this closure existed at nine sites, four of
 * them at the WEAKER id-only strength — missing check 2 — despite
 * useChapterCrud spelling out above its own copy that both checks are required.
 * One of the four also carried a dead arm: it guarded `startedForProjectId !==
 * undefined` over a value typed as a non-optional string. In the pre-load
 * window a failed status change, rename or delete could therefore surface
 * project A's dismissible action banner over loading project B, and nothing
 * clears it on project change (EditorPage is not keyed on slug). Extracting the
 * predicate closes the strength gap as a side effect — which is the point:
 * nine copies is how four of them drifted to the weaker form unnoticed.
 */
export function makeStaleProjectGuard(
  projectRef: { readonly current: Pick<ProjectWithChapters, "id" | "slug"> | null },
  projectSlugRef: { readonly current: string | null | undefined },
): () => boolean {
  const startedForProjectId = projectRef.current?.id;
  const startedForSlug = projectSlugRef.current;

  return () => {
    // Undefined at start means there was no loaded project to drift away from.
    if (startedForProjectId !== undefined && projectRef.current?.id !== startedForProjectId) {
      return true;
    }
    return (
      projectSlugRef.current !== startedForSlug &&
      projectSlugRef.current !== projectRef.current?.slug
    );
  };
}
