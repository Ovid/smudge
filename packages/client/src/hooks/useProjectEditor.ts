import { useEffect, useState, useCallback, useRef } from "react";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { countWords } from "@smudge/shared";
import { api, ApiRequestError } from "../api/client";
import { getCachedContent, setCachedContent, clearCachedContent } from "./useContentCache";
import { STRINGS } from "../strings";

export type SaveStatus = "idle" | "unsaved" | "saving" | "saved" | "error";

export function useProjectEditor(slug: string | undefined) {
  const [project, setProject] = useState<ProjectWithChapters | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [projectTitleError, setProjectTitleError] = useState<string | null>(null);
  const [chapterWordCount, setChapterWordCount] = useState(0);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const activeChapterRef = useRef<Chapter | null>(null);
  const projectSlugRef = useRef(project?.slug);
  const selectChapterSeqRef = useRef(0);
  const saveSeqRef = useRef(0);

  // Keep ref in sync for use in loadProject's closure
  useEffect(() => {
    activeChapterRef.current = activeChapter;
  }, [activeChapter]);

  useEffect(() => {
    projectSlugRef.current = project?.slug;
  }, [project?.slug]);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      if (!slug) return;
      try {
        const data = await api.projects.get(slug);
        if (cancelled) return;
        setProject(data);
        const firstChapter = data.chapters[0];
        if (firstChapter && !activeChapterRef.current) {
          const chapter = await api.chapters.get(firstChapter.id);
          if (cancelled) return;
          const cached = getCachedContent(chapter.id);
          const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
          setActiveChapter(effectiveChapter);
          setChapterWordCount(countWords(effectiveChapter.content));
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : STRINGS.error.loadProjectFailed);
      }
    }

    loadProject();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleSave = useCallback(
    async (content: Record<string, unknown>): Promise<boolean> => {
      if (!activeChapter) return false;
      const savingChapterId = activeChapter.id;
      const seq = ++saveSeqRef.current;
      const BACKOFF_MS = [2000, 4000, 8000];
      const MAX_RETRIES = 3;

      setSaveStatus("saving");
      setSaveErrorMessage(null);
      let lastError: unknown;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        if (seq !== saveSeqRef.current) return false; // chapter changed, abort retries
        try {
          const updated = await api.chapters.update(savingChapterId, { content });
          if (seq !== saveSeqRef.current) return false; // chapter changed during request
          // Don't call setActiveChapter — the editor holds the current truth.
          // Only sync the server-computed word_count into project.chapters.
          setProject((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              chapters: prev.chapters.map((c) =>
                c.id === savingChapterId ? { ...c, word_count: updated.word_count, content } : c,
              ),
            };
          });
          clearCachedContent(savingChapterId);
          if (activeChapterRef.current?.id === savingChapterId) {
            setSaveStatus("saved");
          }
          return true;
        } catch (err) {
          lastError = err;
          if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
            break;
          }
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
          }
        }
      }
      if (activeChapterRef.current?.id === savingChapterId) {
        setSaveStatus("error");
        setSaveErrorMessage(
          lastError instanceof Error ? lastError.message : STRINGS.editor.saveFailed,
        );
      }
      return false;
    },
    [activeChapter],
  );

  const handleContentChange = useCallback((content: Record<string, unknown>) => {
    setChapterWordCount(countWords(content));
    // Don't overwrite "error" — the persistent save failure indicator must stay visible
    // until a new save attempt succeeds (the debounced save will retry automatically).
    setSaveStatus((prev) => (prev === "error" ? "error" : "unsaved"));
    if (activeChapterRef.current) {
      setCachedContent(activeChapterRef.current.id, content);
    }
  }, []);

  const handleCreateChapter = useCallback(async () => {
    const slug = projectSlugRef.current;
    if (!slug) return;
    try {
      const newChapter = await api.chapters.create(slug);
      setActiveChapter(newChapter);
      setChapterWordCount(0);
      setProject((prev) => (prev ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev));
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.createChapterFailed);
    }
  }, []);

  const handleSelectChapter = useCallback(async (chapterId: string) => {
    if (activeChapterRef.current && chapterId === activeChapterRef.current.id) return;
    ++saveSeqRef.current; // cancel any in-flight save retries for the old chapter
    setSaveStatus("idle");
    const seq = ++selectChapterSeqRef.current;
    try {
      const chapter = await api.chapters.get(chapterId);
      if (seq !== selectChapterSeqRef.current) return; // superseded by a newer selection
      const cached = getCachedContent(chapterId);
      const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
      setActiveChapter(effectiveChapter);
      setChapterWordCount(countWords(effectiveChapter.content));
    } catch (err) {
      if (seq !== selectChapterSeqRef.current) return;
      setError(err instanceof Error ? err.message : STRINGS.error.loadChapterFailed);
    }
  }, []);

  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const handleDeleteChapter = useCallback(async (chapter: Chapter) => {
    try {
      await api.chapters.delete(chapter.id);
      clearCachedContent(chapter.id);
      // Compute remaining from the ref (current state), not the stale closure
      const remaining = projectRef.current?.chapters.filter((c) => c.id !== chapter.id) ?? [];
      setProject((prev) => {
        if (!prev) return prev;
        return { ...prev, chapters: prev.chapters.filter((c) => c.id !== chapter.id) };
      });

      // If deleting the active chapter, switch to the first remaining
      if (activeChapterRef.current?.id === chapter.id) {
        const first = remaining[0];
        if (first) {
          try {
            const ch = await api.chapters.get(first.id);
            setActiveChapter(ch);
            setChapterWordCount(countWords(ch.content));
          } catch {
            // Secondary fetch failed — fall through to empty state
            setActiveChapter(null);
            setChapterWordCount(0);
          }
        } else {
          setActiveChapter(null);
          setChapterWordCount(0);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.deleteChapterFailed);
    }
  }, []);

  const handleReorderChapters = useCallback(async (orderedIds: string[]) => {
    const slug = projectSlugRef.current;
    if (!slug) return;
    try {
      await api.projects.reorderChapters(slug, orderedIds);
      setProject((prev) => {
        if (!prev) return prev;
        const reordered = orderedIds
          .map((id, index) => {
            const ch = prev.chapters.find((c) => c.id === id);
            return ch ? { ...ch, sort_order: index } : undefined;
          })
          .filter(Boolean) as Chapter[];
        return { ...prev, chapters: reordered };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.reorderFailed);
    }
  }, []);

  const handleUpdateProjectTitle = useCallback(
    async (title: string): Promise<string | undefined> => {
      const slug = projectSlugRef.current;
      if (!slug) return undefined;
      setProjectTitleError(null);
      try {
        const updated = await api.projects.update(slug, { title });
        projectSlugRef.current = updated.slug;
        setProject((prev) => (prev ? { ...prev, title: updated.title, slug: updated.slug } : prev));
        return updated.slug;
      } catch (err) {
        // Don't call setError — that triggers the full-page error overlay.
        // Returning undefined keeps the title edit mode open so the user can retry.
        const message = err instanceof Error ? err.message : STRINGS.error.updateTitleFailed;
        setProjectTitleError(message);
        return undefined;
      }
    },
    [],
  );

  const handleStatusChange = useCallback(async (chapterId: string, status: string) => {
    // Save previous status for revert
    const previousStatus = projectRef.current?.chapters.find((c) => c.id === chapterId)?.status;

    // Optimistic update
    setProject((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, status } : c)),
      };
    });
    // Guard all setActiveChapter updaters with ID check to prevent applying
    // status to the wrong chapter if the user rapidly switches chapters.
    setActiveChapter((prev) => (prev?.id === chapterId ? { ...prev, status } : prev));
    try {
      await api.chapters.update(chapterId, { status });
    } catch (err) {
      // Revert by reloading from server, falling back to local revert
      let reverted = false;
      const slug = projectSlugRef.current;
      if (slug) {
        try {
          const data = await api.projects.get(slug);
          setProject(data);
          const revertedChapter = data.chapters.find((c) => c.id === chapterId);
          if (revertedChapter) {
            setActiveChapter((prev) =>
              prev?.id === chapterId ? { ...prev, status: revertedChapter.status } : prev,
            );
          }
          reverted = true;
        } catch {
          // Reload failed — fall through to local revert
        }
      }
      if (!reverted && previousStatus !== undefined) {
        setProject((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((c) =>
              c.id === chapterId ? { ...c, status: previousStatus } : c,
            ),
          };
        });
        setActiveChapter((prev) =>
          prev?.id === chapterId ? { ...prev, status: previousStatus } : prev,
        );
      }
      // Return error message for the caller to display (e.g., as a dismissible banner).
      // Unlike other handlers that use setError (full-page overlay), status change
      // failures are non-fatal — the revert already restored consistent state.
      return err instanceof Error ? err.message : STRINGS.error.statusChangeFailed;
    }
    return undefined;
  }, []);

  const handleRenameChapter = useCallback(async (chapterId: string, title: string) => {
    try {
      await api.chapters.update(chapterId, { title });
      if (activeChapterRef.current?.id === chapterId) {
        // Only update the title — don't overwrite content with stale server data.
        // The editor holds the current truth (same principle as handleSave).
        setActiveChapter((prev) => (prev ? { ...prev, title } : prev));
      }
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, title } : c)),
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : STRINGS.error.renameChapterFailed);
    }
  }, []);

  return {
    project,
    error,
    projectTitleError,
    setProjectTitleError,
    setProject,
    activeChapter,
    saveStatus,
    saveErrorMessage,
    chapterWordCount,
    handleSave,
    handleContentChange,
    handleCreateChapter,
    handleSelectChapter,
    handleDeleteChapter,
    handleReorderChapters,
    handleUpdateProjectTitle,
    handleRenameChapter,
    handleStatusChange,
  };
}
