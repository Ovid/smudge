import type { ProjectWithChapters } from "@smudge/shared";
import { useInlineTitleEditing } from "./useInlineTitleEditing";

export function useProjectTitleEditing(
  project: ProjectWithChapters | null,
  slug: string | undefined,
  handleUpdateProjectTitle: (title: string) => Promise<string | undefined>,
  setProjectTitleError: (error: string | null) => void,
  navigate: (path: string, options?: { replace: boolean }) => void,
  // I4: Renaming the project rewrites the slug; gating on the busy latch keeps
  // an in-flight replace's old-slug closure from racing the new slug. S7:
  // required, not optional — a caller omitting it would disable the guard.
  isActionBusy: () => boolean,
  // I2: A project-title PATCH during the lock-banner window races a possibly-
  // committed restore/replace — gate here alongside isActionBusy.
  isEditorLocked: () => boolean,
) {
  const inline = useInlineTitleEditing<string>(
    project?.id,
    project?.title,
    (_id, title) => handleUpdateProjectTitle(title),
    { isActionBusy, isEditorLocked },
    {
      // C3: refuse if the URL slug has drifted ahead of loaded project state.
      // project is non-null whenever this runs: the shared hook's empty-id
      // guard (currentId = project?.id) returns before driftCheck when project
      // is null, so project?.slug here is always the loaded project's slug.
      driftCheck: () => project?.slug !== slug,
      onAfterSave: (newSlug) => {
        if (newSlug !== slug) {
          navigate(`/projects/${newSlug}`, { replace: true });
        }
      },
      clearError: () => setProjectTitleError(null),
    },
  );

  return {
    editingProjectTitle: inline.editing,
    projectTitleDraft: inline.draft,
    setProjectTitleDraft: inline.setDraft,
    projectTitleInputRef: inline.inputRef,
    startEditingProjectTitle: inline.start,
    saveProjectTitle: inline.save,
    cancelEditingProjectTitle: inline.cancel,
  };
}
