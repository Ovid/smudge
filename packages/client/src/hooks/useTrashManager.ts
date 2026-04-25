import { useState, useCallback, useEffect, useRef } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError } from "../errors";

export interface UseTrashManagerOptions {
  // C2 (review 2026-04-25): wire through to useProjectEditor's
  // seedConfirmedStatus so a chapter restored via this hook seeds the
  // cache that handleStatusChange's local-revert fallback reads. Without
  // it, a later status PATCH on the restored row double-failing would
  // skip the local revert and leave the optimistic status on screen.
  seedConfirmedStatus?: (id: string, status: string) => void;
}

export function useTrashManager(
  project: ProjectWithChapters | null,
  slug: string | undefined,
  setProject: (updater: (prev: ProjectWithChapters | null) => ProjectWithChapters | null) => void,
  handleDeleteChapter: (chapter: Chapter, onError?: (message: string) => void) => Promise<boolean>,
  navigate: (path: string, options?: { replace: boolean }) => void,
  options?: UseTrashManagerOptions,
) {
  const seedConfirmedStatusRef = useRef(options?.seedConfirmedStatus);
  useEffect(() => {
    seedConfirmedStatusRef.current = options?.seedConfirmedStatus;
  }, [options?.seedConfirmedStatus]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedChapters, setTrashedChapters] = useState<Chapter[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // I5 (review 2026-04-24): api.projects.trash now accepts a signal.
  // Abort any prior in-flight trash fetch before issuing a new one
  // (rapid openTrash clicks) and on unmount so the browser drops the
  // request rather than setState-ing into a torn-down hook. Gate
  // console.error on !aborted to uphold the zero-warnings invariant.
  const trashAbortRef = useRef<AbortController | null>(null);
  // User callout (2026-04-25 review): handleRestore had no
  // cancellation/unmount guard (unlike openTrash). If the hook's
  // owner unmounts (navigation / chapter switch) while
  // api.chapters.restore() is in flight, the catch path could log
  // and setState on a torn-down hook. Mirror the trashAbortRef
  // pattern: one controller per restore call, threaded into
  // api.chapters.restore, aborted on the next call AND on unmount.
  const restoreAbortRef = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      trashAbortRef.current?.abort();
      restoreAbortRef.current?.abort();
    },
    [],
  );

  const openTrash = useCallback(async () => {
    if (!project) return;
    trashAbortRef.current?.abort();
    const controller = new AbortController();
    trashAbortRef.current = controller;
    try {
      const trashed = await api.projects.trash(project.slug, controller.signal);
      if (controller.signal.aborted) return;
      setTrashedChapters(trashed);
      setTrashOpen(true);
    } catch (err) {
      if (controller.signal.aborted) return;
      const { message } = mapApiError(err, "trash.load");
      // message:null for ABORTED — skip both the log and the banner.
      if (message === null) return;
      console.error("Failed to load trash:", err);
      setActionError(message);
    }
  }, [project]);

  const handleRestore = useCallback(
    async (chapterId: string) => {
      // User callout (2026-04-25): abort any prior in-flight restore
      // and install the controller on the shared ref so the unmount
      // cleanup can sever a mid-flight restore. Threading the signal
      // into api.chapters.restore makes the abort propagate to the
      // network layer, not just gate the client-side response handler.
      restoreAbortRef.current?.abort();
      const controller = new AbortController();
      restoreAbortRef.current = controller;
      try {
        const restored = await api.chapters.restore(chapterId, controller.signal);
        if (controller.signal.aborted) return;
        if (restoreAbortRef.current === controller) restoreAbortRef.current = null;
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
        // C2 (review 2026-04-25): seed the confirmed-status cache for
        // the restored chapter so a later status PATCH that double-fails
        // (PATCH + recovery GET) can fall back to the actual server-truth
        // baseline rather than silently skipping the revert.
        seedConfirmedStatusRef.current?.(restored.id, restored.status);
        // If the slug changed (project was also restored), update the URL
        if (restored.project_slug && restored.project_slug !== slug) {
          navigate(`/projects/${restored.project_slug}`, { replace: true });
        }
      } catch (err) {
        if (restoreAbortRef.current === controller) restoreAbortRef.current = null;
        // User callout (2026-04-25): unmount/supersession abort stays
        // silent. Without this guard the catch would log and setState
        // on a torn-down hook, polluting test output (CLAUDE.md zero-
        // warnings invariant) and risking React's setState-on-unmount
        // warning.
        if (controller.signal.aborted) return;
        const { message, possiblyCommitted } = mapApiError(err, "trash.restoreChapter");
        // ABORTED returns message: null. Skip log + state update so a
        // late abort does not surface noise.
        if (message === null) return;
        console.error("Failed to restore chapter:", err);
        // I2 (2026-04-24 review) + S8 (2026-04-24 review): on a
        // committed-but-unreadable response (2xx BAD_JSON or 500
        // RESTORE_READ_FAILURE) the server actually restored the
        // chapter — the client just doesn't have the hydrated row.
        // Optimistically remove it from the trash list so the user
        // doesn't retry (retry would hit 409 RESTORE_CONFLICT, the
        // slug is already present) and surface a committed-specific
        // message. The scope's `committedCodes: ["RESTORE_READ_FAILURE"]`
        // means the mapper now sets possiblyCommitted=true for that
        // code too, so the call site doesn't need the inline code
        // check — adding a new committed-intent code in the future
        // only touches the scope definition.
        if (possiblyCommitted) {
          setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
        }
        setActionError(message);
      }
    },
    [slug, setProject, navigate],
  );

  const confirmDeleteChapter = useCallback(async () => {
    if (!deleteTarget) return;
    setActionError(null);
    let success: boolean;
    try {
      success = await handleDeleteChapter(deleteTarget, (message) => {
        setActionError(message);
      });
    } catch {
      // Unexpected throw — dismiss dialog so the user isn't stuck.
      setDeleteTarget(null);
      return;
    }
    setDeleteTarget(null);
    if (!success) return;
    if (trashOpen && project) {
      // S4 + S5 (review 2026-04-25): thread a signal so an unmount
      // between the successful delete and the trash refresh drops the
      // GET cleanly (was risking setTrashedChapters on a torn-down
      // hook), and route the catch through mapApiError so a non-
      // ABORTED failure surfaces an actionable banner instead of being
      // silently swallowed by `catch {}`. ABORTED stays silent
      // (mapper returns message: null).
      trashAbortRef.current?.abort();
      const controller = new AbortController();
      trashAbortRef.current = controller;
      try {
        const trashed = await api.projects.trash(project.slug, controller.signal);
        if (controller.signal.aborted) return;
        setTrashedChapters(trashed);
      } catch (err) {
        if (controller.signal.aborted) return;
        const { message } = mapApiError(err, "trash.load");
        if (message) setActionError(message);
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
