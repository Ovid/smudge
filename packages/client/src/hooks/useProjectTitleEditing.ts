import { useState, useRef, useEffect } from "react";
import type { ProjectWithChapters } from "@smudge/shared";

export function useProjectTitleEditing(
  project: ProjectWithChapters | null,
  slug: string | undefined,
  handleUpdateProjectTitle: (title: string) => Promise<string | undefined>,
  setProjectTitleError: (error: string | null) => void,
  navigate: (path: string, options?: { replace: boolean }) => void,
) {
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const projectTitleInputRef = useRef<HTMLInputElement>(null);
  const projectEscapePressedRef = useRef(false);
  const isSavingProjectTitleRef = useRef(false);

  // Cancel editing if the project changes to prevent saving the draft to the wrong project.
  // Set escapePressedRef so the blur handler (fired when the input unmounts)
  // does not attempt to save the stale draft to the new project.
  useEffect(() => {
    projectEscapePressedRef.current = true;
    setEditingProjectTitle(false);
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
