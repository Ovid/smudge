import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Chapter, ChapterStatusRow } from "@smudge/shared";
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
import { clearCachedContent, clearAllCachedContent } from "../hooks/useContentCache";
import { safeSetEditable } from "../utils/editorSafeOps";
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

  // I6 (review 2026-04-21): latest-ref for slug so finalizeReplaceSuccess
  // reads the CURRENT slug at completion time, not the one captured when
  // the callback was created. Without this, a project rename mid-replace
  // would leave the closure pointing at the old slug — the post-replace
  // findReplace.search call 404s against the stale slug, pinning a
  // searchProjectNotFound error banner next to a successful replace.
  const slugRef = useRef(slug);
  slugRef.current = slug;

  // Editor handle is declared here (above useEditorMutation + the migrated
  // mutation callbacks) so the hook can capture the ref and the callbacks
  // below can read editorRef.current safely.
  const editorRef = useRef<EditorHandle | null>(null);

  // Latest-ref for the lock predicate: the hook captures the callback once
  // but must see the current editorLockedMessage state when finally runs.
  // Without this, a run() callback closure would be stale and the gate
  // below would never fire after the banner was set (I1).
  const editorLockedMessageRef = useRef(editorLockedMessage);
  editorLockedMessageRef.current = editorLockedMessage;

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
      if (editorLockedMessageRef.current !== null) return false;
      return handleSave(content, chapterId);
    },
    [handleSave],
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
    // When a prior run left the editor in the reload-failed lock state,
    // the persistent "refresh the page" banner is on screen and the editor
    // is read-only. A subsequent successful run's finally must NOT
    // re-enable the editor (I1) — the user, trusting the banner, would be
    // refreshing; any keystroke between now and that refresh would PATCH
    // pre-mutation content back over the server's committed change.
    isLocked: () => editorLockedMessageRef.current !== null,
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
  const isEditorLocked = useCallback(() => editorLockedMessageRef.current !== null, []);

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
  }, [panelOpen, setSnapshotPanelOpen, exitSnapshotView, findReplace, togglePanel, isActionBusy]);

  const handleToggleFindReplace = useCallback(() => {
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
  }, [findReplace, setPanelOpen, setSnapshotPanelOpen, exitSnapshotView, isActionBusy]);

  const handleRestoreSnapshot = useCallback(async () => {
    if (!viewingSnapshot || !activeChapter) return;

    // C1 defense-in-depth: the SnapshotBanner button is gated on
    // editorLockedMessage === null, but refuse here too so any
    // programmatic caller (or future non-button entry point) cannot
    // double-restore against an already-committed snapshot while the
    // lock banner is showing. The button gate is the UX affordance;
    // this is the invariant.
    //
    // S5: announce the busy banner alongside the refusal, matching
    // executeReplace/handleReplaceOne's lock-banner branch. Under normal
    // operation the SnapshotBanner's canRestore gate suppresses the click
    // entirely, so this runs only on a programmatic call — but the
    // sibling replace paths surface the same copy for the same state, and
    // diverging here would leave a future non-button caller silently
    // dropping clicks.
    if (editorLockedMessageRef.current !== null) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }

    // I5 entry guard: actionBusyRef extends the busy window past
    // mutation.run()'s release into the post-run banner/refresh work,
    // preventing a second click from racing trailing setActionError /
    // setActionInfo of an in-flight handler.
    if (isActionBusy()) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    actionBusyRef.current = true;
    try {
      // Clear stale action banners on entry: a previous failure or success
      // banner must not co-display with whatever this restore produces. The
      // two find-replace callers below also do this. Mirror them in clearing
      // findReplace.error (S3) so an old panel-local search-failed message
      // doesn't linger next to the restore outcome.
      setActionError(null);
      setActionInfo(null);
      findReplace.clearError();

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
        //
        // NOTE: This branch deliberately uses the CLOSURE activeChapter.id
        // (not getActiveChapter() like executeReplace/handleReplaceOne).
        // The restore was initiated against a specific snapshot of a
        // specific chapter — its cache-clear and reloadChapterId must
        // target that chapter, not whichever chapter is active when the
        // server response lands. useSnapshotState's stale-detection at
        // useSnapshotState.ts only clears the cache for the chapter the
        // restore targeted; mirroring that here keeps the contract aligned.
        if (stale) {
          return {
            clearCacheFor: [],
            reloadActiveChapter: false,
            data: { staleChapterSwitch: true },
          };
        }
        return {
          clearCacheFor: [activeChapter.id],
          reloadActiveChapter: true,
          // Scope the reload to the chapter the restore targets. If the user
          // switches between here and the hook's reload call, the mismatch
          // skips the reload and preserves the now-active chapter's draft.
          reloadChapterId: activeChapter.id,
          data: { staleChapterSwitch: false },
        };
      });

      if (result.ok) {
        if (!result.data.staleChapterSwitch) {
          snapshotPanelRef.current?.refreshSnapshots();
          // The server wrote a pre-restore auto-snapshot; the toolbar
          // badge is now stale by one. The panel-handle refresh above
          // is a no-op when the panel is closed (the typical state for
          // a SnapshotBanner-initiated restore), so drive the count
          // directly — mirrors finalizeReplaceSuccess and the error
          // branches below (I1).
          refreshSnapshotCount();
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
        // I2 (review 2026-04-20): defense-in-depth cache-clear mirroring
        // the possibly_committed branch below. The hook's stage:"reload"
        // path normally handles cache-clear (including the C1 fix for the
        // mid-remount re-lock bail), but without a redundant clear here
        // the restore branch has no backstop if a future hook refactor
        // introduces a gap between "server commit" and "cache wipe".
        // The replace flow converges through finalizeReplaceSuccess which
        // has its own convergence logic; restore has no equivalent, so
        // mirror the possibly_committed branch's defense-in-depth.
        clearCachedContent(activeChapter.id);
        // Defensive re-lock to match finalizeReplaceSuccess's convergence
        // rationale: restore's stage:"reload" currently relies on the
        // hook's reloadFailed path keeping the editor read-only, but a
        // future refactor of useEditorMutation's finally could let a
        // mid-remount throw re-enable the editor after the banner is set.
        // Applying safeSetEditable(false) here means both mutation callers
        // (replace and restore) converge on the same invariant: lock
        // banner and editor state never disagree. safeSetEditable swallows
        // mid-remount throws so the follow-up refreshSnapshotCount still
        // runs.
        safeSetEditable(editorRef, false);
        snapshotPanelRef.current?.refreshSnapshots();
        // Same rationale as the happy path: the server committed the
        // restore + pre-restore auto-snapshot. Without this, the toolbar
        // badge silently understates the count until the user opens the
        // panel or switches chapters — and the typical SnapshotBanner-
        // initiated restore leaves the panel closed (I1).
        refreshSnapshotCount();
        return;
      }
      // stage === "mutate"
      if (result.error instanceof RestoreAbortedError) return;
      if (result.error instanceof RestoreFailedError) {
        // I7: AbortController-cancelled restore is not user-facing. Mirrors
        // RestoreAbortedError's silent return. No path triggers this today
        // (restoreSnapshot has no AbortController wired) — the early return
        // is in place so a future wiring does not surface a misleading
        // banner.
        if (result.error.reason === "aborted") return;
        if (result.error.reason === "possibly_committed") {
          // 2xx BAD_JSON on restore: server likely committed the restore
          // (and its auto-snapshot) but the response body was unreadable.
          // Treat the same as stage:"reload" — persistent lock banner, no
          // retry prompt, since retrying could double-restore (C2).
          //
          // I2 (review 2026-04-21): the lock banner and safeSetEditable
          // are global / editor-ref-scoped, so they pin to the currently-
          // active editor. If the user switched chapters between restore
          // dispatch and the possibly_committed response landing, this
          // branch would lock the chapter they are now looking at — which
          // the restore never touched. Check the live active chapter
          // against the original restore target; on mismatch, clear the
          // target's cache (still correct) but surface a dismissible
          // action error instead of pinning a banner and disabling a
          // chapter the user didn't restore.
          clearCachedContent(activeChapter.id);
          const currentId = getActiveChapter()?.id;
          if (currentId !== undefined && currentId !== activeChapter.id) {
            setActionError(STRINGS.snapshots.restoreResponseUnreadable);
            snapshotPanelRef.current?.refreshSnapshots();
            refreshSnapshotCount();
            return;
          }
          setEditorLockedMessage(STRINGS.snapshots.restoreResponseUnreadable);
          // Lock-banner state doesn't enforce read-only by itself; the
          // hook's finally already re-enabled the editor after the
          // mutate-stage throw. Re-apply setEditable(false) so auto-save
          // cannot overwrite a possibly-committed restore. Wrapped in
          // safeSetEditable (I2): TipTap can throw synchronously during the
          // mid-remount window, and an unwrapped throw here would skip the
          // snapshot panel refresh and leave the lock banner without its
          // companion editor-state change.
          safeSetEditable(editorRef, false);
          snapshotPanelRef.current?.refreshSnapshots();
          // The server almost certainly just committed a restore + its
          // auto-snapshot. Drive the toolbar badge directly (I1) — the
          // panel-handle refresh above is a no-op when the panel is
          // closed, which is the typical state for a SnapshotBanner-
          // initiated restore. Without this, the badge silently displays
          // a stale pre-restore count after an opaque-but-likely-
          // committed 2xx BAD_JSON.
          refreshSnapshotCount();
          return;
        }
        if (result.error.reason === "corrupt_snapshot") {
          setActionError(STRINGS.snapshots.restoreFailedCorrupt);
          // I2: corrupt_snapshot is permanent — the snapshot JSON cannot
          // be parsed, so re-clicking Restore will always fail the same
          // way. Dismiss the banner so the user can't loop on it.
          exitSnapshotView();
        } else if (result.error.reason === "cross_project_image") {
          setActionError(STRINGS.snapshots.restoreFailedCrossProjectImage);
          // I2: cross_project_image is a permanent rejection too — the
          // snapshot references images that no longer belong to this
          // project. Dismiss the banner; the user has no recovery path
          // from this snapshot.
          exitSnapshotView();
        } else if (result.error.reason === "not_found") {
          setActionError(STRINGS.snapshots.restoreFailedNotFound);
          // I6: The snapshot is gone from the server, so the SnapshotBanner
          // for it must also leave the screen. Without this, the user sees
          // "Viewing snapshot from <date>" with a Restore button that will
          // always 404 — and the server's auto-created pre-restore snapshot
          // list refresh does not dismiss the banner by itself.
          exitSnapshotView();
        } else if (result.error.reason === "network") {
          // Mirror mapReplaceErrorToMessage's NETWORK branch so offline restores
          // tell the user to check their connection rather than showing the
          // generic "try again" copy. Without this, a sibling mutation (replace)
          // gives connection-specific guidance for the same root cause while
          // restore does not (I1).
          setActionError(STRINGS.snapshots.restoreNetworkFailed);
        } else {
          // reason === "unknown": the caught error was not an ApiRequestError
          // (e.g. TypeError on a malformed response, reject-before-send). The
          // server commit status is genuinely ambiguous — treat pessimistically
          // and raise the lock banner rather than a dismissible "try again"
          // that could double-restore if the server already committed (I7).
          //
          // I2 (review 2026-04-21): mirror the possibly_committed stale-
          // chapter-switch check. Lock banner and safeSetEditable are
          // scoped to the currently-active editor; if the user moved to a
          // different chapter while the restore was in flight, we would
          // otherwise pin the persistent banner to a chapter the restore
          // never touched. Clearing the original target's cache is still
          // correct in either case.
          clearCachedContent(activeChapter.id);
          const currentId = getActiveChapter()?.id;
          if (currentId !== undefined && currentId !== activeChapter.id) {
            setActionError(STRINGS.snapshots.restoreResponseUnreadable);
          } else {
            setEditorLockedMessage(STRINGS.snapshots.restoreResponseUnreadable);
            safeSetEditable(editorRef, false);
          }
        }
        // I6: Refresh the snapshot list on every error branch. The
        // not_found branch is the sharpest case — without a refresh, the
        // stale snapshot row remains clickable and the user loops through
        // the same 404. Mirrors the sibling handleReplaceOne 404 path
        // which refreshes its result set for the same reason. The
        // possibly_committed branch above returns before reaching this
        // line and runs its own refresh.
        snapshotPanelRef.current?.refreshSnapshots();
        // Drive the toolbar snapshot count the same way finalizeReplaceSuccess
        // does (I1). The `unknown` branch above locked the editor because
        // the server commit is ambiguous — if the server did commit, it
        // also wrote an auto-snapshot, and the panel-handle refresh is a
        // no-op when the panel is closed. For branches where the server
        // clearly did NOT commit (corrupt_snapshot, cross_project_image,
        // not_found, network), this is at most a redundant fetch — no
        // new snapshot exists, so the count is unchanged. Cheaper than
        // branching for the narrow "know-nothing-happened" cases.
        refreshSnapshotCount();
        return;
      }
      setActionError(STRINGS.snapshots.restoreFailed);
    } finally {
      actionBusyRef.current = false;
    }
  }, [
    viewingSnapshot,
    activeChapter,
    restoreSnapshot,
    snapshotPanelRef,
    setActionError,
    mutation,
    findReplace,
    isActionBusy,
    exitSnapshotView,
    refreshSnapshotCount,
    getActiveChapter,
  ]);

  // Shared post-replace bookkeeping for executeReplace and handleReplaceOne,
  // covering both ok and stage:"reload" branches. Without this, four nearly
  // identical sequences (search refetch + snapshot refresh + count bump +
  // success banner + optional lock banner) drift independently.
  const finalizeReplaceSuccess = useCallback(
    async ({
      replacedCount,
      reloadFailed,
      lockMessage,
    }: {
      replacedCount: number | null;
      reloadFailed: boolean;
      // Override banner copy (used for the 2xx BAD_JSON "possibly committed"
      // path — C1). Defaults to replaceSucceededReloadFailed when reloadFailed
      // is true and no override is provided.
      lockMessage?: string;
    }) => {
      // I6 (review 2026-04-21): read the LIVE slug from the ref instead of
      // the closure-captured value. A project rename that lands mid-replace
      // updates slug state to the new slug, but this callback was bound
      // with the old one — without the ref, findReplace.search(oldSlug)
      // 404s and pins a searchProjectNotFound error banner next to the
      // replace's success banner.
      const currentSlug = slugRef.current;
      if (!currentSlug) return;
      // Set the lock banner BEFORE awaiting the search refresh (I4). The
      // search request can take hundreds of milliseconds; during that window
      // the editor is already setEditable(false) but without a banner, the
      // user sees an unresponsive editor with no explanation.
      if (reloadFailed) {
        setEditorLockedMessage(lockMessage ?? STRINGS.findReplace.replaceSucceededReloadFailed);
        // The lock banner is UI-only — it does not itself make the editor
        // read-only. In the stage:"reload" path the hook kept the editor
        // setEditable(false) (reloadFailed branch skips the finally's
        // re-enable). In the stage:"mutate" 2xx BAD_JSON path the hook's
        // finally already re-enabled it. Call setEditable(false) here so
        // both callers converge on the same read-only invariant — the
        // banner and the editor state never disagree (C1). Wrapped in
        // safeSetEditable (I2) so a TipTap mid-remount throw does not
        // skip the awaited search refresh below.
        safeSetEditable(editorRef, false);
      }
      // findReplace.search catches network/5xx/4xx internally and resolves
      // void — see useFindReplaceState's search(). No external try/catch
      // is needed here.
      await findReplace.search(currentSlug);
      snapshotPanelRef.current?.refreshSnapshots();
      // Panel-handle refresh is a no-op when the snapshot panel is closed
      // (ref is null). Replace just created N auto-snapshots, so drive the
      // toolbar count directly via the hook.
      refreshSnapshotCount();
      // Suppress the "Replaced N occurrences" banner when the count is
      // unknown (2xx BAD_JSON — the response body was unreadable so we
      // don't have an authoritative replaced_count to surface).
      if (replacedCount !== null) {
        setActionInfo(STRINGS.findReplace.replaceSuccess(replacedCount));
      }
    },
    [findReplace, snapshotPanelRef, refreshSnapshotCount],
  );

  const executeReplace = useCallback(
    async (frozen: {
      scope: { type: "project" } | { type: "chapter"; chapter_id: string };
      query: string;
      replacement: string;
      options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
    }) => {
      if (!project || !slug) return;

      // C1: Refuse further server-side writes while the lock banner is up.
      // A prior restore/replace 2xx BAD_JSON leaves the "refresh the page"
      // banner active (see handleRestoreSnapshot:260); without this guard a
      // user could open Ctrl+H and issue another replace, firing a fresh
      // PATCH + auto-snapshot while the UI claims nothing will touch server
      // state. Mirror handleRestoreSnapshot's guard exactly.
      if (editorLockedMessageRef.current !== null) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }

      // I5 entry guard: see actionBusyRef definition above.
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      actionBusyRef.current = true;
      try {
        // Clear any stale banners so a prior op's error/success cannot
        // co-display with this op's outcome — including the panel-local
        // findReplace.error (S3), which would otherwise leave a failed
        // search's message inside the panel next to a fresh success
        // banner above it.
        setActionInfo(null);
        setActionError(null);
        findReplace.clearError();

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
          if (reload && current) {
            return {
              clearCacheFor: resp.affected_chapter_ids,
              reloadActiveChapter: true,
              reloadChapterId: current.id,
              data: resp,
            };
          }
          return {
            clearCacheFor: resp.affected_chapter_ids,
            reloadActiveChapter: false,
            data: resp,
          };
        });

        if (result.ok) {
          const resp = result.data;
          // Always surface a positive success banner so the user can
          // distinguish "did nothing because something went wrong" from
          // "finished with no user-visible change". When chapters were
          // skipped due to corrupt content, show the warning through the
          // error banner as well — success and warning are distinct
          // regions, not competing for the same slot.
          await finalizeReplaceSuccess({
            replacedCount: resp.replaced_count,
            reloadFailed: false,
          });
          if (resp.skipped_chapter_ids && resp.skipped_chapter_ids.length > 0) {
            setActionError(
              STRINGS.findReplace.skippedAfterReplace(resp.skipped_chapter_ids.length),
            );
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
          await finalizeReplaceSuccess({
            replacedCount: result.data.replaced_count,
            reloadFailed: true,
          });
          return;
        }
        // stage === "mutate"
        const err = result.error;
        // 2xx BAD_JSON: apiFetch throws an ApiRequestError(status=2xx,
        // code="BAD_JSON") when a 2xx body fails to parse (client.ts:86-92).
        // The server almost certainly committed the replace (and the
        // auto-snapshot) and only the response body was unreadable. The
        // previous handler only showed a dismissible banner and re-enabled
        // the editor — auto-save's next debounced PATCH would then silently
        // revert the committed replace (C1). Route to the persistent lock
        // UX so the editor stays setEditable(false) until refresh.
        if (
          err instanceof ApiRequestError &&
          err.code === "BAD_JSON" &&
          err.status >= 200 &&
          err.status < 300
        ) {
          // Clear caches for chapters the server may have replaced (C1). The
          // mutate callback threw, so the hook's directive-based cache-clear
          // never ran. The response body was unreadable, so
          // affected_chapter_ids is unavailable.
          //
          // I4: For project-scope we previously fell back to clearing
          // EVERY project chapter's cache — but the server-side replace
          // may have only touched one or a few chapters, and wiping drafts
          // in an unrelated chapter the user had unsaved work in was a
          // real data-loss path. The hook-flush guarantees the ACTIVE
          // chapter's cache is consistent with the server's post-mutate
          // state (invariants 1–3), so clear that one and rely on the
          // lock banner + refresh flow to reconcile the rest. Every
          // other chapter's cache is preserved; the next navigation
          // reloads server state against the cached draft exactly as the
          // non-BAD_JSON flow does.
          //
          // Edge case — project scope with no active chapter: if the
          // user has no chapter open (e.g. Trash/Dashboard view at click
          // time), the "clear the active chapter" fallback is a no-op
          // and localStorage drafts for every chapter are left intact.
          // After the user follows the lock banner's refresh prompt and
          // opens a chapter the replace may have touched, the cached
          // draft would re-hydrate and the next auto-save would revert
          // the server-committed replace. Since affected_chapter_ids is
          // unreadable (that's why we're here), clear every project
          // chapter's cache as the least-bad choice: any draft present
          // in this narrow window pre-dates the current session's
          // editing (no chapter was open to be typed into), so the
          // data-loss risk that motivated the selective-clear above does
          // not apply here.
          const activeChapterId = getActiveChapter()?.id;
          if (frozen.scope.type === "chapter") {
            clearCachedContent(frozen.scope.chapter_id);
          } else if (activeChapterId) {
            clearCachedContent(activeChapterId);
          } else if (project) {
            clearAllCachedContent(project.chapters.map((c) => c.id));
          }
          await finalizeReplaceSuccess({
            replacedCount: null,
            reloadFailed: true,
            lockMessage: STRINGS.findReplace.replaceResponseUnreadable,
          });
          return;
        }
        const msg = mapReplaceErrorToMessage(err);
        if (msg) setActionError(msg);
      } finally {
        actionBusyRef.current = false;
      }
    },
    [
      project,
      slug,
      findReplace,
      finalizeReplaceSuccess,
      getActiveChapter,
      setActionError,
      mutation,
      isActionBusy,
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

      // C1: Same lock-banner guard as executeReplace/handleRestoreSnapshot.
      // Per-match Replace must not issue a server write while the lock
      // banner claims nothing will touch server state until refresh.
      if (editorLockedMessageRef.current !== null) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }

      // I5 entry guard: extends busy past mutation.run() into the
      // post-run search refresh + banner work to prevent overlapping
      // banner sets from rapid clicks.
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      actionBusyRef.current = true;
      try {
        // Mirror executeReplace: clear any stale banners from a prior op so
        // the new replace's outcome does not co-display with an unrelated
        // success or error message — including the panel-local
        // findReplace.error (S3).
        setActionInfo(null);
        setActionError(null);
        findReplace.clearError();

        type ReplaceData = Awaited<ReturnType<typeof api.search.replace>>;

        const result = await mutation.run<ReplaceData>(async () => {
          const resp = await api.search.replace(
            slug,
            frozenQuery,
            frozenReplacement,
            frozenOptions,
            {
              type: "chapter",
              chapter_id: chapterId,
              match_index: matchIndex,
            },
          );
          const current = getActiveChapter();
          // Replace-one with 0 count means the match was gone on the server —
          // emit no cache clear / no reload; the ok branch will surface the
          // matchNotFound banner and re-run the search.
          const reload =
            resp.replaced_count > 0 && !!current && resp.affected_chapter_ids.includes(current.id);
          const clearCacheFor = resp.replaced_count > 0 ? resp.affected_chapter_ids : [];
          if (reload && current) {
            return {
              clearCacheFor,
              reloadActiveChapter: true,
              reloadChapterId: current.id,
              data: resp,
            };
          }
          return {
            clearCacheFor,
            reloadActiveChapter: false,
            data: resp,
          };
        });

        if (result.ok) {
          const resp = result.data;
          if (resp.replaced_count === 0) {
            // Stale match: refresh results so the row disappears and the user
            // can't click it again to loop the same error. The action banner
            // (matchNotFound) is the authoritative description of this click;
            // suppress any panel-local error the refresh may stamp (I1) so we
            // don't show two banners with competing wordings for one outcome.
            setActionError(STRINGS.findReplace.matchNotFound);
            await findReplace.search(slug);
            findReplace.clearError();
            return;
          }
          await finalizeReplaceSuccess({
            replacedCount: resp.replaced_count,
            reloadFailed: false,
          });
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
          await finalizeReplaceSuccess({
            replacedCount: result.data.replaced_count,
            reloadFailed: true,
          });
          return;
        }
        // stage === "mutate"
        const err = result.error;
        // 2xx BAD_JSON: same C1 branch as executeReplace. The server likely
        // committed the replace-one (and its auto-snapshot) but the response
        // body was unreadable. Lock the editor until refresh so auto-save
        // cannot overwrite a possibly-committed server-side change.
        if (
          err instanceof ApiRequestError &&
          err.code === "BAD_JSON" &&
          err.status >= 200 &&
          err.status < 300
        ) {
          // Replace-one is single-chapter — clear that chapter's cached draft
          // (C1). The mutate callback threw before returning a directive, so
          // the hook's clearAllCachedContent never ran.
          clearCachedContent(chapterId);
          await finalizeReplaceSuccess({
            replacedCount: null,
            reloadFailed: true,
            lockMessage: STRINGS.findReplace.replaceResponseUnreadable,
          });
          return;
        }
        // On any 404 (chapter soft-deleted OR project gone), refresh the
        // result set BEFORE showing the banner — otherwise the user clicks
        // the same row and loops the same error (I3). Previously gated on
        // SCOPE_NOT_FOUND only, which let bare NOT_FOUND 404s fall through
        // with stale rows still clickable. The search refetch clears its
        // result set on 400/404 (useFindReplaceState.ts:191), and the
        // clearError() call below suppresses the panel-local duplicate so
        // the action banner set by mapReplaceErrorToMessage is the single
        // source of truth for this click.
        if (err instanceof ApiRequestError && err.status === 404) {
          await findReplace.search(slug);
          findReplace.clearError();
        }
        const msg = mapReplaceErrorToMessage(err);
        if (msg) setActionError(msg);
      } finally {
        actionBusyRef.current = false;
      }
    },
    [
      project,
      slug,
      findReplace,
      finalizeReplaceSuccess,
      getActiveChapter,
      setActionError,
      mutation,
      isActionBusy,
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
      // I4: status PATCHes the same chapter row an in-flight replace may
      // be writing. Allowing it to slip past the busy guard races two
      // writes against the same row. Mirror handleCreateChapterGuarded.
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      setActionError(null);
      handleStatusChange(chapterId, status, setActionError);
    },
    [handleStatusChange, setActionError, isActionBusy],
  );

  const handleRenameChapterWithError = useCallback(
    (chapterId: string, title: string) => {
      // I4: same rationale as handleStatusChangeWithError — the PATCH
      // targets the chapter row an in-flight replace may be writing.
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      setActionError(null);
      handleRenameChapter(chapterId, title, setActionError);
    },
    [handleRenameChapter, setActionError, isActionBusy],
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
      if (editorLockedMessageRef.current !== null) {
        setActionInfo(STRINGS.editor.lockedRefusal);
        return;
      }
      handleReorderChapters(orderedIds);
    },
    [handleReorderChapters, isActionBusy],
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
      if (editorLockedMessageRef.current !== null) {
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
        safeSetEditable(editorRef, true);
        console.warn("switchToView: flushSave threw", err);
        setActionError(STRINGS.editor.viewSwitchSaveFailed);
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
      if (editorLockedMessageRef.current === null) {
        safeSetEditable(editorRef, true);
      }
      return true;
    },
    [setTrashOpen, setActionError, isActionBusy],
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
    // effect and clears editorLockedMessage — silently dismissing a
    // banner that was intentionally persistent. The title-edit hooks and
    // snapshot view already consult isEditorLocked; mirror that here.
    if (editorLockedMessageRef.current !== null) {
      setActionInfo(STRINGS.editor.lockedRefusal);
      return;
    }
    handleCreateChapter();
  }, [isActionBusy, handleCreateChapter]);

  const requestDeleteChapter = useCallback(
    (chapter: Chapter) => {
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
        return;
      }
      // I4 (review 2026-04-21): refuse while the lock banner is up.
      // handleDeleteChapter switches the active chapter on success, which
      // fires the [activeChapter?.id] useEffect and silently clears
      // editorLockedMessage. The banner that was telling the user "refresh
      // the page because your state is ambiguous" disappears, and the new
      // chapter's editor is enabled — whatever ambiguity triggered the
      // lock is now invisible. Same rationale as title-edit / snapshot view.
      if (editorLockedMessageRef.current !== null) {
        setActionInfo(STRINGS.editor.lockedRefusal);
        return;
      }
      setDeleteTarget(chapter);
    },
    [isActionBusy, setDeleteTarget],
  );

  const openTrashGuarded = useCallback(() => {
    if (isActionBusy()) {
      setActionInfo(STRINGS.editor.mutationBusy);
      return;
    }
    // I4: refuse while the lock banner is up. Trash view unmounts the
    // editor, implicitly clearing the editorLockedMessage reminder —
    // consistent with the other guarded entry points.
    if (editorLockedMessageRef.current !== null) {
      setActionInfo(STRINGS.editor.lockedRefusal);
      return;
    }
    openTrash();
  }, [isActionBusy, openTrash]);

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
        console.warn("handleSelectChapterWithFlush failed", err);
        setActionError(STRINGS.error.loadChapterFailed);
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
  }, [slug, setProject, setActionError, navigate, mutation, isActionBusy]);

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
    flushSave: () => {
      if (isActionBusy()) return;
      if (editorLockedMessageRef.current !== null) return;
      return editorRef.current?.flushSave();
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
            onAddChapter={handleCreateChapterGuarded}
            onDeleteChapter={requestDeleteChapter}
            onReorderChapters={handleReorderChaptersGuarded}
            onRenameChapter={handleRenameChapterWithError}
            onOpenTrash={openTrashGuarded}
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
                aria-label={STRINGS.a11y.dismissInfo}
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
                onClick={handleCreateChapterGuarded}
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
                  // C1: Disable Restore while the editor-lock banner is
                  // showing. The lock is raised on possibly_committed /
                  // unknown restore outcomes where the server almost
                  // certainly already committed — a second click would
                  // re-enter restoreSnapshot and issue a second server
                  // restore + second auto-snapshot. Keeping the banner
                  // visible (rather than exitSnapshotView()) preserves
                  // the "which snapshot was I looking at" context the
                  // user needs to decide whether to refresh.
                  canRestore={editorLockedMessage === null}
                  // S3: Same gate on Back-to-editing. Clicking Back while
                  // locked would drop the user into a locked editor showing
                  // pre-restore content while the banner says "editing
                  // would overwrite" — a confusing state with no clean
                  // recovery path that isn't "refresh." Keep the user in
                  // snapshot view until they refresh.
                  canBack={editorLockedMessage === null}
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
                      onSave={handleSaveLockGated}
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
              // S1: Refuse snapshot view while the editor-lock banner is up.
              // handleSaveLockGated makes flushSave return false whenever the
              // lock is active; without this early-return the panel would
              // stamp "save your unsaved changes" on top of a banner that
              // says "refresh the page" — contradictory guidance. Return a
              // discriminated reason so the panel suppresses its own error
              // copy (the lock banner is the message).
              if (editorLockedMessageRef.current !== null) {
                return { ok: false, reason: "locked" };
              }
              // Refuse snapshot view while a useEditorMutation.run() is
              // in-flight (I2): the hand-composed flushSave/cancelPendingSaves
              // below would abort the in-flight mutation's save controller
              // and the subsequent setEditable(true) error branch could
              // re-enable the editor mid-mutation. Surface the busy banner
              // and bail before touching the editor.
              if (isActionBusy()) {
                setActionInfo(STRINGS.editor.mutationBusy);
                return undefined;
              }
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
              //
              // setEditable is INSIDE the try block (I6): useEditorMutation
              // wraps this exact call in its own try/catch (S4) because
              // TipTap can throw synchronously during remount. Keeping it
              // outside let a sync throw reject the onView promise,
              // bypassing the {ok,reason} contract SnapshotPanel expects.
              try {
                // Route through safeSetEditable so a TipTap mid-remount
                // throw does not escape the try and reject the onView
                // promise with an untyped error — SnapshotPanel expects
                // the {ok,reason} | undefined contract. Using the helper
                // instead of an inline setEditable also routes logging
                // through the shared warn, matching the discipline the
                // other mutation entry points follow.
                safeSetEditable(editorRef, false);
                const flushed = (await editorRef.current?.flushSave()) ?? true;
                if (!flushed) {
                  // Re-enable so the user can retry — view was refused.
                  safeSetEditable(editorRef, true);
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
                  safeSetEditable(editorRef, true);
                }
                return result;
              } catch (err) {
                // Swallow the throw; the onView contract is
                // {ok,reason} | undefined, not an exception channel.
                // Restoring setEditable(true) keeps the editor usable
                // on a flushSave/viewSnapshot error (TipTap-remount
                // throws from setEditable are already absorbed by
                // safeSetEditable above).
                safeSetEditable(editorRef, true);
                console.warn("SnapshotPanel onView aborted:", err);
                return { ok: false, reason: "save_failed" };
              }
            }}
            onBeforeCreate={async () => {
              // S1: Refuse snapshot creation while the lock banner is up.
              // Without this, handleSaveLockGated forces flushSave to false
              // and the panel shows createFailed ("Save your unsaved changes
              // and try again") — contradicting the lock banner's "refresh
              // the page." Return a discriminated locked outcome so the panel
              // suppresses createError entirely.
              if (editorLockedMessageRef.current !== null) {
                return { ok: false, reason: "locked" };
              }
              // Same I2 guard as onView — refuse snapshot creation while
              // a mutation is in-flight rather than racing its save. I5
              // (review 2026-04-21): return a discriminated busy outcome
              // so the panel suppresses its own createError banner. The
              // mutationBusy info banner we set here is the sole user-
              // visible signal for this click — without the reason tag
              // the panel would stamp createError on top of it, producing
              // two contradictory messages.
              if (isActionBusy()) {
                setActionInfo(STRINGS.editor.mutationBusy);
                return { ok: false, reason: "busy" };
              }
              // I3: TipTap can throw synchronously during a remount window
              // (see editorSafeOps.ts); flushSave can also reject from an
              // onSave rejection. Without this try/catch the throw escapes
              // back through SnapshotPanel.handleCreate as an unhandled
              // rejection — no banner, no createError, nothing visible to
              // the user. Mirror onView's pattern and return a
              // flush_failed outcome so the panel surfaces its own
              // createFailed message.
              try {
                const flushed = (await editorRef.current?.flushSave()) ?? true;
                if (flushed) {
                  cancelPendingSaves();
                  // I3: cancelPendingSaves clears useProjectEditor-level
                  // retry/backoff state but does NOT touch the Editor
                  // component's internal debounceTimerRef. A keystroke that
                  // lands between flushSave resolving and the snapshot
                  // POST completing re-dirties the editor and schedules a
                  // new debounced PATCH that races the snapshot create.
                  // markClean clears the debounce timer and zeroes the
                  // dirty flag, closing that race window — the next
                  // keystroke re-arms it cleanly.
                  editorRef.current?.markClean();
                  return { ok: true };
                }
                return { ok: false, reason: "flush_failed" };
              } catch (err) {
                console.warn("SnapshotPanel onBeforeCreate aborted:", err);
                return { ok: false, reason: "flush_failed" };
              }
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
