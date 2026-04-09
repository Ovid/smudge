import { useState, useRef } from "react";
import type { Chapter } from "@smudge/shared";

export function useChapterTitleEditing(
  activeChapter: Chapter | null,
  handleRenameChapter: (id: string, title: string, onError?: (message: string) => void) => Promise<void>,
) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);
  const isSavingTitleRef = useRef(false);

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
