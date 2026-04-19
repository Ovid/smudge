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
import { useSidebarState } from "../hooks/useSidebarState";
import { useReferencePanelState } from "../hooks/useReferencePanelState";
import { useSnapshotState } from "../hooks/useSnapshotState";
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
import { clearAllCachedContent } from "../hooks/useContentCache";
import { Logo } from "../components/Logo";
import { generateHTML } from "@tiptap/html";
import DOMPurify from "dompurify";
import { editorExtensions } from "../editorExtensions";

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

  // Snapshot-view ref used by handleRestoreSnapshot to re-check intent after
  // awaiting flushSave — the user may have clicked "Back to editing" during
  // the flush, in which case the restore should not proceed.
  const viewingSnapshotRef = useRef(viewingSnapshot);
  viewingSnapshotRef.current = viewingSnapshot;

  // Guards against overlapping replace requests. Rapid double-clicks on a
  // per-match Replace button (no confirm dialog) or the Replace-All button
  // (re-confirmed quickly) would otherwise kick off parallel POSTs — each
  // creates its own auto-snapshot on the server and triggers independent
  // reloadActiveChapter remounts, magnifying the in-flight-edit data-loss
  // race surface.
  const replaceInFlightRef = useRef(false);

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
    // Disable the editor for the full round trip so typing between markClean
    // and the restore response cannot re-dirty it. Without this, the unmount
    // PATCH fired by reloadActiveChapter's remount would land after the
    // restore and silently overwrite the restored content.
    editorRef.current?.setEditable(false);
    try {
      // If the pending save failed, do not reload — reload would clear the
      // client-side unsaved-content cache, losing the user's unsaved edits.
      const flushed = (await editorRef.current?.flushSave()) ?? true;
      if (!flushed) {
        // The fault is the save, not the restore — attribute it correctly.
        setActionError(STRINGS.snapshots.restoreFailedSaveFirst);
        return;
      }
      // After awaiting flushSave, re-check whether the user still wants the
      // restore. If they clicked "Back to editing" during the flush, the
      // closure-captured viewingSnapshot is stale and we must not proceed.
      if (!viewingSnapshotRef.current) return;
      // Cancel any pending retry saves; their stale content would clobber
      // the restored snapshot once the server-side restore completes.
      cancelPendingSaves();
      // Mark the editor clean so the unmount triggered by the upcoming
      // reloadActiveChapter remount does NOT fire a fire-and-forget save of
      // pre-restore content that would land after the server-side restore
      // and silently undo it.
      editorRef.current?.markClean();
      const result = await restoreSnapshot(viewingSnapshot.id);
      if (result.ok) {
        // If the user switched chapters mid-flight, reloading the now-active
        // chapter would pull in a different chapter's server state. Skip the
        // reload and the panel refresh — both are keyed to the current active
        // chapter, not the one that was restored.
        if (!result.staleChapterSwitch) {
          await reloadActiveChapter();
          snapshotPanelRef.current?.refreshSnapshots();
        }
      } else if (result.reason === "corrupt_snapshot") {
        setActionError(STRINGS.snapshots.restoreFailedCorrupt);
      } else if (result.reason === "cross_project_image") {
        setActionError(STRINGS.snapshots.restoreFailedCrossProjectImage);
      } else if (result.reason === "not_found") {
        setActionError(STRINGS.snapshots.restoreFailedNotFound);
      } else {
        setActionError(STRINGS.snapshots.restoreFailed);
      }
    } finally {
      // Re-enable editing. If reloadActiveChapter caused a remount, the old
      // editor handle is destroyed and this is a no-op on a fresh editable
      // editor; otherwise we need to re-enable so the user can continue.
      editorRef.current?.setEditable(true);
    }
  }, [
    viewingSnapshot,
    activeChapter,
    restoreSnapshot,
    reloadActiveChapter,
    snapshotPanelRef,
    setActionError,
    cancelPendingSaves,
  ]);

  const executeReplace = useCallback(
    async (frozen: {
      scope: { type: "project" } | { type: "chapter"; chapter_id: string };
      query: string;
      replacement: string;
      options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
    }) => {
      if (!project || !slug) return;
      // Guard against overlapping replaces — a double-confirm or racing
      // clicks from another path would otherwise launch parallel POSTs,
      // each creating an auto-snapshot and remounting the editor.
      if (replaceInFlightRef.current) return;
      replaceInFlightRef.current = true;
      // Disable the editor for the full round trip so typing during the
      // in-flight replace cannot dirty it. Without this, a keystroke
      // between markClean and the response would set dirtyRef=true, and
      // the unmount cleanup fired by reloadActiveChapter would PATCH
      // pre-replace content over the server's replaced content.
      editorRef.current?.setEditable(false);
      try {
        const flushed = (await editorRef.current?.flushSave()) ?? true;
        if (!flushed) {
          // Attribute the failure to the save, not the replace.
          setActionError(STRINGS.findReplace.replaceFailedSaveFirst);
          return;
        }
        cancelPendingSaves();
        // Mark the editor clean so the upcoming remount (from
        // reloadActiveChapter after a successful replace) does not fire
        // an unmount PATCH with pre-replace content that would clobber
        // the just-committed replacement.
        editorRef.current?.markClean();
        setActionInfo(null);
        try {
          const result = await api.search.replace(
            slug,
            frozen.query,
            frozen.replacement,
            frozen.options,
            frozen.scope,
          );
          // Purge the localStorage draft cache AFTER the server confirms the
          // replace, scoped to the chapters the server actually mutated.
          // Clearing pre-flight would wipe every draft in the project on a
          // network blip; scoping to affected_chapter_ids protects unrelated
          // chapters' drafts and still prevents a later chapter switch from
          // overlaying pre-replace content on top of the server's replaced
          // content. The editor is setEditable(false) for the full round
          // trip, so the active chapter cannot accrue new cache writes in
          // the interim.
          if (result.affected_chapter_ids.length > 0) {
            clearAllCachedContent(result.affected_chapter_ids);
          }
          // Read the CURRENT active chapter (not the closure value) so a
          // chapter switch between click and response still reloads when the
          // now-active chapter was affected.
          const current = getActiveChapter();
          if (current && result.affected_chapter_ids.includes(current.id)) {
            await reloadActiveChapter();
          }
          await findReplace.search(slug);
          snapshotPanelRef.current?.refreshSnapshots();
          // Panel-handle refresh is a no-op when the snapshot panel is
          // closed (ref is null). Replace-all just created N auto-snapshots,
          // so drive the toolbar count directly via the hook.
          refreshSnapshotCount();
          // Always surface a positive success banner so the user can
          // distinguish "did nothing because something went wrong" from
          // "finished with no user-visible change". When chapters were
          // skipped due to corrupt content, show the warning through the
          // error banner as well — success and warning are distinct
          // regions, not competing for the same slot.
          setActionInfo(STRINGS.findReplace.replaceSuccess(result.replaced_count));
          if (result.skipped_chapter_ids && result.skipped_chapter_ids.length > 0) {
            setActionError(
              STRINGS.findReplace.skippedAfterReplace(result.skipped_chapter_ids.length),
            );
          }
        } catch (err) {
          const msg = mapReplaceErrorToMessage(err);
          if (msg) setActionError(msg);
        }
      } finally {
        // Re-enable editing. If reloadActiveChapter caused a remount,
        // the old editor instance is destroyed; the handle now points at
        // a fresh editable editor and this is a no-op. If no remount
        // occurred (replace did not affect the active chapter), we need
        // to re-enable so the user can continue typing.
        editorRef.current?.setEditable(true);
        replaceInFlightRef.current = false;
      }
    },
    [
      project,
      slug,
      findReplace,
      reloadActiveChapter,
      snapshotPanelRef,
      refreshSnapshotCount,
      getActiveChapter,
      setActionError,
      cancelPendingSaves,
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
      // Guard against overlapping replaces — per-match Replace has no
      // confirm dialog, so a rapid double-click would otherwise launch
      // parallel POSTs, each creating its own auto-snapshot and remount.
      if (replaceInFlightRef.current) return;
      replaceInFlightRef.current = true;
      // Disable the editor for the duration of the round trip — same
      // reasoning as executeReplace: typing during the request would
      // dirty the editor and the unmount cleanup would PATCH pre-replace
      // content over the server's replaced content.
      editorRef.current?.setEditable(false);
      try {
        // Use the query/options that produced the current results — not the
        // current input state — so replace-one targets the match the user
        // actually sees, even if they've started typing a new query.
        const frozenQuery = findReplace.resultsQuery;
        const frozenOptions = findReplace.resultsOptions;
        if (!frozenQuery || !frozenOptions) return;
        const flushed = (await editorRef.current?.flushSave()) ?? true;
        if (!flushed) {
          setActionError(STRINGS.findReplace.replaceFailedSaveFirst);
          return;
        }
        cancelPendingSaves();
        // Mark editor clean so if a reloadActiveChapter remount follows,
        // the unmount cleanup does not PATCH pre-replace content.
        editorRef.current?.markClean();
        // Mirror executeReplace: clear any stale success banner from a prior
        // replace so an error on this one doesn't co-display with the old
        // "Replaced N occurrences" message.
        setActionInfo(null);
        try {
          const result = await api.search.replace(
            slug,
            frozenQuery,
            findReplace.replacement,
            frozenOptions,
            { type: "chapter", chapter_id: chapterId, match_index: matchIndex },
          );
          if (result.replaced_count === 0) {
            setActionError(STRINGS.findReplace.matchNotFound);
            // Refresh results so the stale match is removed; otherwise clicking
            // it again produces the same error in a loop.
            await findReplace.search(slug);
            return;
          }
          // Purge the localStorage draft cache AFTER the server confirms
          // the replace, scoped to the mutated chapter. Clearing pre-flight
          // would destroy a non-active chapter's draft on a network blip.
          if (result.affected_chapter_ids.length > 0) {
            clearAllCachedContent(result.affected_chapter_ids);
          }
          const current = getActiveChapter();
          if (current && result.affected_chapter_ids.includes(current.id)) {
            await reloadActiveChapter();
          }
          await findReplace.search(slug);
          snapshotPanelRef.current?.refreshSnapshots();
          // Panel-handle refresh is a no-op when the snapshot panel is
          // closed (ref is null). Replace-one created an auto-snapshot, so
          // drive the toolbar count directly via the hook.
          refreshSnapshotCount();
          setActionInfo(STRINGS.findReplace.replaceSuccess(result.replaced_count));
        } catch (err) {
          const msg = mapReplaceErrorToMessage(err);
          if (msg) setActionError(msg);
          // On 404 SCOPE_NOT_FOUND (chapter soft-deleted since the last
          // search), drop the stale match group; otherwise the user clicks
          // the same row and loops the same error.
          if (err instanceof ApiRequestError && err.status === 404) {
            await findReplace.search(slug);
          }
        }
      } finally {
        editorRef.current?.setEditable(true);
        replaceInFlightRef.current = false;
      }
    },
    [
      project,
      slug,
      findReplace,
      reloadActiveChapter,
      snapshotPanelRef,
      refreshSnapshotCount,
      getActiveChapter,
      setActionError,
      cancelPendingSaves,
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
  const editorRef = useRef<EditorHandle | null>(null);
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
    async (mode: ViewMode) => {
      await editorRef.current?.flushSave();
      setTrashOpen(false);
      setViewMode(mode);
      if (mode === "dashboard") {
        setDashboardRefreshKey((k) => k + 1);
      }
    },
    [setTrashOpen],
  );

  const handleSelectChapterWithFlush = useCallback(
    async (chapterId: string) => {
      await switchToView("editor");
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
        .catch(() => {
          setActionError(STRINGS.error.loadProjectFailed);
        });
    }
  }, [slug, setProject, setActionError]);

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

      {replaceConfirmation && (
        <ConfirmDialog
          title={
            replaceConfirmation.scope.type === "project"
              ? STRINGS.findReplace.replaceConfirmTitle
              : STRINGS.findReplace.replaceChapterConfirmTitle
          }
          body={
            replaceConfirmation.scope.type === "project"
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
          confirmLabel={STRINGS.findReplace.replaceConfirmButton}
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
      )}

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
