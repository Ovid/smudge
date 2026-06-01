import { useState } from "react";
import type { Chapter } from "@smudge/shared";
import { useInlineTitleEditing } from "./useInlineTitleEditing";

export function useChapterTitleEditing(
  activeChapter: Chapter | null,
  handleRenameChapter: (
    id: string,
    title: string,
    onError?: (message: string) => void,
  ) => Promise<void>,
  // I1: All chapter-title PATCH entry points share the busy gate so no second
  // entry point slips past during a 2–14s save backoff or in-flight replace.
  isActionBusy: () => boolean,
  // I2: A title PATCH during the lock-banner window would race a possibly-
  // committed restore/replace — the fragility the lock banner exists to prevent.
  isEditorLocked: () => boolean,
) {
  const [titleError, setTitleError] = useState<string | null>(null);

  const inline = useInlineTitleEditing<true>(
    activeChapter?.id,
    activeChapter?.title,
    // Adapt the onError-callback save into the unified onSave contract:
    // undefined ⇒ failure (keep edit mode open), true ⇒ success.
    async (id, title) => {
      let failed = false;
      await handleRenameChapter(id, title, (message) => {
        setTitleError(message);
        failed = true;
      });
      return failed ? undefined : true;
    },
    { isActionBusy, isEditorLocked },
    { clearError: () => setTitleError(null) },
  );

  return {
    editingTitle: inline.editing,
    titleDraft: inline.draft,
    setTitleDraft: inline.setDraft,
    titleError,
    titleInputRef: inline.inputRef,
    startEditingTitle: inline.start,
    saveTitle: inline.save,
    cancelEditingTitle: inline.cancel,
  };
}
