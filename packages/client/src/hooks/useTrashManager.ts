import { useState, useCallback } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api } from "../api/client";
import { STRINGS } from "../strings";

export function useTrashManager(
  project: ProjectWithChapters | null,
  slug: string | undefined,
  setProject: (updater: (prev: ProjectWithChapters | null) => ProjectWithChapters | null) => void,
  handleDeleteChapter: (chapter: Chapter) => Promise<boolean>,
  navigate: (path: string, options?: { replace: boolean }) => void,
) {
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedChapters, setTrashedChapters] = useState<Chapter[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const openTrash = useCallback(async () => {
    if (!project) return;
    try {
      const trashed = await api.projects.trash(project.slug);
      setTrashedChapters(trashed);
      setTrashOpen(true);
    } catch (err) {
      console.error("Failed to load trash:", err);
      setActionError(err instanceof Error ? err.message : STRINGS.error.loadTrashFailed);
    }
  }, [project]);

  const handleRestore = useCallback(
    async (chapterId: string) => {
      try {
        const restored = await api.chapters.restore(chapterId);
        setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
        setProject((prev) => {
          if (!prev) return prev;
          const updatedProject = {
            ...prev,
            chapters: [...prev.chapters, restored].sort((a, b) => a.sort_order - b.sort_order),
          };
          // If the restore also restored the parent project with a new slug, update it
          if (restored.project_slug && restored.project_slug !== prev.slug) {
            updatedProject.slug = restored.project_slug;
          }
          return updatedProject;
        });
        // If the slug changed (project was also restored), update the URL
        if (restored.project_slug && restored.project_slug !== slug) {
          navigate(`/projects/${restored.project_slug}`, { replace: true });
        }
      } catch (err) {
        console.error("Failed to restore chapter:", err);
        setActionError(err instanceof Error ? err.message : STRINGS.error.restoreChapterFailed);
      }
    },
    [slug, setProject, navigate],
  );

  const confirmDeleteChapter = useCallback(async () => {
    if (!deleteTarget) return;
    let success: boolean;
    try {
      success = await handleDeleteChapter(deleteTarget);
    } catch {
      // Unexpected throw — dismiss dialog so the user isn't stuck.
      setDeleteTarget(null);
      return;
    }
    if (!success) return;
    setDeleteTarget(null);
    if (trashOpen && project) {
      try {
        const trashed = await api.projects.trash(project.slug);
        setTrashedChapters(trashed);
      } catch {
        // Trash refresh failed — stale list is acceptable
      }
    }
  }, [deleteTarget, handleDeleteChapter, trashOpen, project]);

  return {
    trashOpen,
    setTrashOpen,
    trashedChapters,
    deleteTarget,
    setDeleteTarget,
    actionError,
    setActionError,
    openTrash,
    handleRestore,
    confirmDeleteChapter,
  };
}
