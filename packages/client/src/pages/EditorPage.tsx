import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { ChapterStatusRow } from "@smudge/shared";
import { Editor, type EditorHandle } from "../components/Editor";
import { EditorToolbar } from "../components/EditorToolbar";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { Sidebar } from "../components/Sidebar";
import { TrashView } from "../components/TrashView";
import { PreviewMode } from "../components/PreviewMode";
import { DashboardView } from "../components/DashboardView";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ProjectSettingsDialog } from "../components/ProjectSettingsDialog";
import { ShortcutHelpDialog } from "../components/ShortcutHelpDialog";
import { ExportDialog } from "../components/ExportDialog";
import { ActionErrorBanner } from "../components/ActionErrorBanner";
import { ViewModeNav } from "../components/ViewModeNav";
import { EditorFooter } from "../components/EditorFooter";
import { STRINGS } from "../strings";
import { useProjectEditor } from "../hooks/useProjectEditor";
import { useEditorMutation } from "../hooks/useEditorMutation";
import { useSidebarState } from "../hooks/useSidebarState";
import { useReferencePanelState } from "../hooks/useReferencePanelState";
import { useSnapshotState, type RestoreFailureReason } from "../hooks/useSnapshotState";
import { useFindReplaceState } from "../hooks/useFindReplaceState";
import { ReferencePanel } from "../components/ReferencePanel";
import { SnapshotPanel } from "../components/SnapshotPanel";
import { FindReplacePanel } from "../components/FindReplacePanel";
import { SnapshotBanner } from "../components/SnapshotBanner";
import { ImageGallery } from "../components/ImageGallery";
import { useChapterTitleEditing } from "../hooks/useChapterTitleEditing";
import { useProjectTitleEditing } from "../hooks/useProjectTitleEditing";
import { useTrashManager } from "../hooks/useTrashManager";
import { useKeyboardShortcuts, type ViewMode } from "../hooks/useKeyboardShortcuts";
import { api, ApiRequestError } from "../api/client";
import { mapReplaceErrorToMessage } from "../utils/findReplaceErrors";
import { SEARCH_ERROR_CODES } from "@smudge/shared";
import { Logo } from "../components/Logo";
import { generateHTML } from "@tiptap/html";
import DOMPurify from "dompurify";
import { editorExtensions } from "../editorExtensions";

// Sentinel errors used by the handleRestoreSnapshot mutate callback so the
// useEditorMutation hook surfaces a `stage: "mutate"` result that the caller
// can route to reason-specific copy. `RestoreAbortedError` signals the user
// clicked "Back to editing" during the flush — treat as a silent no-op.
class RestoreAbortedError extends Error {}
class RestoreFailedError extends Error {
  constructor(public readonly reason: RestoreFailureReason) {
    super(`restore failed: ${reason}`);
  }
}

function renderSnapshotContent(content: Record<string, unknown>): string {
  try {
    const html = generateHTML(content as Parameters<typeof generateHTML>[0], editorExtensions);
    return DOMPurify.sanitize(html);
  } catch {
    return `<p>${STRINGS.snapshots.renderError}</p>`;
  }
}

export function EditorPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const {
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
    getActiveChapter,
    cancelPendingSaves,
  } = useProjectEditor(slug);

  const { sidebarWidth, sidebarOpen, handleSidebarResize, toggleSidebar } = useSidebarState();
  const { panelWidth, panelOpen, setPanelOpen, handlePanelResize, togglePanel } =
    useReferencePanelState();

  const {
    snapshotPanelOpen,
    toggleSnapshotPanel,
    setSnapshotPanelOpen,
    viewingSnapshot,
    viewSnapshot,
    exitSnapshotView,
    restoreSnapshot,
    snapshotCount,
    snapshotPanelRef,
    refreshCount: refreshSnapshotCount,
    onSnapshotsChange,
  } = useSnapshotState(activeChapter?.id ?? null);

  const findReplace = useFindReplaceState(slug, project?.id);

  const {
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
  } = useTrashManager(project, slug, setProject, handleDeleteChapter, navigate);

  // Refs on the toolbar buttons so each panel can return focus to its
  // trigger when closed via Escape (WCAG focus management).
  const snapshotsTriggerRef = useRef<HTMLButtonElement>(null);
  const findReplaceTriggerRef = useRef<HTMLButtonElement>(null);

  // Separate from actionError so a partial-success replace (some chapters
  // replaced, some skipped due to corruption) can surface both a positive
  // "replaced N occurrences" banner and a warning about skipped chapters
  // without conflating success with failure.
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  // Read-only lock surfaced when a mutation succeeded server-side but the
  // follow-up reload failed (I1). The Editor is intentionally left
  // setEditable(false) in that case to prevent the user from typing over
  // stale content; this banner is the only persistent user-visible signal
  // of that state, so it must NOT be dismissible. It clears automatically
  // when the Editor is replaced (chapter switch or reload-key bump).
  const [editorLockedMessage, setEditorLockedMessage] = useState<string | null>(null);

  // Snapshot-view ref used by handleRestoreSnapshot to re-check intent after
  // awaiting flushSave — the user may have clicked "Back to editing" during
  // the flush, in which case the restore should not proceed.
  const viewingSnapshotRef = useRef(viewingSnapshot);
  viewingSnapshotRef.current = viewingSnapshot;

  // Editor handle is declared here (above useEditorMutation + the migrated
  // mutation callbacks) so the hook can capture the ref and the callbacks
  // below can read editorRef.current safely.
  const editorRef = useRef<EditorHandle | null>(null);

  // Single useEditorMutation instance shared by handleRestoreSnapshot,
  // executeReplace, and handleReplaceOne. The cross-caller busy-guard
  // depends on a single invocation — do NOT add a second call.
  const mutation = useEditorMutation({
    editorRef,
    projectEditor: {
      cancelPendingSaves,
      reloadActiveChapter,
    },
  });

  // Frozen snapshot of state at the moment the user clicked "Replace All".
  // This prevents the confirmation copy from drifting if the user edits the
  // panel while the dialog is open.
  const [replaceConfirmation, setReplaceConfirmation] = useState<{
    scope: { type: "project" } | { type: "chapter"; chapter_id: string };
    query: string;
    replacement: string;
    options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
    totalCount: number;
    chapterCount: number;
    perChapterCount: number;
  } | null>(null);

  // Panel exclusivity: when snapshot panel opens, close reference panel and vice versa
  const handleToggleSnapshotPanel = useCallback(() => {
    if (!snapshotPanelOpen) {
      setPanelOpen(false);
      findReplace.closePanel();
    }
    toggleSnapshotPanel();
  }, [snapshotPanelOpen, setPanelOpen, findReplace, toggleSnapshotPanel]);

  const handleToggleReferencePanel = useCallback(() => {
    if (!panelOpen) {
      setSnapshotPanelOpen(false);
      exitSnapshotView();
      findReplace.closePanel();
    }
    togglePanel();
  }, [panelOpen, setSnapshotPanelOpen, exitSnapshotView, findReplace, togglePanel]);

  const handleToggleFindReplace = useCallback(() => {
    if (!findReplace.panelOpen) {
      setPanelOpen(false);
      setSnapshotPanelOpen(false);
      exitSnapshotView();
    }
    findReplace.togglePanel();
  }, [findReplace, setPanelOpen, setSnapshotPanelOpen, exitSnapshotView]);

  const handleRestoreSnapshot = useCallback(async () => {
    if (!viewingSnapshot || !activeChapter) return;

    // Clear stale action banners on entry: a previous failure or success
    // banner must not co-display with whatever this restore produces. The
    // two find-replace callers below also do this.
    setActionError(null);
    setActionInfo(null);

    type RestoreData = { staleChapterSwitch: boolean };

    const result = await mutation.run<RestoreData>(async () => {
      // Re-check intent AFTER the hook's flush/markClean: if the user
      // clicked "Back to editing" during the flush window, abort before
      // issuing the server restore. Throwing a sentinel surfaces as
      // stage: "mutate" with a RestoreAbortedError the caller swallows.
      if (!viewingSnapshotRef.current) throw new RestoreAbortedError();
      const restore = await restoreSnapshot(viewingSnapshot.id);
      if (!restore.ok) {
        throw new RestoreFailedError(restore.reason ?? "unknown");
      }
      const stale = Boolean(restore.staleChapterSwitch);
      // On stale-chapter-switch the restore landed on a now-background
      // chapter — skip both the cache clear (useSnapshotState already
      // cleared the restoring chapter's cache) and the active-chapter
      // reload (it would pull the wrong chapter's server state).
      return {
        clearCacheFor: stale ? [] : [activeChapter.id],
        reloadActiveChapter: !stale,
        // Scope the reload to the chapter the restore targets. If the user
        // switches between here and the hook's reload call, the mismatch
        // skips the reload and preserves the now-active chapter's draft.
        reloadChapterId: activeChapter.id,
        data: { staleChapterSwitch: stale },
      };
    });

    if (result.ok) {
      if (!result.data.staleChapterSwitch) {
        snapshotPanelRef.current?.refreshSnapshots();
      }
      return;
    }
    if (result.stage === "busy") {
      // Silent returns turned Restore into a dead-button during the up-to-14s
      // save-retry backoff. Surface a transient info banner so users know
      // their click was received and another operation is running.
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    if (result.stage === "flush") {
      // The fault is the save, not the restore — attribute it correctly.
      setActionError(STRINGS.snapshots.restoreFailedSaveFirst);
      return;
    }
    if (result.stage === "reload") {
      // Server-side restore succeeded; only the follow-up GET failed. The
      // editor stays setEditable(false) (see useEditorMutation reloadFailed
      // path) — surface a persistent, non-dismissible lock banner so the
      // user-visible signal of the read-only state cannot be hidden (I1).
      setEditorLockedMessage(STRINGS.snapshots.restoreSucceededReloadFailed);
      snapshotPanelRef.current?.refreshSnapshots();
      return;
    }
    // stage === "mutate"
    if (result.error instanceof RestoreAbortedError) return;
    if (result.error instanceof RestoreFailedError) {
      if (result.error.reason === "corrupt_snapshot") {
        setActionError(STRINGS.snapshots.restoreFailedCorrupt);
      } else if (result.error.reason === "cross_project_image") {
        setActionError(STRINGS.snapshots.restoreFailedCrossProjectImage);
      } else if (result.error.reason === "not_found") {
        setActionError(STRINGS.snapshots.restoreFailedNotFound);
      } else {
        setActionError(STRINGS.snapshots.restoreFailed);
      }
      return;
    }
    setActionError(STRINGS.snapshots.restoreFailed);
  }, [viewingSnapshot, activeChapter, restoreSnapshot, snapshotPanelRef, setActionError, mutation]);

  const executeReplace = useCallback(
    async (frozen: {
      scope: { type: "project" } | { type: "chapter"; chapter_id: string };
      query: string;
      replacement: string;
      options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
    }) => {
      if (!project || !slug) return;

      // Clear any stale banners so a prior op's error/success cannot
      // co-display with this op's outcome.
      setActionInfo(null);
      setActionError(null);

      type ReplaceData = Awaited<ReturnType<typeof api.search.replace>>;

      const result = await mutation.run<ReplaceData>(async () => {
        const resp = await api.search.replace(
          slug,
          frozen.query,
          frozen.replacement,
          frozen.options,
          frozen.scope,
        );
        // Read the CURRENT active chapter (not the closure value) so a
        // chapter switch between click and response still reloads when the
        // now-active chapter was affected.
        const current = getActiveChapter();
        const reload = !!current && resp.affected_chapter_ids.includes(current.id);
        return {
          clearCacheFor: resp.affected_chapter_ids,
          reloadActiveChapter: reload,
          reloadChapterId: reload && current ? current.id : undefined,
          data: resp,
        };
      });

      if (result.ok) {
        const resp = result.data;
        await findReplace.search(slug);
        snapshotPanelRef.current?.refreshSnapshots();
        // Panel-handle refresh is a no-op when the snapshot panel is closed
        // (ref is null). Replace-all just created N auto-snapshots, so drive
        // the toolbar count directly via the hook.
        refreshSnapshotCount();
        // Always surface a positive success banner so the user can
        // distinguish "did nothing because something went wrong" from
        // "finished with no user-visible change". When chapters were
        // skipped due to corrupt content, show the warning through the
        // error banner as well — success and warning are distinct
        // regions, not competing for the same slot.
        setActionInfo(STRINGS.findReplace.replaceSuccess(resp.replaced_count));
        if (resp.skipped_chapter_ids && resp.skipped_chapter_ids.length > 0) {
          setActionError(STRINGS.findReplace.skippedAfterReplace(resp.skipped_chapter_ids.length));
        }
        return;
      }

      if (result.stage === "busy") {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      if (result.stage === "flush") {
        // Attribute the failure to the save, not the replace.
        setActionError(STRINGS.findReplace.replaceFailedSaveFirst);
        return;
      }
      if (result.stage === "reload") {
        // Server-side replace succeeded; only the follow-up GET failed.
        // result.data carries the ReplaceResponse so we can show the real
        // replaced_count alongside the persistent lock banner (I1).
        await findReplace.search(slug);
        snapshotPanelRef.current?.refreshSnapshots();
        refreshSnapshotCount();
        setActionInfo(STRINGS.findReplace.replaceSuccess(result.data.replaced_count));
        setEditorLockedMessage(STRINGS.findReplace.replaceSucceededReloadFailed);
        return;
      }
      // stage === "mutate"
      const msg = mapReplaceErrorToMessage(result.error);
      if (msg) setActionError(msg);
    },
    [
      project,
      slug,
      findReplace,
      snapshotPanelRef,
      refreshSnapshotCount,
      getActiveChapter,
      setActionError,
      mutation,
    ],
  );

  const handleReplaceAllInManuscript = useCallback(() => {
    const results = findReplace.results;
    // Use the query/options that produced these results, not the live input
    // — the user may have typed a new query during the 300ms debounce,
    // which would make the count and the executed replace disagree.
    // `replacement` is read live: it does not affect the result set, and
    // freezing it would either leave the user's latest keystrokes ignored
    // or re-fire the search on every replace-input change.
    const frozenQuery = findReplace.resultsQuery;
    const frozenOptions = findReplace.resultsOptions;
    if (!results || !frozenQuery || !frozenOptions) return;
    setReplaceConfirmation({
      scope: { type: "project" },
      query: frozenQuery,
      replacement: findReplace.replacement,
      options: frozenOptions,
      totalCount: results.total_count,
      chapterCount: results.chapters.length,
      perChapterCount: 0,
    });
  }, [
    findReplace.results,
    findReplace.resultsQuery,
    findReplace.resultsOptions,
    findReplace.replacement,
  ]);

  const handleReplaceAllInChapter = useCallback(
    (chapterId: string) => {
      const results = findReplace.results;
      const frozenQuery = findReplace.resultsQuery;
      const frozenOptions = findReplace.resultsOptions;
      if (!results || !frozenQuery || !frozenOptions) return;
      const chapter = results.chapters.find((c) => c.chapter_id === chapterId);
      if (!chapter) return;
      setReplaceConfirmation({
        scope: { type: "chapter", chapter_id: chapterId },
        query: frozenQuery,
        replacement: findReplace.replacement,
        options: frozenOptions,
        totalCount: chapter.matches.length,
        chapterCount: 1,
        perChapterCount: chapter.matches.length,
      });
    },
    [
      findReplace.results,
      findReplace.resultsQuery,
      findReplace.resultsOptions,
      findReplace.replacement,
    ],
  );

  const handleReplaceOne = useCallback(
    async (chapterId: string, matchIndex: number) => {
      if (!project || !slug) return;
      // Use the query/options that produced the current results — not the
      // current input state — so replace-one targets the match the user
      // actually sees, even if they've started typing a new query.
      // Capture `replacement` here too (unlike the Replace-All paths that
      // dialog-confirm before this runs): per-match Replace has no confirm
      // step, so a slow flushSave (seconds during save backoff) would
      // otherwise let the user type over the replacement input between
      // click and POST — silently sending a different value than the one
      // visible at the moment of the click, with no UI to catch it.
      const frozenQuery = findReplace.resultsQuery;
      const frozenOptions = findReplace.resultsOptions;
      const frozenReplacement = findReplace.replacement;
      if (!frozenQuery || !frozenOptions) return;

      // Mirror executeReplace: clear any stale banners from a prior op so
      // the new replace's outcome does not co-display with an unrelated
      // success or error message.
      setActionInfo(null);
      setActionError(null);

      type ReplaceData = Awaited<ReturnType<typeof api.search.replace>>;

      const result = await mutation.run<ReplaceData>(async () => {
        const resp = await api.search.replace(slug, frozenQuery, frozenReplacement, frozenOptions, {
          type: "chapter",
          chapter_id: chapterId,
          match_index: matchIndex,
        });
        const current = getActiveChapter();
        // Replace-one with 0 count means the match was gone on the server —
        // emit no cache clear / no reload; the ok branch will surface the
        // matchNotFound banner and re-run the search.
        const reload =
          resp.replaced_count > 0 && !!current && resp.affected_chapter_ids.includes(current.id);
        return {
          clearCacheFor: resp.replaced_count > 0 ? resp.affected_chapter_ids : [],
          reloadActiveChapter: reload,
          reloadChapterId: reload && current ? current.id : undefined,
          data: resp,
        };
      });

      if (result.ok) {
        const resp = result.data;
        if (resp.replaced_count === 0) {
          // Stale match: refresh results so the row disappears and the user
          // can't click it again to loop the same error.
          setActionError(STRINGS.findReplace.matchNotFound);
          await findReplace.search(slug);
          return;
        }
        await findReplace.search(slug);
        snapshotPanelRef.current?.refreshSnapshots();
        // Panel-handle refresh is a no-op when the snapshot panel is
        // closed (ref is null). Replace-one created an auto-snapshot, so
        // drive the toolbar count directly via the hook.
        refreshSnapshotCount();
        setActionInfo(STRINGS.findReplace.replaceSuccess(resp.replaced_count));
        return;
      }

      if (result.stage === "busy") {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      if (result.stage === "flush") {
        setActionError(STRINGS.findReplace.replaceFailedSaveFirst);
        return;
      }
      if (result.stage === "reload") {
        // Server-side replace succeeded; only the follow-up GET failed.
        // Persistent lock banner (I1) — the editor stays read-only until
        // the page is refreshed.
        await findReplace.search(slug);
        snapshotPanelRef.current?.refreshSnapshots();
        refreshSnapshotCount();
        setActionInfo(STRINGS.findReplace.replaceSuccess(result.data.replaced_count));
        setEditorLockedMessage(STRINGS.findReplace.replaceSucceededReloadFailed);
        return;
      }
      // stage === "mutate"
      const err = result.error;
      // On 404 SCOPE_NOT_FOUND (chapter soft-deleted since the last search),
      // drop the stale match group BEFORE showing the banner — otherwise the
      // user clicks the same row and loops the same error. Gate on the
      // SCOPE_NOT_FOUND code specifically: a bare 404 can also mean the
      // whole project is gone (NOT_FOUND), in which case re-searching will
      // 404 again and stamp a second banner over the mapped project-gone
      // copy.
      if (
        err instanceof ApiRequestError &&
        err.status === 404 &&
        err.code === SEARCH_ERROR_CODES.SCOPE_NOT_FOUND
      ) {
        await findReplace.search(slug);
      }
      const msg = mapReplaceErrorToMessage(err);
      if (msg) setActionError(msg);
    },
    [
      project,
      slug,
      findReplace,
      snapshotPanelRef,
      refreshSnapshotCount,
      getActiveChapter,
      setActionError,
      mutation,
    ],
  );

  const {
    editingTitle,
    titleDraft,
    setTitleDraft,
    titleError,
    titleInputRef,
    startEditingTitle,
    saveTitle,
    cancelEditingTitle,
  } = useChapterTitleEditing(activeChapter, handleRenameChapter);

  const {
    editingProjectTitle,
    projectTitleDraft,
    setProjectTitleDraft,
    projectTitleInputRef,
    startEditingProjectTitle,
    saveProjectTitle,
    cancelEditingProjectTitle,
  } = useProjectTitleEditing(
    project,
    slug,
    handleUpdateProjectTitle,
    setProjectTitleError,
    navigate,
  );

  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [statuses, setStatuses] = useState<ChapterStatusRow[]>([]);
  const [navAnnouncement, setNavAnnouncement] = useState("");
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [wordCountAnnouncement, setWordCountAnnouncement] = useState("");
  const [imageAnnouncement, setImageAnnouncement] = useState("");
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const imageAnnouncementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toolbarEditor, setToolbarEditor] = useState<TipTapEditor | null>(null);

  // Clean up image announcement timer on unmount
  useEffect(() => {
    return () => {
      if (imageAnnouncementTimerRef.current) {
        clearTimeout(imageAnnouncementTimerRef.current);
      }
    };
  }, []);

  // Clear the editor-locked banner whenever the active Editor instance
  // changes — chapter switch creates a new Editor with default editable=true,
  // and a chapterReloadKey bump remounts with fresh server content. In both
  // cases the read-only state from the failed reload no longer applies.
  useEffect(() => {
    setEditorLockedMessage(null);
  }, [activeChapter?.id, chapterReloadKey]);

  // Fetch chapter statuses with retry
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    function fetchStatuses() {
      api.chapterStatuses
        .list()
        .then((data) => {
          if (!cancelled) setStatuses(data);
        })
        .catch((err) => {
          if (cancelled) return;
          console.warn("Failed to load chapter statuses:", err);
          if (attempts < 2) {
            attempts++;
            timerId = setTimeout(fetchStatuses, 2000 * attempts);
          } else {
            setActionError(STRINGS.error.statusesFetchFailed);
          }
        });
    }
    fetchStatuses();
    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, [setActionError]);

  const handleStatusChangeWithError = useCallback(
    (chapterId: string, status: string) => {
      setActionError(null);
      handleStatusChange(chapterId, status, setActionError);
    },
    [handleStatusChange, setActionError],
  );

  const handleRenameChapterWithError = useCallback(
    (chapterId: string, title: string) => {
      setActionError(null);
      handleRenameChapter(chapterId, title, setActionError);
    },
    [handleRenameChapter, setActionError],
  );

  const switchToView = useCallback(
    async (mode: ViewMode): Promise<boolean> => {
      // flushSave returns false when the save pipeline gave up (4xx or
      // all retries exhausted). Preview/Dashboard would then render the
      // LAST server-confirmed content, not what the user just typed —
      // matching the discipline of handleRestoreSnapshot/executeReplace/
      // onView, refuse the switch and surface a save-first banner.
      //
      // Returns true when the switch went through, false when we refused.
      // Callers that chain additional navigation (e.g. chapter select)
      // must gate on the return value — otherwise the refusal banner and
      // the follow-up navigation contradict each other.
      const flushed = (await editorRef.current?.flushSave()) ?? true;
      if (!flushed) {
        setActionError(STRINGS.editor.viewSwitchSaveFailed);
        return false;
      }
      setTrashOpen(false);
      setViewMode(mode);
      if (mode === "dashboard") {
        setDashboardRefreshKey((k) => k + 1);
      }
      return true;
    },
    [setTrashOpen, setActionError],
  );

  const handleSelectChapterWithFlush = useCallback(
    async (chapterId: string) => {
      // Chapter-select side-effects (seq bump, in-flight save abort, load
      // next chapter) must not run when switchToView refused — otherwise
      // we silently abandon an unsaved chapter while simultaneously
      // showing a banner that implies navigation was blocked.
      const switched = await switchToView("editor");
      if (!switched) return;
      await handleSelectChapter(chapterId);
    },
    [handleSelectChapter, switchToView],
  );

  const handleProjectSettingsUpdate = useCallback(() => {
    setDashboardRefreshKey((k) => k + 1);
    if (slug) {
      api.projects
        .get(slug)
        .then((data) =>
          setProject((prev) => {
            if (!prev) return data;
            return { ...data, chapters: prev.chapters };
          }),
        )
        .catch((err: unknown) => {
          // 404 after a settings update means the project was deleted
          // (or purged) from another tab/request — refreshing here would
          // leave the user staring at a stale editor with a retry banner
          // that can never succeed. Navigate home so the projects list
          // reflects the new reality. Transient network failures still
          // land on the dismissible banner.
          if (err instanceof ApiRequestError && err.status === 404) {
            navigate("/");
            return;
          }
          setActionError(STRINGS.error.loadProjectFailed);
        });
    }
  }, [slug, setProject, setActionError, navigate]);

  useKeyboardShortcuts({
    shortcutHelpOpen,
    deleteTarget,
    projectSettingsOpen,
    exportDialogOpen,
    replaceConfirmOpen: replaceConfirmation !== null,
    viewMode,
    activeChapter,
    project,
    chapterWordCount,
    flushSave: () => editorRef.current?.flushSave(),
    setShortcutHelpOpen,
    toggleSidebar,
    handleCreateChapter,
    handleSelectChapterWithFlush,
    setWordCountAnnouncement,
    setNavAnnouncement,
    switchToView,
    togglePanel: handleToggleReferencePanel,
    toggleFindReplace: handleToggleFindReplace,
  });

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <div className="text-center page-enter">
          <p className="text-text-primary text-lg mb-4">{error}</p>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
            className="text-accent hover:underline"
          >
            {STRINGS.error.backToProjects}
          </a>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <p className="text-text-muted">{STRINGS.nav.loading}</p>
      </div>
    );
  }

  const hasChapters = project.chapters.length > 0;
  const showActiveEditor = hasChapters && activeChapter;

  // Chapters exist but haven't loaded the active one yet — show loading
  if (hasChapters && !activeChapter) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <p className="text-text-muted">{STRINGS.nav.loading}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      <header className="border-b border-border/60 px-6 h-12 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
            className="focus:outline-none focus:ring-2 focus:ring-focus-ring rounded-md"
          >
            <Logo />
          </button>
          <span className="text-border" aria-hidden="true">
            /
          </span>
          {editingProjectTitle ? (
            <div className="flex flex-col">
              <input
                ref={projectTitleInputRef}
                value={projectTitleDraft}
                onChange={(e) => setProjectTitleDraft(e.target.value)}
                onBlur={saveProjectTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveProjectTitle();
                  if (e.key === "Escape") cancelEditingProjectTitle();
                }}
                className="text-sm font-serif font-semibold text-text-primary bg-transparent border-b-2 border-accent focus:outline-none"
                aria-label={STRINGS.a11y.projectTitleInput}
              />
              {projectTitleError && (
                <span role="alert" className="text-xs text-status-error mt-1">
                  {projectTitleError}
                </span>
              )}
            </div>
          ) : (
            <h1
              className="text-sm font-serif font-semibold text-text-primary cursor-pointer hover:text-text-secondary"
              onDoubleClick={startEditingProjectTitle}
              aria-label={project.title}
            >
              {project.title}
            </h1>
          )}
        </div>
        {showActiveEditor && viewMode === "editor" && toolbarEditor && (
          <EditorToolbar
            editor={toolbarEditor}
            snapshotCount={snapshotCount ?? undefined}
            onToggleSnapshots={handleToggleSnapshotPanel}
            onToggleFindReplace={handleToggleFindReplace}
            snapshotsTriggerRef={snapshotsTriggerRef}
            findReplaceTriggerRef={findReplaceTriggerRef}
          />
        )}
        <div className="flex items-center gap-2">
          {showActiveEditor && <ViewModeNav viewMode={viewMode} onSwitchToView={switchToView} />}
          <button
            onClick={() => setExportDialogOpen(true)}
            className="text-sm text-text-muted hover:text-text-secondary rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {STRINGS.export.buttonLabel}
          </button>
          <button
            type="button"
            onClick={handleToggleReferencePanel}
            aria-expanded={panelOpen}
            aria-controls="reference-panel"
            aria-label={STRINGS.referencePanel.toggleTooltip}
            title={STRINGS.referencePanel.toggleTooltip}
            className="p-2 rounded hover:bg-bg-hover text-text-secondary focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="3" width="20" height="18" rx="2" />
              <line x1="15" y1="3" x2="15" y2="21" />
            </svg>
          </button>
          <button
            onClick={() => setProjectSettingsOpen(true)}
            aria-label={STRINGS.projectSettings.openLabel}
            className="text-sm text-text-muted hover:text-text-secondary rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            &#x2699;
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            project={project}
            activeChapterId={activeChapter?.id ?? null}
            onSelectChapter={handleSelectChapterWithFlush}
            onAddChapter={handleCreateChapter}
            onDeleteChapter={setDeleteTarget}
            onReorderChapters={handleReorderChapters}
            onRenameChapter={handleRenameChapterWithError}
            onOpenTrash={openTrash}
            statuses={statuses}
            onStatusChange={handleStatusChangeWithError}
            width={sidebarWidth}
            onResize={handleSidebarResize}
          />
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {editorLockedMessage && (
            <div
              role="alert"
              className="px-6 py-2 bg-status-error/8 text-status-error text-sm flex items-center justify-between border-b border-status-error/15"
            >
              <span>{editorLockedMessage}</span>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="ml-4 rounded-md bg-status-error/15 px-2.5 py-1 text-xs font-medium text-status-error hover:bg-status-error/25 focus:outline-none focus:ring-2 focus:ring-focus-ring"
              >
                {STRINGS.editor.refreshButton}
              </button>
            </div>
          )}
          {actionError && (
            <ActionErrorBanner error={actionError} onDismiss={() => setActionError(null)} />
          )}
          {actionInfo && (
            <div
              role="status"
              aria-live="polite"
              className="px-6 py-2 bg-accent/10 text-accent text-sm flex items-center justify-between border-b border-accent/20"
            >
              <span>{actionInfo}</span>
              <button
                onClick={() => setActionInfo(null)}
                className="text-accent hover:text-text-primary text-xs ml-4 focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
                aria-label={STRINGS.a11y.dismissError}
              >
                ✕
              </button>
            </div>
          )}

          {trashOpen ? (
            <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
              <TrashView
                chapters={trashedChapters}
                onRestore={handleRestore}
                onBack={() => setTrashOpen(false)}
              />
            </main>
          ) : !showActiveEditor ? (
            <div className="flex-1 flex flex-col items-center justify-center page-enter">
              <p className="text-text-muted mb-6 text-base">{STRINGS.project.emptyChapters}</p>
              <button
                onClick={handleCreateChapter}
                className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 focus:ring-offset-bg-primary shadow-sm"
              >
                {STRINGS.sidebar.addChapter}
              </button>
            </div>
          ) : viewMode === "preview" ? (
            <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
              <PreviewMode
                chapters={project.chapters}
                onNavigateToChapter={handleSelectChapterWithFlush}
              />
            </main>
          ) : viewMode === "dashboard" ? (
            <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
              <DashboardView
                slug={project.slug}
                statuses={statuses}
                refreshKey={dashboardRefreshKey}
                onNavigateToChapter={handleSelectChapterWithFlush}
              />
            </main>
          ) : activeChapter ? (
            <main
              className="flex-1 overflow-y-auto flex flex-col"
              aria-label={STRINGS.a11y.mainContent}
            >
              {viewingSnapshot && (
                <SnapshotBanner
                  label={viewingSnapshot.label}
                  date={viewingSnapshot.created_at}
                  onRestore={handleRestoreSnapshot}
                  onBack={exitSnapshotView}
                />
              )}
              <div className="flex-1 overflow-y-auto px-6 py-8 page-enter">
                {viewingSnapshot ? (
                  <div
                    className="mx-auto max-w-[720px] prose prose-lg font-serif text-text-primary prose-headings:text-text-primary prose-a:text-accent"
                    dangerouslySetInnerHTML={{
                      __html: renderSnapshotContent(viewingSnapshot.content),
                    }}
                  />
                ) : (
                  <>
                    {editingTitle ? (
                      <div className="mx-auto max-w-[720px] mb-6">
                        <input
                          ref={titleInputRef}
                          value={titleDraft}
                          onChange={(e) => setTitleDraft(e.target.value)}
                          onBlur={saveTitle}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTitle();
                            if (e.key === "Escape") cancelEditingTitle();
                          }}
                          className="block text-3xl font-serif font-semibold text-text-primary bg-transparent border-b-2 border-accent focus:outline-none w-full tracking-tight"
                          aria-label={STRINGS.a11y.chapterTitleInput}
                        />
                        {titleError && (
                          <p role="alert" className="text-xs text-status-error mt-1">
                            {titleError}
                          </p>
                        )}
                      </div>
                    ) : (
                      <h2
                        className="mx-auto max-w-[720px] mb-6 text-3xl font-serif font-semibold text-text-primary cursor-pointer hover:text-text-secondary tracking-tight"
                        onDoubleClick={startEditingTitle}
                        aria-label={activeChapter.title}
                      >
                        {activeChapter.title}
                      </h2>
                    )}
                    <Editor
                      key={`${activeChapter.id}:${chapterReloadKey}`}
                      chapterId={activeChapter.id}
                      content={activeChapter.content}
                      onSave={handleSave}
                      onContentChange={handleContentChange}
                      editorRef={editorRef}
                      onEditorReady={setToolbarEditor}
                      projectId={project.id}
                      onImageAnnouncement={(msg) => {
                        if (imageAnnouncementTimerRef.current) {
                          clearTimeout(imageAnnouncementTimerRef.current);
                        }
                        setImageAnnouncement(msg);
                        imageAnnouncementTimerRef.current = setTimeout(
                          () => setImageAnnouncement(""),
                          3000,
                        );
                      }}
                    />
                  </>
                )}
              </div>
            </main>
          ) : null}

          {showActiveEditor && (
            <EditorFooter
              chapterWordCount={chapterWordCount}
              project={project}
              saveStatus={saveStatus}
              saveErrorMessage={saveErrorMessage}
              cacheWarning={cacheWarning}
            />
          )}
        </div>
        {panelOpen && project && (
          <ReferencePanel width={panelWidth} onResize={handlePanelResize}>
            <ImageGallery
              projectId={project.id}
              onInsertImage={(url, alt) => {
                editorRef.current?.insertImage(url, alt);
              }}
              onNavigateToChapter={(chapterId) => {
                handleSelectChapterWithFlush(chapterId);
              }}
            />
          </ReferencePanel>
        )}
        {snapshotPanelOpen && activeChapter && (
          <SnapshotPanel
            ref={snapshotPanelRef}
            chapterId={activeChapter.id}
            isOpen={snapshotPanelOpen}
            onClose={() => setSnapshotPanelOpen(false)}
            onView={async (snap) => {
              // Before switching to the read-only snapshot view, flush
              // any pending save and cancel in-flight save retries so
              // the server never receives a write while the user
              // believes they are just inspecting history. If the flush
              // failed (server error, lost connection), refuse to enter
              // view mode — the Editor would unmount with dirty state and
              // either drop recent edits or race a retry against a later
              // restore.
              //
              // Disable the editor BEFORE awaiting flushSave — same
              // discipline as executeReplace/handleReplaceOne. Without
              // this, keystrokes during the flush window (which can be
              // seconds long if the save is in backoff) re-dirty the
              // editor and the subsequent unmount cleanup fires a
              // fire-and-forget PATCH with the typed-during-flush
              // content.
              editorRef.current?.setEditable(false);
              try {
                const flushed = (await editorRef.current?.flushSave()) ?? true;
                if (!flushed) {
                  // Re-enable so the user can retry — view was refused.
                  editorRef.current?.setEditable(true);
                  return { ok: false, reason: "save_failed" };
                }
                cancelPendingSaves();
                const result = await viewSnapshot(snap);
                // viewSnapshot returns ok:false for network/not_found/
                // corrupt failures — re-enable the editor so the user
                // isn't left in an invisibly read-only state. Same for
                // staleChapterSwitch, where we return to normal editing
                // without entering snapshot view.
                if (!result.ok || result.staleChapterSwitch) {
                  editorRef.current?.setEditable(true);
                }
                return result;
              } catch (err) {
                editorRef.current?.setEditable(true);
                throw err;
              }
            }}
            onBeforeCreate={async () => {
              const flushed = (await editorRef.current?.flushSave()) ?? true;
              if (flushed) cancelPendingSaves();
              return flushed;
            }}
            onSnapshotsChange={onSnapshotsChange}
            triggerRef={snapshotsTriggerRef}
          />
        )}
        {findReplace.panelOpen && project && (
          <FindReplacePanel
            isOpen={findReplace.panelOpen}
            onClose={() => findReplace.closePanel()}
            results={findReplace.results}
            loading={findReplace.loading}
            error={findReplace.error}
            query={findReplace.query}
            onQueryChange={findReplace.setQuery}
            replacement={findReplace.replacement}
            onReplacementChange={findReplace.setReplacement}
            options={findReplace.options}
            onToggleOption={findReplace.toggleOption}
            onReplaceOne={handleReplaceOne}
            onReplaceAllInChapter={handleReplaceAllInChapter}
            onReplaceAllInManuscript={handleReplaceAllInManuscript}
            triggerRef={findReplaceTriggerRef}
          />
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={STRINGS.delete.confirmTitle(deleteTarget.title)}
          body={STRINGS.delete.confirmBody}
          confirmLabel={STRINGS.delete.confirmButton}
          cancelLabel={STRINGS.delete.cancelButton}
          onConfirm={confirmDeleteChapter}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {replaceConfirmation &&
        (() => {
          // Empty replacement is a valid "delete all matches" operation. Use
          // distinct delete-copy in the dialog so the user can't confuse it
          // with a Replace that would substitute an empty string — the
          // destructive intent must be explicit before the user commits.
          const isDelete = replaceConfirmation.replacement.length === 0;
          const isProjectScope = replaceConfirmation.scope.type === "project";
          return (
            <ConfirmDialog
              title={
                isDelete
                  ? isProjectScope
                    ? STRINGS.findReplace.replaceDeleteConfirmTitle
                    : STRINGS.findReplace.replaceDeleteChapterConfirmTitle
                  : isProjectScope
                    ? STRINGS.findReplace.replaceConfirmTitle
                    : STRINGS.findReplace.replaceChapterConfirmTitle
              }
              body={
                isDelete
                  ? isProjectScope
                    ? STRINGS.findReplace.replaceDeleteConfirm(
                        replaceConfirmation.totalCount,
                        replaceConfirmation.query,
                        replaceConfirmation.chapterCount,
                      )
                    : STRINGS.findReplace.replaceDeleteChapterConfirm(
                        replaceConfirmation.perChapterCount,
                        replaceConfirmation.query,
                      )
                  : isProjectScope
                    ? STRINGS.findReplace.replaceConfirm(
                        replaceConfirmation.totalCount,
                        replaceConfirmation.query,
                        replaceConfirmation.replacement,
                        replaceConfirmation.chapterCount,
                      )
                    : STRINGS.findReplace.replaceChapterConfirm(
                        replaceConfirmation.perChapterCount,
                        replaceConfirmation.query,
                        replaceConfirmation.replacement,
                      )
              }
              confirmLabel={
                isDelete
                  ? STRINGS.findReplace.replaceDeleteConfirmButton
                  : STRINGS.findReplace.replaceConfirmButton
              }
              cancelLabel={STRINGS.findReplace.replaceCancelButton}
              onConfirm={() => {
                const frozen = replaceConfirmation;
                setReplaceConfirmation(null);
                void executeReplace({
                  scope: frozen.scope,
                  query: frozen.query,
                  replacement: frozen.replacement,
                  options: frozen.options,
                });
              }}
              onCancel={() => setReplaceConfirmation(null)}
            />
          );
        })()}

      <div aria-live="polite" className="sr-only" data-testid="nav-announcement">
        {navAnnouncement}
      </div>
      <div aria-live="polite" className="sr-only" data-testid="word-count-announcement">
        {wordCountAnnouncement}
      </div>
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {imageAnnouncement}
      </div>

      <ProjectSettingsDialog
        key={project.slug}
        open={projectSettingsOpen}
        project={project}
        onClose={() => setProjectSettingsOpen(false)}
        onUpdate={handleProjectSettingsUpdate}
      />

      <ShortcutHelpDialog open={shortcutHelpOpen} onClose={() => setShortcutHelpOpen(false)} />

      {project && (
        <ExportDialog
          open={exportDialogOpen}
          projectSlug={project.slug}
          projectId={project.id}
          chapters={project.chapters.map((ch) => ({
            id: ch.id,
            title: ch.title,
            sort_order: ch.sort_order,
          }))}
          onClose={() => setExportDialogOpen(false)}
        />
      )}
    </div>
  );
}
