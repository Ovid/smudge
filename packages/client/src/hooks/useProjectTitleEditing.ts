import { useState, useRef, useEffect } from "react";
import type { ProjectWithChapters } from "@smudge/shared";

export function useProjectTitleEditing(
  project: ProjectWithChapters | null,
  slug: string | undefined,
  handleUpdateProjectTitle: (title: string) => Promise<string | undefined>,
  setProjectTitleError: (error: string | null) => void,
  navigate: (path: string, options?: { replace: boolean }) => void,
  // I4: Every other editor-affecting mutation entry point (create/delete/
  // rename chapter, status change, reorder, settings, replace, restore)
  // gates on the shared action-busy latch. Renaming the project rewrites
  // projectSlugRef.current synchronously, while in-flight replace callbacks
  // still hold the old slug closure — the POST hits the old URL while
  // finalizeReplaceSuccess's search refresh hits the new one, leaving
  // results inconsistent with the committed replace. Injecting the busy
  // predicate here keeps the gate co-located with the save call instead
  // of wrapping every EditorPage call site.
  //
  // S7: Required (not optional). A test double or future caller that omits
  // the predicate would silently disable this load-bearing guard.
  isActionBusy: () => boolean,
  // I2: A project-title PATCH during the lock-banner window races a
  // possibly-committed restore/replace — the exact save-pipeline violation
  // the lock banner exists to prevent. Gate here alongside isActionBusy.
  isEditorLocked: () => boolean,
) {
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const projectTitleInputRef = useRef<HTMLInputElement>(null);
  const projectEscapePressedRef = useRef(false);
  const isSavingProjectTitleRef = useRef(false);
  const prevProjectIdRef = useRef<string | undefined>(project?.id);

  // Cancel editing if the user navigates to a different project, to prevent
  // saving the draft to the wrong project.  Skip the initial load (undefined →
  // first ID) — there is nothing to cancel and the effect can race with a
  // double-click that enters edit mode before the effect flushes.
  useEffect(() => {
    if (prevProjectIdRef.current !== undefined && prevProjectIdRef.current !== project?.id) {
      projectEscapePressedRef.current = true;
      isSavingProjectTitleRef.current = false;
      setEditingProjectTitle(false);
    }
    prevProjectIdRef.current = project?.id;
  }, [project?.id]);

  function startEditingProjectTitle() {
    if (!project) return;
    projectEscapePressedRef.current = false;
    setProjectTitleError(null);
    setProjectTitleDraft(project.title);
    setEditingProjectTitle(true);
    setTimeout(() => projectTitleInputRef.current?.select(), 0);
  }

  async function saveProjectTitle() {
    if (isSavingProjectTitleRef.current) return;
    if (projectEscapePressedRef.current) {
      setEditingProjectTitle(false);
      return;
    }
    if (!project || !projectTitleDraft.trim()) {
      setEditingProjectTitle(false);
      return;
    }
    // I4/I2: Refuse mid-mutation or while the lock banner is up. Keep edit
    // mode open (do not exit on blur) so the user's typed draft is preserved
    // for retry once the mutation settles — closing here would discard the
    // draft silently.
    if (isActionBusy() || isEditorLocked()) {
      return;
    }
    isSavingProjectTitleRef.current = true;
    try {
      const trimmed = projectTitleDraft.trim();
      if (trimmed !== project.title) {
        const newSlug = await handleUpdateProjectTitle(trimmed);
        if (newSlug === undefined) return; // keep edit mode open on failure
        if (newSlug !== slug) {
          navigate(`/projects/${newSlug}`, { replace: true });
        }
      }
      // Prevent the blur handler (fired when input unmounts) from re-entering saveProjectTitle.
      projectEscapePressedRef.current = true;
      setEditingProjectTitle(false);
    } finally {
      isSavingProjectTitleRef.current = false;
    }
  }

  function cancelEditingProjectTitle() {
    projectEscapePressedRef.current = true;
    setEditingProjectTitle(false);
  }

  return {
    editingProjectTitle,
    projectTitleDraft,
    setProjectTitleDraft,
    projectTitleInputRef,
    startEditingProjectTitle,
    saveProjectTitle,
    cancelEditingProjectTitle,
  };
}
