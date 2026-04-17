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
  const [chapterReloadKey, setChapterReloadKey] = useState(0);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [projectTitleError, setProjectTitleError] = useState<string | null>(null);
  const [chapterWordCount, setChapterWordCount] = useState(0);
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);
  const [cacheWarning, setCacheWarning] = useState(false);
  const activeChapterRef = useRef<Chapter | null>(null);
  activeChapterRef.current = activeChapter;
  // Tracks the most recent content per chapter id (updated by handleContentChange).
  // Retries inside handleSave re-read from this ref so a backoff that resumes
  // after the user has kept typing posts the new content rather than silently
  // discarding it when clearCachedContent runs on success.
  const latestContentRef = useRef<{ id: string; content: Record<string, unknown> } | null>(null);
  const projectSlugRef = useRef(slug);
  if (project?.slug !== undefined) {
    projectSlugRef.current = project.slug;
  }
  const selectChapterSeqRef = useRef(0);
  const saveSeqRef = useRef(0);
  const saveAbortRef = useRef<AbortController | null>(null);
  const statusChangeSeqRef = useRef(0);

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
        console.warn("Failed to load project:", err);
        if (cancelled) return;
        setError(STRINGS.error.loadProjectFailed);
      }
    }

    loadProject();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleSave = useCallback(async (content: Record<string, unknown>): Promise<boolean> => {
    const current = activeChapterRef.current;
    if (!current) return false;
    const savingChapterId = current.id;
    // Seed the latest-content ref so the first attempt posts the caller's content.
    // Subsequent keystrokes during backoff replace this via handleContentChange.
    latestContentRef.current = { id: savingChapterId, content };
    const seq = ++saveSeqRef.current;
    // AbortController lets cancelPendingSaves actually abort an in-flight
    // PATCH — without this, a retry could land on the server after a
    // subsequent snapshot restore and overwrite it.
    // Also: abort any prior in-flight save before issuing a new one. Debounce
    // and onBlur can fire overlapping saves; without this, two PATCHes can
    // commit out-of-order, regressing persisted content to the older version.
    saveAbortRef.current?.abort();
    const controller = new AbortController();
    saveAbortRef.current = controller;
    const BACKOFF_MS = [2000, 4000, 8000];
    const MAX_RETRIES = BACKOFF_MS.length;

    setSaveStatus("saving");
    setSaveErrorMessage(null);
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (seq !== saveSeqRef.current) return false; // chapter changed, abort retries
      // Re-read latest content each attempt so backoff retries post keystrokes
      // that arrived after the initial call.
      const latest = latestContentRef.current;
      const postedContent = latest && latest.id === savingChapterId ? latest.content : content;
      try {
        const updated = await api.chapters.update(
          savingChapterId,
          { content: postedContent },
          controller.signal,
        );
        if (seq !== saveSeqRef.current) return false; // chapter changed during request
        // Keep activeChapter in sync so that re-mounting the editor
        // (e.g. after toggling Preview → Editor) uses the latest content.
        if (activeChapterRef.current?.id === savingChapterId) {
          setActiveChapter((prev) =>
            prev ? { ...prev, content: postedContent, word_count: updated.word_count } : prev,
          );
        }
        setProject((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((c) =>
              c.id === savingChapterId
                ? { ...c, word_count: updated.word_count, content: postedContent }
                : c,
            ),
          };
        });
        // Only clear the localStorage cache if no newer content has arrived
        // since we started this attempt. Otherwise the pending typing would
        // be dropped.
        const stillLatest =
          latestContentRef.current?.id === savingChapterId &&
          latestContentRef.current.content === postedContent;
        if (stillLatest) {
          clearCachedContent(savingChapterId);
          setCacheWarning(false);
        }
        if (activeChapterRef.current?.id === savingChapterId) {
          setSaveStatus(stillLatest ? "saved" : "unsaved");
        }
        if (saveAbortRef.current === controller) saveAbortRef.current = null;
        return true;
      } catch (err) {
        // Aborted: cancelPendingSaves intentionally cancelled this save
        // (e.g. before a snapshot restore). Exit cleanly without flagging
        // an error to the user.
        if (err instanceof ApiRequestError && err.code === "ABORTED") {
          return false;
        }
        if (err instanceof ApiRequestError && err.status >= 400 && err.status < 500) {
          console.warn("Save failed with 4xx:", err);
          break;
        }
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
        }
      }
    }
    if (saveAbortRef.current === controller) saveAbortRef.current = null;
    if (activeChapterRef.current?.id === savingChapterId) {
      setSaveStatus("error");
      setSaveErrorMessage(STRINGS.editor.saveFailed);
    }
    return false;
  }, []);

  const handleContentChange = useCallback((content: Record<string, unknown>) => {
    setChapterWordCount(countWords(content));
    // Don't overwrite "error" — the persistent save failure indicator must stay visible
    // until a new save attempt succeeds (the debounced save will retry automatically).
    setSaveStatus((prev) => (prev === "error" ? "error" : "unsaved"));
    if (activeChapterRef.current) {
      latestContentRef.current = { id: activeChapterRef.current.id, content };
      const cached = setCachedContent(activeChapterRef.current.id, content);
      setCacheWarning(!cached);
    }
  }, []);

  const handleCreateChapter = useCallback(async () => {
    const slug = projectSlugRef.current;
    if (!slug) return;
    ++saveSeqRef.current; // cancel any in-flight save retries for the old chapter
    setSaveStatus("idle");
    setSaveErrorMessage(null);
    setCacheWarning(false);
    try {
      const newChapter = await api.chapters.create(slug);
      setActiveChapter(newChapter);
      setChapterWordCount(0);
      setProject((prev) => (prev ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev));
    } catch (err) {
      console.warn("Failed to create chapter:", err);
      setError(STRINGS.error.createChapterFailed);
    }
  }, []);

  const handleSelectChapter = useCallback(async (chapterId: string) => {
    if (activeChapterRef.current && chapterId === activeChapterRef.current.id) return;
    ++saveSeqRef.current; // cancel any in-flight save retries for the old chapter
    setSaveStatus("idle");
    setCacheWarning(false);
    const seq = ++selectChapterSeqRef.current;
    try {
      const chapter = await api.chapters.get(chapterId);
      if (seq !== selectChapterSeqRef.current) return; // superseded by a newer selection
      const cached = getCachedContent(chapterId);
      const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
      setActiveChapter(effectiveChapter);
      setChapterWordCount(countWords(effectiveChapter.content));
    } catch (err) {
      console.warn("Failed to load chapter:", err);
      if (seq !== selectChapterSeqRef.current) return;
      setError(STRINGS.error.loadChapterFailed);
    }
  }, []);

  const reloadActiveChapter = useCallback(async () => {
    const current = activeChapterRef.current;
    if (!current) return;
    // Clear any client-side cached content so the server copy wins after a restore/replace
    clearCachedContent(current.id);
    ++saveSeqRef.current;
    setSaveStatus("idle");
    setCacheWarning(false);
    const seq = ++selectChapterSeqRef.current;
    try {
      const chapter = await api.chapters.get(current.id);
      if (seq !== selectChapterSeqRef.current) return;
      setActiveChapter(chapter);
      setChapterWordCount(countWords(chapter.content));
      // Bump reload key so the Editor remounts with fresh server content
      setChapterReloadKey((k) => k + 1);
    } catch (err) {
      console.warn("Failed to reload chapter:", err);
      if (seq !== selectChapterSeqRef.current) return;
      setError(STRINGS.error.loadChapterFailed);
    }
  }, []);

  const projectRef = useRef(project);
  projectRef.current = project;

  const handleDeleteChapter = useCallback(
    async (chapter: Chapter, onError?: (message: string) => void): Promise<boolean> => {
      ++saveSeqRef.current; // cancel any in-flight save retries for the deleted chapter
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
        return true;
      } catch (err) {
        console.warn("Failed to delete chapter:", err);
        onError?.(STRINGS.error.deleteChapterFailed);
        return false;
      }
    },
    [],
  );

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
      console.warn("Failed to reorder chapters:", err);
      setError(STRINGS.error.reorderFailed);
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
        console.warn("Failed to update project title:", err);
        // Don't call setError — that triggers the full-page error overlay.
        // Returning undefined keeps the title edit mode open so the user can retry.
        setProjectTitleError(STRINGS.error.updateTitleFailed);
        return undefined;
      }
    },
    [],
  );

  const handleStatusChange = useCallback(
    async (chapterId: string, status: string, onError?: (message: string) => void) => {
      const seq = ++statusChangeSeqRef.current;
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
      } catch {
        if (seq !== statusChangeSeqRef.current) return; // newer call owns state
        // Revert by reloading from server, falling back to local revert
        let reverted = false;
        const slug = projectSlugRef.current;
        if (slug) {
          try {
            const data = await api.projects.get(slug);
            const revertedChapter = data.chapters.find((c) => c.id === chapterId);
            if (revertedChapter) {
              // Surgically revert only the status field to avoid overwriting
              // concurrent optimistic updates (reorder, rename, create).
              setProject((prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  chapters: prev.chapters.map((c) =>
                    c.id === chapterId ? { ...c, status: revertedChapter.status } : c,
                  ),
                };
              });
              setActiveChapter((prev) =>
                prev?.id === chapterId ? { ...prev, status: revertedChapter.status } : prev,
              );
              reverted = true;
            }
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
        // Status change failures are non-fatal — the revert already restored consistent state.
        // Call the optional onError callback for the caller to display (e.g., as a dismissible banner),
        // rather than setError which triggers the full-page error overlay.
        onError?.(STRINGS.error.statusChangeFailed);
      }
    },
    [],
  );

  const handleRenameChapter = useCallback(
    async (chapterId: string, title: string, onError?: (message: string) => void) => {
      try {
        await api.chapters.update(chapterId, { title });
        if (activeChapterRef.current?.id === chapterId) {
          // Only update the title — don't overwrite content with stale server data.
          // The editor holds the current truth (same principle as handleSave).
          // Guard with ID check to prevent applying title to wrong chapter on rapid switch.
          setActiveChapter((prev) => (prev?.id === chapterId ? { ...prev, title } : prev));
        }
        setProject((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            chapters: prev.chapters.map((c) => (c.id === chapterId ? { ...c, title } : c)),
          };
        });
      } catch (err) {
        console.warn("Failed to rename chapter:", err);
        // Don't call setError — that triggers the full-page error overlay.
        // Rename failures are non-fatal; surface via the optional callback
        // so callers can display inline (same pattern as handleStatusChange).
        onError?.(STRINGS.error.renameChapterFailed);
      }
    },
    [],
  );

  return {
    project,
    error,
    projectTitleError,
    setProjectTitleError,
    setProject,
    activeChapter,
    chapterReloadKey,
    saveStatus,
    saveErrorMessage,
    cacheWarning,
    chapterWordCount,
    handleSave,
    handleContentChange,
    handleCreateChapter,
    handleSelectChapter,
    reloadActiveChapter,
    handleDeleteChapter,
    handleReorderChapters,
    handleUpdateProjectTitle,
    handleRenameChapter,
    handleStatusChange,
    // Getter for reading the current active chapter from inside async
    // callbacks whose closure would otherwise see a stale value.
    getActiveChapter: () => activeChapterRef.current,
    // Cancel any in-flight save retries. Used before entering snapshot
    // view mode so a retry from earlier typing cannot write to the server
    // while the editor is supposed to be read-only.
    cancelPendingSaves: () => {
      ++saveSeqRef.current;
      // Abort the in-flight PATCH if any so a stale retry cannot land on
      // the server after a subsequent snapshot restore.
      if (saveAbortRef.current) {
        saveAbortRef.current.abort();
        saveAbortRef.current = null;
      }
      // Reset status to idle so the header doesn't stay on "Saving…".
      // The aborted save's own status-write is guarded by the chapter/seq
      // check and short-circuits, so without this reset the UI would
      // remain stuck until another save cycle completes.
      setSaveStatus((prev) => (prev === "saving" ? "idle" : prev));
      setSaveErrorMessage(null);
    },
  };
}
