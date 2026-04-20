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

  // Single useEditorMutation instance shared by handleRestoreSnapshot,
  // executeReplace, and handleReplaceOne. The cross-caller busy-guard
  // depends on a single invocation — do NOT add a second call.
  const mutation = useEditorMutation({
    editorRef,
    projectEditor: {
      cancelPendingSaves,
      reloadActiveChapter,
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
  const isActionBusy = useCallback(
    () => mutation.isBusy() || actionBusyRef.current,
    [mutation],
  );

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
      if (result.error.reason === "possibly_committed") {
        // 2xx BAD_JSON on restore: server likely committed the restore
        // (and its auto-snapshot) but the response body was unreadable.
        // Treat the same as stage:"reload" — persistent lock banner, no
        // retry prompt, since retrying could double-restore (C2).
        setEditorLockedMessage(STRINGS.snapshots.restoreResponseUnreadable);
        // Clear the restored chapter's cached draft (C1). The mutate
        // callback threw before returning a directive, so the hook's
        // clearAllCachedContent never ran — without this, a refresh would
        // re-hydrate the pre-restore draft from localStorage and the next
        // auto-save would PATCH it back over the server-committed restore.
        clearCachedContent(activeChapter.id);
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
        return;
      }
      if (result.error.reason === "corrupt_snapshot") {
        setActionError(STRINGS.snapshots.restoreFailedCorrupt);
      } else if (result.error.reason === "cross_project_image") {
        setActionError(STRINGS.snapshots.restoreFailedCrossProjectImage);
      } else if (result.error.reason === "not_found") {
        setActionError(STRINGS.snapshots.restoreFailedNotFound);
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
        setEditorLockedMessage(STRINGS.snapshots.restoreResponseUnreadable);
        // Same C1 leak as the possibly_committed branch — the mutate
        // throw bypasses the hook's cache-clear, so the pre-restore draft
        // would re-hydrate on refresh and overwrite the server commit.
        clearCachedContent(activeChapter.id);
        safeSetEditable(editorRef, false);
      }
      // I6: Refresh the snapshot list on every error branch. The
      // not_found branch is the sharpest case — without a refresh, the
      // stale snapshot row remains clickable and the user loops through
      // the same 404. Mirrors the sibling handleReplaceOne 404 path
      // which refreshes its result set for the same reason. The
      // possibly_committed branch above returns before reaching this
      // line and runs its own refresh.
      snapshotPanelRef.current?.refreshSnapshots();
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
      if (!slug) return;
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
      await findReplace.search(slug);
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
    [slug, findReplace, snapshotPanelRef, refreshSnapshotCount],
  );

  const executeReplace = useCallback(
    async (frozen: {
      scope: { type: "project" } | { type: "chapter"; chapter_id: string };
      query: string;
      replacement: string;
      options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
    }) => {
      if (!project || !slug) return;

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
        return {
          clearCacheFor: resp.affected_chapter_ids,
          reloadActiveChapter: reload,
          reloadChapterId: reload && current ? current.id : undefined,
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
        // never ran. The response body was unreadable, so affected_chapter_ids
        // is unavailable — fall back to the requested scope: the targeted
        // chapter for chapter-scope, or every project chapter for
        // project-scope. Without this, refresh re-hydrates the pre-replace
        // draft from localStorage and the next auto-save reverts the
        // server-committed replace.
        if (frozen.scope.type === "chapter") {
          clearCachedContent(frozen.scope.chapter_id);
        } else {
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
    handleCreateChapter();
  }, [isActionBusy, handleCreateChapter]);

  const requestDeleteChapter = useCallback(
    (chapter: Chapter) => {
      if (isActionBusy()) {
        setActionInfo(STRINGS.editor.mutationBusy);
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
            onReorderChapters={handleReorderChapters}
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
                editorRef.current?.setEditable(false);
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
                // Swallow the throw; the onView contract is
                // {ok,reason} | undefined, not an exception channel.
                // Restoring setEditable(true) keeps the editor usable
                // on a TipTap-remount sync throw.
                try {
                  editorRef.current?.setEditable(true);
                } catch {
                  // setEditable on a destroyed editor can throw again;
                  // ignore — the editor's next remount resets editable.
                }
                console.warn("SnapshotPanel onView aborted:", err);
                return { ok: false, reason: "save_failed" };
              }
            }}
            onBeforeCreate={async () => {
              // Same I2 guard as onView — refuse snapshot creation while
              // a mutation is in-flight rather than racing its save.
              if (isActionBusy()) {
                setActionInfo(STRINGS.editor.mutationBusy);
                return false;
              }
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
