import { useState, useRef, useEffect } from "react";
import type { Chapter } from "@smudge/shared";

export function useChapterTitleEditing(
  activeChapter: Chapter | null,
  handleRenameChapter: (
    id: string,
    title: string,
    onError?: (message: string) => void,
  ) => Promise<void>,
  // I1: The sidebar rename path wraps handleRenameChapter with an isActionBusy
  // check; the inline-title editor calls saveTitle directly. Injecting the
  // predicate here co-locates the gate with the save call so all chapter-title
  // PATCH entry points share the same contract — no second entry point can
  // slip past during a 2–14s save backoff or in-flight replace.
  isActionBusy: () => boolean,
  // I2: Title PATCHes during the lock banner window would race a possibly-
  // committed restore/replace — the very fragility the lock banner exists
  // to prevent. Gate here alongside isActionBusy.
  isEditorLocked: () => boolean,
) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);
  const isSavingTitleRef = useRef(false);
  const prevChapterIdRef = useRef<string | undefined>(activeChapter?.id);

  // Cancel editing if the active chapter changes (e.g., via keyboard navigation)
  // to prevent saving the draft to the wrong chapter.
  // Set escapePressedRef so the blur handler (fired when the input unmounts)
  // does not attempt to save the stale draft to the new chapter.
  // Skip the initial load (undefined → first ID) — there is nothing to cancel
  // and the effect can race with a double-click that enters edit mode before
  // the effect flushes.
  useEffect(() => {
    if (prevChapterIdRef.current !== undefined && prevChapterIdRef.current !== activeChapter?.id) {
      escapePressedRef.current = true;
      setEditingTitle(false);
      setTitleError(null);
    }
    prevChapterIdRef.current = activeChapter?.id;
  }, [activeChapter?.id]);

  function startEditingTitle() {
    if (!activeChapter) return;
    escapePressedRef.current = false;
    setTitleError(null);
    setTitleDraft(activeChapter.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }

  async function saveTitle() {
    if (isSavingTitleRef.current) return;
    if (escapePressedRef.current) {
      setEditingTitle(false);
      return;
    }
    if (!activeChapter || !titleDraft.trim()) {
      setEditingTitle(false);
      return;
    }
    // I1/I2: Refuse mid-mutation or while the lock banner is up. Keep edit
    // mode open (do not exit on blur) so the user's typed draft is preserved
    // for retry once the mutation settles — closing here would discard it.
    if (isActionBusy() || isEditorLocked()) {
      return;
    }
    isSavingTitleRef.current = true;
    try {
      const trimmed = titleDraft.trim();
      if (trimmed !== activeChapter.title) {
        let failed = false;
        await handleRenameChapter(activeChapter.id, trimmed, (message) => {
          setTitleError(message);
          failed = true;
        });
        if (failed) return; // keep edit mode open so user can retry
      }
      // Prevent the blur handler (fired when input unmounts) from re-entering saveTitle.
      escapePressedRef.current = true;
      setEditingTitle(false);
    } finally {
      isSavingTitleRef.current = false;
    }
  }

  function cancelEditingTitle() {
    escapePressedRef.current = true;
    setEditingTitle(false);
  }

  return {
    editingTitle,
    titleDraft,
    setTitleDraft,
    titleError,
    titleInputRef,
    startEditingTitle,
    saveTitle,
    cancelEditingTitle,
  };
}
