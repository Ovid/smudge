import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Chapter, ChapterStatusRow, ChapterStatusValue } from "@smudge/shared";
import type { EditorHandle } from "../components/Editor";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { STRINGS } from "../strings";
import { useProjectEditor } from "../hooks/useProjectEditor";
import { useEditorMutation } from "../hooks/useEditorMutation";
import { useEditorMutationMachine } from "../hooks/useEditorMutationMachine";
import { useAbortableAsyncOperation } from "../hooks/useAbortableAsyncOperation";
import { sleep } from "../utils/abortable";
import { useSidebarState } from "../hooks/useSidebarState";
import { useReferencePanelState } from "../hooks/useReferencePanelState";
import { useSnapshotState } from "../hooks/useSnapshotState";
import { useFindReplaceState } from "../hooks/useFindReplaceState";
import { useChapterTitleEditing } from "../hooks/useChapterTitleEditing";
import { useProjectTitleEditing } from "../hooks/useProjectTitleEditing";
import { useTrashManager } from "../hooks/useTrashManager";
import { useKeyboardShortcuts, type ViewMode } from "../hooks/useKeyboardShortcuts";
import { api } from "../api/client";
import {
  mapApiError,
  mapApiErrorMessage,
  applyMappedError,
  isAborted,
  isNotFound,
  clientWarn,
} from "../errors";
import { safeSetEditable } from "../utils/editorSafeOps";
// F-1 decomposition (2026-05-29): the find-and-replace and snapshot
// orchestration clusters live in dedicated hooks. The sentinel restore
// errors and renderSnapshotContent moved with the snapshot cluster.
import { useSnapshotController } from "../hooks/useSnapshotController";
import { useFindReplaceController } from "../hooks/useFindReplaceController";
// F-1 decomposition (2026-05-29): the ~456-line render was split into
// three presentational sub-components — the header, the main content
// region (sidebar / banners / view-switch / footer / panels), and the
// dialog + live-region cluster. EditorPage retains all state, handlers,
// and the save-pipeline / lock / busy invariants, threading them in.
import { EditorHeader } from "../components/EditorHeader";
import { EditorMainContent } from "../components/EditorMainContent";
import { EditorDialogs } from "../components/EditorDialogs";

export function EditorPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();

  // Phase 4b.5: the editor's operational state (lock banner, TipTap editable
  // intent, mutation-busy) lives in ONE machine so the invariant pair can no
  // longer drift by hand. The read-only lock is surfaced when a mutation
  // succeeded server-side but the follow-up reload failed (I1); the Editor is
  // intentionally left setEditable(false) in that case to prevent the user
  // from typing over stale content. The lock banner is the only persistent
  // user-visible signal of that state, so it must NOT be dismissible — it
  // clears automatically when the Editor is replaced (chapter switch or
  // reload-key bump) via the EDITOR_REMOUNTED dispatch below.
  //
  // Declared above useProjectEditor (F-12) so its onRequestEditorLock can call
  // applyReloadFailedLock directly. The prior ref indirection worked around a
  // circular declaration that no longer exists: the 2026-05-30 machine refactor
  // reduced applyReloadFailedLock to a single machine dispatch, so it now
  // depends only on editorMachine — which itself takes no dependencies.
  const editorMachine = useEditorMutationMachine();

  // I6 (review 2026-04-24): invariant-pair helper. CLAUDE.md save-
  // pipeline invariant #2 requires setEditable(false) around any
  // mutation that can fail mid-typing; the persistent lock banner is the
  // only user-visible signal of that read-only state. Three call sites
  // pair them today (restore stage:"committed_but_unreloaded", restore stage:"mutate"
  // possiblyCommitted, and finalizeReplaceSuccess non-stale reloadFailed).
  // Callers keep their surrounding refreshes / cache-clear / stale-chapter
  // branching inline because those diverge between the restore and replace
  // flows in non-mechanical ways.
  const applyReloadFailedLock = useCallback(
    (bannerMessage: string) => {
      // COMMITTED_UNRELOADED sets the banner AND editable:false in one machine
      // transition — the invariant pair can no longer drift. The reconcile
      // effect pushes editable:false into TipTap; the lock-down setEditable(false)
      // already ran synchronously inside useEditorMutation for the mutation path,
      // and for the terminal-save-error path (useProjectEditor.onRequestEditorLock)
      // the effect applies it.
      //
      // S3 (agentic-review 2026-05-30): the terminal-save-error path is
      // INTENTIONALLY effect-driven, not synchronous. On `main`
      // applyReloadFailedLock ran safeSetEditable(false) imperatively; now this
      // helper only dispatches COMMITTED_UNRELOADED, so the onRequestEditorLock
      // caller (which does NOT pass through useEditorMutation.run(), so no prior
      // synchronous lock-down ran) leaves TipTap writable for one render tick
      // until the reconcile effect commits editable:false. This is ratified by
      // Decided Q3 (synchronous lock-down is scoped to the mutation paths only)
      // and is safe because that one-tick window is doubly backstopped: the
      // 1.5s auto-save debounce makes a stray PATCH in a single tick effectively
      // unreachable, and handleSaveLockGated no-ops any save the instant
      // isLocked() flips (the machine mirrors lock to its ref during render, so
      // isLocked() is true in the very commit this dispatch is processed). Do
      // not "fix" this by re-adding a synchronous setEditable(false) here — the
      // mutation paths own that, and adding it here would re-couple what Q3
      // deliberately split.
      editorMachine.dispatch({ type: "COMMITTED_UNRELOADED", message: bannerMessage });
    },
    [editorMachine],
  );

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
    seedConfirmedStatus,
    replaceConfirmedStatusesFromProject,
  } = useProjectEditor(slug, {
    // I2: route terminal save-fail codes through the invariant-pair
    // helper so the banner and setEditable(false) stay in lock-step.
    onRequestEditorLock: applyReloadFailedLock,
    // S11 (4b.3c.3): handleCreateChapter 404 means the project was
    // deleted between sidebar render and the POST landing. The
    // dismissible banner is the wrong UX (project doesn't exist for
    // the user to act on); navigate home so the project list rehydrates.
    onProjectNotFound: () => navigate("/"),
  });

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
  } = useTrashManager(project, slug, setProject, handleDeleteChapter, navigate, {
    // C2 (review 2026-04-25): a chapter restored from trash needs a
    // baseline in the confirmed-status cache so a later status PATCH
    // double-failure can fall back to a real value rather than skipping.
    seedConfirmedStatus,
    // I4 (4b.3c.3): bulk reseed for the committed-recovery branch's
    // follow-up GET, where the entire project snapshot is refreshed.
    replaceConfirmedStatusesFromProject,
  });

  // Refs on the toolbar buttons so each panel can return focus to its
  // trigger when closed via Escape (WCAG focus management).
  const snapshotsTriggerRef = useRef<HTMLButtonElement>(null);
  const findReplaceTriggerRef = useRef<HTMLButtonElement>(null);

  // Separate from actionError so a partial-success replace (some chapters
  // replaced, some skipped due to corruption) can surface both a positive
  // "replaced N occurrences" banner and a warning about skipped chapters
  // without conflating success with failure.
  const [actionInfo, setActionInfo] = useState<string | null>(null);

  // Editor handle is declared here (above useEditorMutation + the migrated
  // mutation callbacks) so the hook can capture the ref and the callbacks
  // below can read editorRef.current safely.
  const editorRef = useRef<EditorHandle | null>(null);

  // Defense-in-depth save gate (C1): wraps handleSave so that, if the lock
  // banner is showing, no auto-save PATCH leaves the client — regardless of
  // whether setEditable(false) actually applied. The banner implies the
  // editor is read-only; a TipTap mid-remount throw from safeSetEditable
  // can leave the editor writable (safeSetEditable returns false in that
  // case, but until the user refreshes, keystrokes still fire onUpdate and
  // schedule a debounced save). Short-circuiting to `false` here turns
  // those saves into no-ops that leave dirtyRef set — the content cache
  // (invariant 3) still holds the draft, the server is never PATCHed, and
  // refreshing the page restores the server-committed state cleanly.
  const handleSaveLockGated = useCallback(
    async (content: Record<string, unknown>, chapterId?: string): Promise<boolean> => {
      if (editorMachine.isLocked()) return false;
      return handleSave(content, chapterId);
    },
    [handleSave, editorMachine],
  );

  // Single useEditorMutation instance shared by handleRestoreSnapshot,
  // executeReplace, and handleReplaceOne. The cross-caller busy-guard
  // depends on a single invocation — do NOT add a second call.
  const mutation = useEditorMutation({
    editorRef,
    projectEditor: {
      cancelPendingSaves,
      reloadActiveChapter,
      getActiveChapter,
    },
    // The hook emits MUTATION_STARTED at entry and one terminal event on
    // settle; on the committed-but-unreloaded path it dispatches nothing and
    // the consumer raises COMMITTED_UNRELOADED with its own banner copy. The
    // machine's MUTATION_SETTLED_OK transition preserves the old "do not
    // re-enable under a persistent lock" guard (I1) by construction.
    dispatch: editorMachine.dispatch,
  });

  // I5: Caller-level busy ref spanning the ENTIRE handleReplaceOne /
  // executeReplace / handleRestoreSnapshot async body, including post-run
  // UI work (await findReplace.search, banner updates). The hook's
  // inFlightRef releases as soon as run() resolves, so a rapid second
  // click during finalizeReplaceSuccess's awaited search refresh would
  // otherwise enter a fresh mutation.run() unconstrained — its
  // setActionError could land alongside the first click's trailing
  // setActionInfo("Replaced N occurrences"), leaving a contradictory
  // success+failure banner pair pinned to one logical operation.
  const actionBusyRef = useRef(false);
  const isActionBusy = useCallback(() => mutation.isBusy() || actionBusyRef.current, [mutation]);

  // I2: shared lock-banner predicate for entry points outside useEditorMutation
  // (title edits, panel open/close). Reads through the latest-ref so callbacks
  // captured once see the current banner state.
  const isEditorLocked = useCallback(() => editorMachine.isLocked(), [editorMachine]);

  // Panel exclusivity: when snapshot panel opens, close reference panel and vice versa.
  //
  // Each toggle guards on mutation.isBusy() (I2): the panel-exclusivity
  // logic closes other panels and in handleToggleReferencePanel /
  // handleToggleFindReplace calls exitSnapshotView. Allowing these to run
  // mid-mutation would remount the Editor (via ViewModeNav or viewingSnapshot
  // state) while the hook still holds the pre-remount editor handle,
  // defeating the hook's setEditable(false) lock.
  const handleToggleSnapshotPanel = useCallback(() => {
    if (isActionBusy()) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    if (!snapshotPanelOpen) {
      setPanelOpen(false);
      findReplace.closePanel();
    }
    toggleSnapshotPanel();
  }, [snapshotPanelOpen, setPanelOpen, findReplace, toggleSnapshotPanel, isActionBusy]);

  const handleToggleReferencePanel = useCallback(() => {
    // C1: refuse while the lock banner is up. If we ran exitSnapshotView()
    // under a possibly_committed / unknown restore lock, React would mount
    // the live editor in its default editable state; subsequent keystrokes
    // would land in useContentCache and silently revert the server-committed
    // restore on next load.
    if (isEditorLocked()) {
      setActionInfo(STRINGS.editor.lockedRefusal);
      return;
    }
    if (isActionBusy()) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    if (!panelOpen) {
      setSnapshotPanelOpen(false);
      exitSnapshotView();
      findReplace.closePanel();
    }
    togglePanel();
  }, [
    panelOpen,
    setSnapshotPanelOpen,
    exitSnapshotView,
    findReplace,
    togglePanel,
    isActionBusy,
    isEditorLocked,
  ]);

  const handleToggleFindReplace = useCallback(() => {
    // C1: see handleToggleReferencePanel — same rationale.
    if (isEditorLocked()) {
      setActionInfo(STRINGS.editor.lockedRefusal);
      return;
    }
    if (isActionBusy()) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    if (!findReplace.panelOpen) {
      setPanelOpen(false);
      setSnapshotPanelOpen(false);
      exitSnapshotView();
    }
    findReplace.togglePanel();
  }, [
    findReplace,
    setPanelOpen,
    setSnapshotPanelOpen,
    exitSnapshotView,
    isActionBusy,
    isEditorLocked,
  ]);

  // OOSI1 (agentic-review 2026-05-30): re-assert editor editability after a
  // committed_but_unreloaded replace that settled on a now-unrelated chapter.
  // Dispatches MUTATION_SETTLED_SUPERSEDED ({editable:true, busy:false,
  // lock:null}) — the same terminal state the mutation hook emits when IT
  // detects supersession — so finalizeReplaceSuccess's stale branch can
  // re-enable the displayed editor instead of leaving it read-only with only a
  // dismissible action error. Deps mirror applyReloadFailedLock (the sibling
  // helper threaded into the same controller): depending on the whole
  // editorMachine churns this callback's identity per render, which is harmless
  // for a useCallback (unlike the EDITOR_REMOUNTED effect below, which must key
  // on the stable dispatch to avoid spuriously re-firing on every transition).
  const reassertEditorEditable = useCallback(() => {
    editorMachine.dispatch({ type: "MUTATION_SETTLED_SUPERSEDED" });
  }, [editorMachine]);

  // F-1 decomposition (2026-05-29): the snapshot-restore / onView /
  // onBeforeCreate orchestration. The single mutation instance,
  // actionBusyRef, editor-lock refs, and action banners stay owned here
  // and are threaded in so the cross-caller busy/lock invariants hold.
  const { handleRestoreSnapshot, onSnapshotView, onSnapshotBeforeCreate } = useSnapshotController({
    activeChapter,
    viewingSnapshot,
    restoreSnapshot,
    viewSnapshot,
    exitSnapshotView,
    snapshotPanelRef,
    refreshSnapshotCount,
    cancelPendingSaves,
    mutation,
    findReplace,
    getActiveChapter,
    editorRef,
    isEditorLocked,
    isActionBusy,
    actionBusyRef,
    applyReloadFailedLock,
    setActionError,
    setActionInfo,
  });

  // F-1 decomposition (2026-05-29): the replace-all / replace-one /
  // replace-confirmation orchestration. Same shared-primitive threading
  // as the snapshot controller above — both receive the SAME mutation
  // instance and actionBusyRef (CLAUDE.md: do NOT add a second
  // useEditorMutation call).
  const {
    replaceConfirmation,
    setReplaceConfirmation,
    executeReplace,
    handleReplaceAllInManuscript,
    handleReplaceAllInChapter,
    handleReplaceOne,
  } = useFindReplaceController({
    project,
    slug,
    findReplace,
    mutation,
    getActiveChapter,
    isActionBusy,
    actionBusyRef,
    isEditorLocked,
    applyReloadFailedLock,
    reassertEditorEditable,
    setActionError,
    setActionInfo,
    snapshotPanelRef,
    refreshSnapshotCount,
  });

  const {
    editingTitle,
    titleDraft,
    setTitleDraft,
    titleError,
    titleInputRef,
    startEditingTitle,
    saveTitle,
    cancelEditingTitle,
  } = useChapterTitleEditing(activeChapter, handleRenameChapter, isActionBusy, isEditorLocked);

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
    isActionBusy,
    isEditorLocked,
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
  // I11 (review 2026-04-25): the post-update settings GET in
  // handleProjectSettingsUpdate had no AbortController. Component
  // unmount (cross-project nav, project delete) between dispatch and
  // resolve would let setProject / navigate("/") run on a torn-down
  // hook. Mirror the abort-on-unmount discipline used everywhere else
  // on this branch — one controller per call, aborted on the next
  // call AND on unmount.
  const settingsRefreshOp = useAbortableAsyncOperation();
  // I8 (review 2026-04-24): shared counter bumped when a paste/drop
  // upload falls into the possiblyCommitted branch; ImageGallery
  // re-fetches its list so a retry sees the already-stored row rather
  // than uploading the same file again.
  const [galleryExternalRefreshKey, setGalleryExternalRefreshKey] = useState(0);
  const [toolbarEditor, setToolbarEditor] = useState<TipTapEditor | null>(null);

  // Clean up image announcement timer on unmount.
  // settingsRefreshOp auto-aborts on unmount — no explicit call needed.
  useEffect(() => {
    return () => {
      if (imageAnnouncementTimerRef.current) {
        clearTimeout(imageAnnouncementTimerRef.current);
      }
    };
  }, []);

  // Remount (chapter switch or chapterReloadKey bump) clears the lock and
  // re-asserts editable — replaces the old lock-message-clearing effect.
  // Chapter switch creates a new Editor with default editable=true, and a
  // chapterReloadKey bump remounts with fresh server content; in both cases
  // the read-only state from the failed reload no longer applies.
  useEffect(() => {
    editorMachine.dispatch({ type: "EDITOR_REMOUNTED" });
    // Key ONLY on the remount triggers + the stable useReducer dispatch.
    // Depending on the whole `editorMachine` (a useMemo that changes identity
    // on every state transition) would re-fire EDITOR_REMOUNTED on each
    // mutation event and spuriously clear the lock. dispatch is referentially
    // stable, so listing `editorMachine.dispatch` is correct and complete.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChapter?.id, chapterReloadKey, editorMachine.dispatch]);

  // Reconcile editable intent → TipTap (re-enable / re-assert direction only;
  // the lock-down false is synchronous-imperative in useEditorMutation). Reuses
  // safeSetEditable so a mid-remount throw is absorbed + logged once.
  useEffect(() => {
    safeSetEditable(editorRef, editorMachine.state.editable);
  }, [editorMachine.state.editable, activeChapter?.id, chapterReloadKey]);

  // Fetch chapter statuses with retry. statusesOp lives in the component
  // body (not inside the effect) so its identity is stable across renders;
  // the effect closes over the same controller-tracking hook each time.
  const statusesOp = useAbortableAsyncOperation();

  useEffect(() => {
    const { promise } = statusesOp.run(async (s) => {
      let attempts = 0;
      while (true) {
        if (s.aborted) return;
        try {
          const data = await api.chapterStatuses.list(s);
          if (s.aborted) return;
          setStatuses(data);
          return;
        } catch (err) {
          if (s.aborted) return;
          clientWarn("Failed to load chapter statuses:", err);
          if (attempts >= 2) {
            applyMappedError(mapApiError(err, "chapterStatus.fetch"), {
              onMessage: setActionError,
            });
            return;
          }
          attempts++;
          try {
            await sleep(2000 * attempts, s);
          } catch (sleepErr) {
            // S7 (review 2026-05-25): narrow the catch to abort only —
            // a bare `catch {}` would swallow a future non-abort throw
            // from sleep (e.g. a refactor that throws synchronously
            // before scheduling the timer) and mask the bug. Mirrors
            // the same predicate used in useProjectEditor's save loop.
            if (isAborted(sleepErr)) return;
            throw sleepErr;
          }
        }
      }
    });
    void promise;
  }, [setActionError, statusesOp]);

  const handleStatusChangeWithError = useCallback(
    (chapterId: string, status: ChapterStatusValue) => {
      // I4: status PATCHes the same chapter row an in-flight replace may
      // be writing. Allowing it to slip past the busy guard races two
      // writes against the same row. Mirror handleCreateChapterGuarded.
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      // I1 (review 2026-04-21): refuse while the editor-locked banner is up.
      // Sibling sidebar guards all check this; without it, a status PATCH
      // fires against a chapter the user was told to refresh after a
      // possibly-committed restore/replace.
      if (editorMachine.isLocked()) {
        setActionInfo(STRINGS.editor.lockedRefusal);
        return;
      }
      setActionError(null);
      handleStatusChange(chapterId, status, setActionError);
    },
    [handleStatusChange, setActionError, isActionBusy, editorMachine],
  );

  const handleRenameChapterWithError = useCallback(
    (chapterId: string, title: string) => {
      // I4: same rationale as handleStatusChangeWithError — the PATCH
      // targets the chapter row an in-flight replace may be writing.
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      // I2 (review 2026-04-21): refuse while the editor-locked banner is up.
      // The inline title editor (useChapterTitleEditing) gates on
      // isEditorLocked, but the sidebar entry point did not — a sidebar
      // rename while the lock banner is up would PATCH a chapter the user
      // was told to refresh.
      if (editorMachine.isLocked()) {
        setActionInfo(STRINGS.editor.lockedRefusal);
        return;
      }
      setActionError(null);
      handleRenameChapter(chapterId, title, setActionError);
    },
    [handleRenameChapter, setActionError, isActionBusy, editorMachine],
  );

  // I4: handleReorderChapters rebuilds the chapter list from pre-mutation
  // word counts and calls setProject(...) — allowed through unguarded,
  // a reorder during an in-flight replace pins the other chapters'
  // counts to their pre-replace values until the next full project
  // reload.
  const handleReorderChaptersGuarded = useCallback(
    (orderedIds: string[]) => {
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      // I4 (review 2026-04-21): refuse while the editor-locked banner is up.
      // A reorder doesn't by itself dismiss the banner, but the persistent
      // "refresh the page" banner means the editor state is ambiguous;
      // mutating the project structure underneath makes the ambiguity worse.
      if (editorMachine.isLocked()) {
        setActionInfo(STRINGS.editor.lockedRefusal);
        return;
      }
      setActionError(null);
      handleReorderChapters(orderedIds, setActionError);
    },
    [handleReorderChapters, isActionBusy, setActionError, editorMachine],
  );

  const switchToView = useCallback(
    async (mode: ViewMode): Promise<boolean> => {
      // Refuse view switches while a useEditorMutation.run() is in-flight
      // (I2): switchToView's flushSave would abort the mutation's save
      // controller and the user could click away mid-replace, racing the
      // hook's awaited flush against this hand-composed flush. Surface the
      // same busy banner the run-routed callers use so the click is not
      // silently dropped.
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return false;
      }
      // Refuse view switches while the editor is locked (C2). The lock
      // banner is non-dismissible and tells the user to refresh — we must
      // not let an editor->preview->editor round trip remount the Editor
      // with editable=true while the banner persists, since the remount
      // alone restores writability and the next keystroke schedules an
      // auto-save that overwrites the server-committed mutation. The
      // banner is already on screen; no second banner needed.
      if (editorMachine.isLocked()) {
        return false;
      }
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
      //
      // Disable the editor BEFORE awaiting flushSave (invariant 2, I1):
      // during a slow flush (seconds in save backoff) keystrokes would
      // otherwise re-dirty the editor and schedule a new debounced save
      // that fires AFTER the view switch, desyncing editor state from
      // the displayed view. Mirrors SnapshotPanel.onView and the three
      // mutation.run() callers.
      safeSetEditable(editorRef, false);
      let flushed: boolean;
      try {
        flushed = (await editorRef.current?.flushSave()) ?? true;
      } catch (err) {
        // A flush throw must not leave the editor in an inconsistent state
        // and must not surface as an unhandled rejection (C2): callers like
        // handleSelectChapterWithFlush void this promise via the sidebar
        // click handler and have no try/catch. Convert to a save-failed
        // banner + false return — the same shape as a flushed:false reject.
        //
        // S2 (agentic-review 2026-05-26): the chapter.flushBeforeNavigate
        // scope was added in this PR for this exact case (flush failure
        // observed BEFORE navigation completes) but had been wired only
        // to handleSelectChapterWithFlush's defensive outer catch, which
        // is unreachable today (this catch already converts throws to a
        // banner+false return). Route the mapping here so the scope has
        // a real reachable site and the NETWORK case gets the scope's
        // transient-specific `flushBeforeNavigateFailedNetwork` copy
        // instead of the generic viewSwitchSaveFailed string.
        safeSetEditable(editorRef, true);
        clientWarn("switchToView: flushSave threw", err);
        applyMappedError(mapApiError(err, "chapter.flushBeforeNavigate"), {
          onMessage: setActionError,
        });
        return false;
      }
      if (!flushed) {
        safeSetEditable(editorRef, true);
        setActionError(STRINGS.editor.viewSwitchSaveFailed);
        return false;
      }
      setTrashOpen(false);
      setViewMode(mode);
      if (mode === "dashboard") {
        setDashboardRefreshKey((k) => k + 1);
      }
      // View-switch succeeded; re-enable so the editor is writable when
      // the user returns to editor mode. (Preview/Dashboard unmount the
      // Editor, so this primarily covers the editor→editor no-op path
      // and any transitional render between switch and remount.) Skipped
      // when the lock is set (defensive — switchToView refuses above when
      // locked, but a future refactor that loosens the gate must still
      // honor the lock here).
      if (!editorMachine.isLocked()) {
        safeSetEditable(editorRef, true);
      }
      return true;
    },
    [setTrashOpen, setActionError, isActionBusy, editorMachine],
  );

  // mutation.isBusy() guards for entry points that either (a) bump the save
  // seq behind the hook's back — aborting its in-flight flushSave or
  // reload GET — or (b) remount the Editor while the hook holds a stale
  // pre-remount handle. Sidebar create/delete clicks and Ctrl+Shift+N all
  // trigger handleCreateChapter / handleDeleteChapter which call
  // cancelInFlightSave(); setDeleteTarget opens the confirm dialog that
  // leads to the same; openTrash changes route state (I2). Without these
  // guards, clicks during a 2–14s replace/restore flush produce
  // misattributed "save failed" banners or silently defeat the editor
  // lock.
  const handleCreateChapterGuarded = useCallback(() => {
    if (isActionBusy()) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    // I4 (review 2026-04-21): refuse while the lock banner is up. Create
    // switches the active chapter, which fires the [activeChapter?.id]
    // remount effect and dispatches EDITOR_REMOUNTED — silently dismissing
    // a banner that was intentionally persistent. The title-edit hooks and
    // snapshot view already consult isEditorLocked; mirror that here.
    if (editorMachine.isLocked()) {
      setActionInfo(STRINGS.editor.lockedRefusal);
      return;
    }
    setActionError(null);
    handleCreateChapter(setActionError);
  }, [isActionBusy, handleCreateChapter, setActionError, editorMachine]);

  const requestDeleteChapter = useCallback(
    (chapter: Chapter) => {
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      // I4 (review 2026-04-21): refuse while the lock banner is up.
      // handleDeleteChapter switches the active chapter on success, which
      // fires the [activeChapter?.id] remount effect and dispatches
      // EDITOR_REMOUNTED, silently clearing the lock. The banner that was
      // telling the user "refresh the page because your state is ambiguous"
      // disappears, and the new chapter's editor is enabled — whatever
      // ambiguity triggered the lock is now invisible. Same rationale as
      // title-edit / snapshot view.
      if (editorMachine.isLocked()) {
        setActionInfo(STRINGS.editor.lockedRefusal);
        return;
      }
      setDeleteTarget(chapter);
    },
    [isActionBusy, setDeleteTarget, editorMachine],
  );

  const openTrashGuarded = useCallback(() => {
    if (isActionBusy()) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    // I4: refuse while the lock banner is up. Trash view unmounts the
    // editor, implicitly clearing the lock reminder — consistent with
    // the other guarded entry points.
    if (editorMachine.isLocked()) {
      setActionInfo(STRINGS.editor.lockedRefusal);
      return;
    }
    openTrash();
  }, [isActionBusy, openTrash, editorMachine]);

  const handleSelectChapterWithFlush = useCallback(
    async (chapterId: string) => {
      // Chapter-select side-effects (seq bump, in-flight save abort, load
      // next chapter) must not run when switchToView refused — otherwise
      // we silently abandon an unsaved chapter while simultaneously
      // showing a banner that implies navigation was blocked.
      // Wrap in try/catch (C2): switchToView's error paths now degrade to
      // a banner + false return, but a future refactor that re-introduces
      // a throw must not surface as an unhandled rejection through the
      // Sidebar click handler (which voids this promise).
      try {
        const switched = await switchToView("editor");
        if (!switched) return;
        await handleSelectChapter(chapterId);
      } catch (err) {
        clientWarn("handleSelectChapterWithFlush failed", err);
        // S2 (agentic-review 2026-05-26): this outer catch is defensive
        // — switchToView converts its own throws to false+banner, and
        // handleSelectChapter catches all its own errors. The only path
        // that can reach this catch is a future refactor that
        // reintroduces a throw from handleSelectChapter (chapter.load
        // context). The chapter.flushBeforeNavigate scope was relocated
        // to switchToView's catch (the actual flush-throw site) where
        // its copy is meaningful.
        applyMappedError(mapApiError(err, "chapter.load"), {
          onMessage: setActionError,
        });
      }
    },
    [handleSelectChapter, switchToView, setActionError],
  );

  const handleProjectSettingsUpdate = useCallback(() => {
    // I5: Gate the GET + setProject merge behind the mutation/action busy
    // latches. Running concurrent setProject writes from the settings
    // refresh and an in-flight mutation can interleave; FindReplace state
    // reset on project id change (useFindReplaceState) can also discard a
    // pending search that the user hasn't had a chance to re-kick-off.
    // Surface the mutationBusy banner so the user knows the refresh was
    // deferred and can retry once the mutation settles.
    if (mutation.isBusy() || isActionBusy()) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    setDashboardRefreshKey((k) => k + 1);
    if (slug) {
      // I11 (review 2026-04-25): abort prior in-flight refresh and
      // thread the signal so the .then/.catch can drop on unmount.
      const { promise, signal } = settingsRefreshOp.run((s) => api.projects.get(slug, s));
      promise
        .then((data) => {
          if (signal.aborted) return;
          // S7 (review 2026-04-21): re-check busy before merging. The
          // entry gate above guarantees no mutation was in flight when
          // we dispatched the GET, but a mutation can start during the
          // in-flight GET — its commit writes post-mutation top-level
          // fields (target word count / deadline / mode) to state, and
          // this .then would then stomp them with the pre-mutation GET
          // response. Skip the merge; a subsequent refresh picks up
          // the post-mutation state once the mutation settles.
          if (mutation.isBusy() || isActionBusy()) return;
          setProject((prev) => {
            if (!prev) return data;
            // I3 (review 2026-04-21): cross-project race. If the user
            // navigated A→B while api.projects.get(A) was in flight,
            // `prev` now reflects B but `data` carries A's top-level
            // metadata. Merging {...data, chapters: prev.chapters}
            // would splice A's title/slug/mode/targets onto B's
            // chapter list silently. Refuse the merge on id mismatch;
            // a later settings refresh on B will pick up B's state.
            if (prev.id !== data.id) return prev;
            return { ...data, chapters: prev.chapters };
          });
        })
        .catch((err: unknown) => {
          // I11: drop on unmount or supersession.
          if (signal.aborted) return;
          // I12 (review 2026-04-25): mirror the success-path busy gate
          // in the catch branch. A settings GET that fails while the
          // editor is mid-mutation would otherwise surface a banner
          // that fights with the mutation's own UI state. Skip the
          // banner; a subsequent refresh after the mutation settles
          // can re-surface a real failure.
          if (mutation.isBusy() || isActionBusy()) return;
          // 404 after a settings update means the project was deleted
          // (or purged) from another tab/request — refreshing here would
          // leave the user staring at a stale editor with a retry banner
          // that can never succeed. Navigate home so the projects list
          // reflects the new reality. Transient network failures still
          // land on the dismissible banner.
          if (isNotFound(err)) {
            navigate("/");
            return;
          }
          applyMappedError(mapApiError(err, "project.load"), { onMessage: setActionError });
        });
    }
  }, [slug, setProject, setActionError, navigate, mutation, isActionBusy, settingsRefreshOp]);

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
    // I2: Gate Ctrl+S on the same busy-latch the other external flushSave
    // entries (snapshot view / create, chapter switch) observe. A Ctrl+S
    // during a mid-flight mutation.run would otherwise fire a save whose
    // AbortController race churns the hook's stage reporting and can
    // commit two PATCHes for the same chapter.
    //
    // Also gate on the persistent lock banner. handleSaveLockGated returns
    // false while the banner is up; Editor.flushSave maps that to "save
    // failed" and flips the indicator to error without any server attempt.
    // The banner already tells the user to refresh — swallowing Ctrl+S
    // silently here avoids scaring them into clearing the banner context
    // with a refresh that drops their unsaved-local state.
    // I1 (review 2026-04-21): wrap the flushSave call in try/catch
    // matching switchToView, SnapshotPanel.onView, and onBeforeCreate.
    // Editor.flushSave calls editor.getJSON() synchronously, which can
    // throw during a TipTap mid-remount, and the returned promise can
    // also reject from an onSave rejection. useKeyboardShortcuts
    // invokes this callback as `flushSaveRef.current?.()` without
    // awaiting — a sync throw escapes the keydown handler; a promise
    // rejection surfaces as an unhandled rejection. Either bypasses
    // the save-failed banner discipline every other flushSave entry
    // point observes. Swallow to an actionError so the user gets the
    // same recoverable feedback as the other paths.
    flushSave: async () => {
      if (isActionBusy()) return;
      if (editorMachine.isLocked()) return;
      try {
        await editorRef.current?.flushSave();
      } catch (err) {
        clientWarn("Ctrl+S: flushSave threw", err);
        // I1 (review 2026-04-26, follow-up): the only reachable case here
        // is a synchronous TipTap throw (e.g. editor.getJSON() during a
        // mid-remount), which is NOT an ApiRequestError. Editor.flushSave's
        // .catch (Editor.tsx:334) swallows every promise rejection and
        // resolves false — the surrounding try/catch never sees an
        // ApiRequestError, NETWORK or otherwise. Routing through
        // mapApiError is therefore parity-with-prior-literal:
        // non-ApiRequestError short-circuits to scope.fallback =
        // STRINGS.editor.saveFailed, matching what the inline literal
        // produced before this catch existed. Routing kept (rather than
        // re-inlining the literal) for architectural consistency with
        // the CLAUDE.md "user-visible API errors go through mapApiError"
        // invariant — and to be future-proof if Editor.flushSave is ever
        // changed to re-throw, at which point this catch would meaningfully
        // surface saveFailedNetwork / byStatus / byCode copy. The
        // ?? STRINGS.editor.saveFailed defends against ABORTED-only
        // (mapApiError returns message: null).
        setActionError(mapApiErrorMessage(err, "chapter.save", STRINGS.editor.saveFailed));
      }
    },
    setShortcutHelpOpen,
    toggleSidebar,
    handleCreateChapter: handleCreateChapterGuarded,
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
      <EditorHeader
        projectTitle={project.title}
        onNavigateHome={() => navigate("/")}
        editingProjectTitle={editingProjectTitle}
        projectTitleDraft={projectTitleDraft}
        setProjectTitleDraft={setProjectTitleDraft}
        saveProjectTitle={saveProjectTitle}
        cancelEditingProjectTitle={cancelEditingProjectTitle}
        startEditingProjectTitle={startEditingProjectTitle}
        projectTitleError={projectTitleError}
        projectTitleInputRef={projectTitleInputRef}
        showActiveEditor={Boolean(showActiveEditor)}
        viewMode={viewMode}
        toolbarEditor={toolbarEditor}
        snapshotCount={snapshotCount}
        onToggleSnapshots={handleToggleSnapshotPanel}
        onToggleFindReplace={handleToggleFindReplace}
        snapshotsTriggerRef={snapshotsTriggerRef}
        findReplaceTriggerRef={findReplaceTriggerRef}
        onSwitchToView={switchToView}
        onOpenExport={() => setExportDialogOpen(true)}
        onToggleReferencePanel={handleToggleReferencePanel}
        panelOpen={panelOpen}
        onOpenSettings={() => setProjectSettingsOpen(true)}
      />

      <EditorMainContent
        sidebarOpen={sidebarOpen}
        sidebarWidth={sidebarWidth}
        onSidebarResize={handleSidebarResize}
        project={project}
        activeChapter={activeChapter}
        showActiveEditor={Boolean(showActiveEditor)}
        viewMode={viewMode}
        statuses={statuses}
        onSelectChapter={handleSelectChapterWithFlush}
        onAddChapter={handleCreateChapterGuarded}
        onDeleteChapter={requestDeleteChapter}
        onReorderChapters={handleReorderChaptersGuarded}
        onRenameChapter={handleRenameChapterWithError}
        onOpenTrash={openTrashGuarded}
        onStatusChange={handleStatusChangeWithError}
        editorLockedMessage={editorMachine.state.lock?.message ?? null}
        actionError={actionError}
        onDismissActionError={() => setActionError(null)}
        actionInfo={actionInfo}
        onDismissActionInfo={() => setActionInfo(null)}
        trashOpen={trashOpen}
        trashedChapters={trashedChapters}
        onRestore={handleRestore}
        onCloseTrash={() => setTrashOpen(false)}
        dashboardRefreshKey={dashboardRefreshKey}
        viewingSnapshot={viewingSnapshot}
        onRestoreSnapshot={handleRestoreSnapshot}
        onExitSnapshotView={exitSnapshotView}
        editingTitle={editingTitle}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        saveTitle={saveTitle}
        cancelEditingTitle={cancelEditingTitle}
        startEditingTitle={startEditingTitle}
        titleError={titleError}
        titleInputRef={titleInputRef}
        chapterReloadKey={chapterReloadKey}
        editorRef={editorRef}
        onSave={handleSaveLockGated}
        onContentChange={handleContentChange}
        onEditorReady={setToolbarEditor}
        onImageAnnouncement={(msg) => {
          if (imageAnnouncementTimerRef.current) {
            clearTimeout(imageAnnouncementTimerRef.current);
          }
          setImageAnnouncement(msg);
          imageAnnouncementTimerRef.current = setTimeout(() => setImageAnnouncement(""), 3000);
        }}
        onImageUploadCommitted={() => setGalleryExternalRefreshKey((k) => k + 1)}
        chapterWordCount={chapterWordCount}
        saveStatus={saveStatus}
        saveErrorMessage={saveErrorMessage}
        cacheWarning={cacheWarning}
        panelOpen={panelOpen}
        panelWidth={panelWidth}
        onPanelResize={handlePanelResize}
        galleryExternalRefreshKey={galleryExternalRefreshKey}
        onInsertImage={(url, alt) => {
          // I4: gate behind isActionBusy() like every other editor-
          // modifying entry point. Inserting during an in-flight
          // mutation fires onUpdate, sets dirtyRef=true on content
          // that is about to be overwritten, and schedules an auto-
          // save after the hook already markClean-ed.
          if (isActionBusy()) {
            setActionInfo(STRINGS.editor.mutationBusy);
            return;
          }
          editorRef.current?.insertImage(url, alt);
        }}
        snapshotPanelOpen={snapshotPanelOpen}
        onCloseSnapshotPanel={() => setSnapshotPanelOpen(false)}
        snapshotPanelRef={snapshotPanelRef}
        onSnapshotView={onSnapshotView}
        onSnapshotBeforeCreate={onSnapshotBeforeCreate}
        onSnapshotsChange={onSnapshotsChange}
        snapshotsTriggerRef={snapshotsTriggerRef}
        findReplace={findReplace}
        onReplaceOne={handleReplaceOne}
        onReplaceAllInChapter={handleReplaceAllInChapter}
        onReplaceAllInManuscript={handleReplaceAllInManuscript}
        findReplaceTriggerRef={findReplaceTriggerRef}
      />

      <EditorDialogs
        deleteTarget={deleteTarget}
        onConfirmDelete={confirmDeleteChapter}
        onCancelDelete={() => setDeleteTarget(null)}
        replaceConfirmation={replaceConfirmation}
        setReplaceConfirmation={setReplaceConfirmation}
        executeReplace={executeReplace}
        navAnnouncement={navAnnouncement}
        wordCountAnnouncement={wordCountAnnouncement}
        imageAnnouncement={imageAnnouncement}
        project={project}
        projectSettingsOpen={projectSettingsOpen}
        onCloseSettings={() => setProjectSettingsOpen(false)}
        onSettingsUpdate={handleProjectSettingsUpdate}
        shortcutHelpOpen={shortcutHelpOpen}
        onCloseShortcutHelp={() => setShortcutHelpOpen(false)}
        exportDialogOpen={exportDialogOpen}
        onCloseExport={() => setExportDialogOpen(false)}
      />
    </div>
  );
}
