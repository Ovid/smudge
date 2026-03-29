import { useEffect, useState, useCallback, useRef } from "react";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { countWords } from "@smudge/shared";
import { api } from "../api/client";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useProjectEditor(projectId: string | undefined) {
  const [project, setProject] = useState<ProjectWithChapters | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [chapterWordCount, setChapterWordCount] = useState(0);
  const activeChapterRef = useRef<Chapter | null>(null);

  // Keep ref in sync for use in loadProject's closure
  useEffect(() => {
    activeChapterRef.current = activeChapter;
  }, [activeChapter]);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      if (!projectId) return;
      try {
        const data = await api.projects.get(projectId);
        if (cancelled) return;
        setProject(data);
        const firstChapter = data.chapters[0];
        if (firstChapter && !activeChapterRef.current) {
          const chapter = await api.chapters.get(firstChapter.id);
          if (cancelled) return;
          setActiveChapter(chapter);
          setChapterWordCount(countWords(chapter.content));
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load project");
      }
    }

    loadProject();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleSave = useCallback(
    async (content: Record<string, unknown>) => {
      if (!activeChapter) return;
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
                c.id === savingChapterId ? { ...c, word_count: updated.word_count } : c,
              ),
            };
          });
          setSaveStatus("saved");
          return;
        } catch {
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
          }
        }
      }
      setSaveStatus("error");
    },
    [activeChapter],
  );

  const handleContentChange = useCallback((content: Record<string, unknown>) => {
    setChapterWordCount(countWords(content));
  }, []);

  const handleCreateChapter = useCallback(async () => {
    if (!projectId) return;
    const newChapter = await api.chapters.create(projectId);
    setActiveChapter(newChapter);
    setChapterWordCount(0);
    setProject((prev) => (prev ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev));
  }, [projectId]);

  const handleSelectChapter = useCallback(
    async (chapterId: string) => {
      if (!activeChapter || chapterId === activeChapter.id) return;
      const chapter = await api.chapters.get(chapterId);
      setActiveChapter(chapter);
      setChapterWordCount(countWords(chapter.content));
    },
    [activeChapter],
  );

  const handleDeleteChapter = useCallback(
    async (chapter: Chapter) => {
      await api.chapters.delete(chapter.id);
      const remaining = project?.chapters.filter((c) => c.id !== chapter.id) ?? [];
      setProject((prev) => {
        if (!prev) return prev;
        return { ...prev, chapters: remaining };
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
    },
    [activeChapter, project],
  );

  const handleReorderChapters = useCallback(
    async (orderedIds: string[]) => {
      if (!projectId) return;
      await api.projects.reorderChapters(projectId, orderedIds);
      setProject((prev) => {
        if (!prev) return prev;
        const reordered = orderedIds
          .map((id) => prev.chapters.find((c) => c.id === id))
          .filter(Boolean) as Chapter[];
        return { ...prev, chapters: reordered };
      });
    },
    [projectId],
  );

  const handleUpdateProjectTitle = useCallback(
    async (title: string) => {
      if (!project) return;
      await api.projects.update(project.id, { title });
      setProject((prev) => (prev ? { ...prev, title } : prev));
    },
    [project],
  );

  const handleUpdateChapterTitle = useCallback(
    async (title: string) => {
      if (!activeChapter) return;
      const updated = await api.chapters.update(activeChapter.id, { title });
      setActiveChapter(updated);
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chapters: prev.chapters.map((c) => (c.id === updated.id ? { ...c, title } : c)),
        };
      });
    },
    [activeChapter],
  );

  const handleRenameChapter = useCallback(
    async (chapterId: string, title: string) => {
      const updated = await api.chapters.update(chapterId, { title });
      if (activeChapter?.id === chapterId) {
        setActiveChapter(updated);
      }
      setProject((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, title } : c)),
        };
      });
    },
    [activeChapter],
  );

  return {
    project,
    error,
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
    handleUpdateChapterTitle,
    handleRenameChapter,
  };
}
