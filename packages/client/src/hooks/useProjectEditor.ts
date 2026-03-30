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
  const activeChapterRef = useRef<Chapter | null>(null);
  const projectSlugRef = useRef(project?.slug);

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
      const BACKOFF_MS = [2000, 4000, 8000];
      const MAX_RETRIES = 3;

      setSaveStatus("saving");
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const updated = await api.chapters.update(savingChapterId, { content });
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
          setSaveStatus("saved");
          return true;
        } catch (err) {
          if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) break;
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
          }
        }
      }
      setSaveStatus("error");
      return false;
    },
    [activeChapter],
  );

  const handleContentChange = useCallback(
    (content: Record<string, unknown>) => {
      setChapterWordCount(countWords(content));
      setSaveStatus("unsaved");
      if (activeChapter) {
        setCachedContent(activeChapter.id, content);
      }
    },
    [activeChapter],
  );

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

  const handleSelectChapter = useCallback(
    async (chapterId: string) => {
      if (activeChapter && chapterId === activeChapter.id) return;
      try {
        const chapter = await api.chapters.get(chapterId);
        const cached = getCachedContent(chapterId);
        const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
        setActiveChapter(effectiveChapter);
        setChapterWordCount(countWords(effectiveChapter.content));
      } catch (err) {
        setError(err instanceof Error ? err.message : STRINGS.error.loadChapterFailed);
      }
    },
    [activeChapter],
  );

  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const handleDeleteChapter = useCallback(
    async (chapter: Chapter) => {
      try {
        await api.chapters.delete(chapter.id);
        // Compute remaining from the ref (current state), not the stale closure
        const remaining = projectRef.current?.chapters.filter((c) => c.id !== chapter.id) ?? [];
        setProject((prev) => {
          if (!prev) return prev;
          return { ...prev, chapters: prev.chapters.filter((c) => c.id !== chapter.id) };
        });

        // If deleting the active chapter, switch to the first remaining
        if (activeChapter?.id === chapter.id) {
          const first = remaining[0];
          if (first) {
            const ch = await api.chapters.get(first.id);
            setActiveChapter(ch);
            setChapterWordCount(countWords(ch.content));
          } else {
            setActiveChapter(null);
            setChapterWordCount(0);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : STRINGS.error.deleteChapterFailed);
      }
    },
    [activeChapter],
  );

  const handleReorderChapters = useCallback(async (orderedIds: string[]) => {
    const slug = projectSlugRef.current;
    if (!slug) return;
    try {
      await api.projects.reorderChapters(slug, orderedIds);
      setProject((prev) => {
        if (!prev) return prev;
        const reordered = orderedIds
          .map((id) => prev.chapters.find((c) => c.id === id))
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
        const message =
          err instanceof Error ? err.message : STRINGS.error.updateTitleFailed;
        setProjectTitleError(message);
        return undefined;
      }
    },
    [],
  );

  const handleStatusChange = useCallback(
    async (chapterId: string, status: string) => {
      // Optimistic update
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, status } : c)),
        };
      });
      try {
        await api.chapters.update(chapterId, { status });
      } catch {
        // Revert by reloading from server
        const slug = projectSlugRef.current;
        if (slug) {
          try {
            const data = await api.projects.get(slug);
            setProject(data);
          } catch {
            // If reload also fails, leave optimistic state
          }
        }
      }
    },
    [],
  );

  const handleRenameChapter = useCallback(
    async (chapterId: string, title: string) => {
      try {
        await api.chapters.update(chapterId, { title });
        if (activeChapter?.id === chapterId) {
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
    },
    [activeChapter],
  );

  return {
    project,
    error,
    projectTitleError,
    setProjectTitleError,
    setProject,
    activeChapter,
    saveStatus,
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
