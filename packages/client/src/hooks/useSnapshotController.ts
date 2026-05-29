import { useCallback, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Chapter } from "@smudge/shared";
import { SNAPSHOT_ERROR_CODES } from "@smudge/shared";
import { generateHTML } from "@tiptap/html";
import { mapApiError, clientWarn } from "../errors";
import { ApiRequestError } from "../errors";
import { clearCachedContent } from "./useContentCache";
import { safeSetEditable, quiesceEditorForServerOp } from "../utils/editorSafeOps";
import { sanitizeEditorHtml } from "../sanitizer";
import { editorExtensions } from "../editorExtensions";
import { STRINGS } from "../strings";
import type { EditorHandle } from "../components/Editor";
import type { useEditorMutation } from "./useEditorMutation";
import type { useFindReplaceState } from "./useFindReplaceState";
import type { useSnapshotState } from "./useSnapshotState";

// Snapshot orchestration seam of EditorPage (F-1 decomposition,
// 2026-05-29): restore (SnapshotBanner.onRestore) plus the
// SnapshotPanel onView / onBeforeCreate handlers, extracted verbatim from
// EditorPage so the documented save-pipeline invariants — and the 16
// rounds of review on the snapshots/find-and-replace branch — are
// preserved exactly. The snapshot-view latest-ref is used only by the
// restore handler, so it is allocated here (cohesion). The genuinely
// shared primitives — the single useEditorMutation instance, the
// cross-caller actionBusyRef, the editor handle/lock refs, and the action
// banners — are owned by EditorPage and threaded in via deps so the
// "single mutation instance shared by every caller" invariant holds.

// Sentinel errors used by the handleRestoreSnapshot mutate callback so the
// useEditorMutation hook surfaces a `stage: "mutate"` result that the caller
// can route to scope-specific copy. `RestoreAbortedError` signals the user
// clicked "Back to editing" during the flush — treat as a silent no-op.
// `RestoreFailedError` carries the ApiRequestError that
// useSnapshotState.restoreSnapshot returned on its `ok: false` arm so the
// outer handler can route it through mapApiError("snapshot.restore"). Using
// an ApiRequestError directly would re-enter apiFetch's own throw paths
// semantically; wrapping keeps the "this is a hook-surfaced restore
// failure" semantic distinct from an in-flight fetch error.
class RestoreAbortedError extends Error {}
class RestoreFailedError extends Error {
  constructor(public readonly apiError: ApiRequestError) {
    super(`restore failed: ${apiError.code ?? apiError.status}`);
  }
}

export function renderSnapshotContent(content: Record<string, unknown>): string {
  try {
    const html = generateHTML(content as Parameters<typeof generateHTML>[0], editorExtensions);
    return sanitizeEditorHtml(html);
  } catch {
    return `<p>${STRINGS.snapshots.renderError}</p>`;
  }
}

type SnapshotStateReturn = ReturnType<typeof useSnapshotState>;

export interface SnapshotControllerDeps {
  activeChapter: Chapter | null;
  viewingSnapshot: SnapshotStateReturn["viewingSnapshot"];
  restoreSnapshot: SnapshotStateReturn["restoreSnapshot"];
  viewSnapshot: SnapshotStateReturn["viewSnapshot"];
  exitSnapshotView: SnapshotStateReturn["exitSnapshotView"];
  snapshotPanelRef: SnapshotStateReturn["snapshotPanelRef"];
  refreshSnapshotCount: SnapshotStateReturn["refreshCount"];
  cancelPendingSaves: () => void;
  mutation: ReturnType<typeof useEditorMutation>;
  findReplace: ReturnType<typeof useFindReplaceState>;
  getActiveChapter: () => Chapter | null;
  editorRef: MutableRefObject<EditorHandle | null>;
  editorLockedMessageRef: MutableRefObject<string | null>;
  isActionBusy: () => boolean;
  actionBusyRef: MutableRefObject<boolean>;
  applyReloadFailedLock: (bannerMessage: string) => void;
  setActionError: Dispatch<SetStateAction<string | null>>;
  setActionInfo: Dispatch<SetStateAction<string | null>>;
}

export function useSnapshotController(deps: SnapshotControllerDeps) {
  const {
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
    editorLockedMessageRef,
    isActionBusy,
    actionBusyRef,
    applyReloadFailedLock,
    setActionError,
    setActionInfo,
  } = deps;

  // Snapshot-view ref used by handleRestoreSnapshot to re-check intent after
  // awaiting flushSave — the user may have clicked "Back to editing" during
  // the flush, in which case the restore should not proceed.
  const viewingSnapshotRef = useRef(viewingSnapshot);
  viewingSnapshotRef.current = viewingSnapshot;

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
          throw new RestoreFailedError(restore.error);
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
        // applyReloadFailedLock (I6) sets the banner AND safeSetEditable
        // in one call so the two can't drift apart in a future refactor.
        applyReloadFailedLock(STRINGS.snapshots.restoreSucceededReloadFailed);
        // Defense-in-depth cache-clear mirroring the possibly_committed
        // branch below. The hook's stage:"reload" path normally handles
        // cache-clear (including the C1 fix for the mid-remount re-lock
        // bail), but without a redundant clear here the restore branch
        // has no backstop if a future hook refactor introduces a gap
        // between "server commit" and "cache wipe". The replace flow
        // converges through finalizeReplaceSuccess which has its own
        // convergence logic; restore has no equivalent, so mirror the
        // possibly_committed branch's defense-in-depth.
        clearCachedContent(activeChapter.id);
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
        const { message, possiblyCommitted, transient } = mapApiError(
          result.error.apiError,
          "snapshot.restore",
        );
        // I7 + I3 (review 2026-04-24): ABORTED and silent no-ops surface
        // as message:null. Mirrors RestoreAbortedError's silent return.
        // restoreSnapshot now wires a restoreAbortRef, so an unmount or
        // newer restore mid-flight DOES trigger ABORTED — this branch is
        // the live guard, not a future-proofing placeholder.
        if (message === null) return;
        if (possiblyCommitted) {
          // 2xx BAD_JSON on restore: server likely committed the restore
          // (and its auto-snapshot) but the response body was unreadable.
          // Treat the same as stage:"reload" — persistent lock banner, no
          // retry prompt, since retrying could double-restore (C2). This
          // branch also absorbs the former "unknown" case: the hook now
          // synthesizes a 200 BAD_JSON ApiRequestError for non-
          // ApiRequestError post-success throws, so they land here and
          // get the same pessimistic lock treatment.
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
            // I6 (review 2026-04-25): the user is no longer on the
            // chapter the restore targeted. The mapped message is
            // chapter-agnostic ("the restore was committed; refresh"),
            // which the user can mistakenly attribute to the chapter
            // they're now looking at and refresh against the wrong
            // context. Override with a chapter-attributed string so
            // the banner identifies which chapter's state is unverified.
            setActionError(
              STRINGS.snapshots.restoreResponseUnreadableOnOtherChapter(activeChapter.title),
            );
            // I4 (review 2026-04-21): leave snapshot view — the banner
            // that prompted this restore is still pointing at a chapter
            // the user has navigated away from. Without this, Restore
            // and "Back to editing" remain live on a banner that refers
            // to a chapter the user is no longer looking at, inviting
            // repeat restores against the wrong chapter. Mirrors the
            // permanent-error branches (corrupt_snapshot, not_found,
            // cross_project_image).
            exitSnapshotView();
            snapshotPanelRef.current?.refreshSnapshots();
            refreshSnapshotCount();
            return;
          }
          // Lock-banner state doesn't enforce read-only by itself; the
          // hook's finally already re-enabled the editor after the
          // mutate-stage throw. applyReloadFailedLock (I6) sets the
          // banner + safeSetEditable as an invariant pair so auto-save
          // cannot overwrite a possibly-committed restore. Wrapped via
          // safeSetEditable (I2): TipTap can throw synchronously during
          // the mid-remount window, and an unwrapped throw here would
          // skip the snapshot panel refresh and leave the lock banner
          // without its companion editor-state change.
          applyReloadFailedLock(message);
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
        if (transient) {
          // NETWORK branch: offline/DNS/CSP failure (or a pre-send client
          // throw the hook normalized into a NETWORK ApiRequestError). The
          // SnapshotBanner stays on screen so the user can retry once the
          // connection recovers — mirrors the sibling mutation (replace)
          // which also surfaces connection-specific guidance instead of
          // the generic "try again" bucket (I1).
          setActionError(message);
        } else {
          // Permanent non-committed failures: corrupt_snapshot,
          // cross_project_image, 404, and any fallback-class
          // ApiRequestError. The snapshot cannot recover from the same
          // state, so dismiss the SnapshotBanner — otherwise the user
          // loops clicking Restore on a permanently-broken row (I2, I6).
          setActionError(message);
          exitSnapshotView();
        }
        // I6: Refresh the snapshot list on every error branch. The
        // 404/not-found branch is the sharpest case — without a refresh,
        // the stale snapshot row remains clickable and the user loops
        // through the same 404. Mirrors the sibling handleReplaceOne 404
        // path which refreshes its result set for the same reason. The
        // possiblyCommitted branch above returns before reaching this
        // line and runs its own refresh.
        snapshotPanelRef.current?.refreshSnapshots();
        // Drive the toolbar snapshot count the same way finalizeReplaceSuccess
        // does (I1). For branches where the server clearly did NOT commit
        // (corrupt, cross_project_image, 404, network), this is at most a
        // redundant fetch — no new snapshot exists, so the count is
        // unchanged. Cheaper than branching for the narrow
        // "know-nothing-happened" cases.
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
    setActionInfo,
    mutation,
    findReplace,
    isActionBusy,
    exitSnapshotView,
    refreshSnapshotCount,
    getActiveChapter,
    applyReloadFailedLock,
    actionBusyRef,
    editorLockedMessageRef,
  ]);

  const onSnapshotView = useCallback(
    async (snap: {
      id: string;
      label: string | null;
      created_at: string;
    }): Promise<
      | { ok: true; superseded?: "chapter" | "sameChapterNewer" }
      | { ok: false; reason?: string }
      | undefined
    > => {
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
        // F-7: the load-bearing disable -> flush -> (fail: re-enable, bail)
        // -> cancel ordering is encoded once in quiesceEditorForServerOp.
        // disableEditor:true keeps the editor read-only across the round trip
        // (invariant #2) and re-enables it only if the flush fails so the user
        // can retry. The helper routes setEditable through safeSetEditable, so
        // a TipTap mid-remount throw is absorbed rather than rejecting the
        // onView promise (SnapshotPanel expects {ok,reason} | undefined).
        const flushed = await quiesceEditorForServerOp(editorRef, cancelPendingSaves, {
          disableEditor: true,
        });
        if (!flushed) {
          return { ok: false, reason: "save_failed" };
        }
        const result = await viewSnapshot(snap);
        // Re-enable on actual failure (user must be able to
        // retry) and on "chapter" supersession (the Editor is
        // unmounting/remounting into chapter B, so this is a
        // no-op but keeps the happy path symmetric). Do NOT
        // re-enable on "sameChapterNewer": a newer View click
        // on the same chapter is still in flight and is about
        // to either mount snapshot view (unmounting the Editor)
        // or re-enable on its own failure. Re-enabling here
        // opens a typing window between this (older) response
        // and the newer one — any keystrokes would ride the
        // Editor's unmount-cleanup PATCH (Editor.tsx:182-191)
        // into the server as the snapshot view mounts, against
        // invariant #2.
        if (!result.ok || result.superseded === "chapter") {
          safeSetEditable(editorRef, true);
        }
        // Translate the hook's failure arm (which now carries an
        // ApiRequestError) into the reason-string shape SnapshotPanel
        // expects. The panel renders copy via its own strings
        // lookup keyed on reason; we route through mapApiError to
        // keep the scope-registry as the single source of truth
        // for message selection, and then set an approximate reason
        // tag so the panel's existing branch logic keeps working.
        // The `save_failed`/`locked`/`busy` reasons are produced
        // elsewhere in this handler and don't need translation.
        if (result.ok) return result;
        const { message, transient } = mapApiError(result.error, "snapshot.view");
        if (message === null) {
          // ABORTED — SnapshotPanel has no silent-bail arm; the
          // hook already remaps its own ABORTs to supersession,
          // so this path is reachable only from a future wiring
          // that lets ABORTED escape. Fall through to generic
          // so the panel renders viewFailed rather than a dead
          // button.
          return { ok: false, reason: "unknown" };
        }
        // S1 (2026-04-23 review): the prior TODO tagged "commit-4"
        // has long since merged; the three-hop translation
        // (scopes → this translator → SnapshotPanel case ladder)
        // is a drift risk. Collapsing it requires changing
        // SnapshotPanel's props and its tests — explicitly out
        // of scope for Phase 4b.3. Dropping this translator belongs
        // with Phase 4b.4 (ESLint enforcement of the mapper
        // contract) since that phase touches every call site
        // anyway. Keeping the branches here until then.
        // I4 (review 2026-04-24): check `code` before `status`
        // to match the mapper's S8 byCode-beats-byStatus
        // precedence. A hypothetical `{status:404,
        // code:CORRUPT_SNAPSHOT}` response would otherwise
        // show "not found" in the panel though the mapper
        // picked "corrupt" — a drift between this translator
        // and the scope registry. The translator itself will
        // be removed in Phase 4b.4 (see S1 above); until then
        // keep it consistent with the mapper.
        const code = result.error.code;
        if (code === SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT) {
          return { ok: false, reason: "corrupt_snapshot" };
        }
        if (result.error.status === 404) return { ok: false, reason: "not_found" };
        if (transient) return { ok: false, reason: "network" };
        return { ok: false, reason: "unknown" };
      } catch (err) {
        // Swallow the throw; the onView contract is
        // {ok,reason} | undefined, not an exception channel.
        // Restoring setEditable(true) keeps the editor usable
        // on a flushSave/viewSnapshot error (TipTap-remount
        // throws from setEditable are already absorbed by
        // safeSetEditable above).
        safeSetEditable(editorRef, true);
        clientWarn("SnapshotPanel onView aborted:", err);
        return { ok: false, reason: "save_failed" };
      }
    },
    [
      editorLockedMessageRef,
      isActionBusy,
      setActionInfo,
      editorRef,
      cancelPendingSaves,
      viewSnapshot,
    ],
  );

  const onSnapshotBeforeCreate = useCallback(async () => {
    // S1: Refuse snapshot creation while the lock banner is up.
    // Without this, handleSaveLockGated forces flushSave to false
    // and the panel shows createFailed ("Save your unsaved changes
    // and try again") — contradicting the lock banner's "refresh
    // the page." Return a discriminated locked outcome so the panel
    // suppresses createError entirely.
    if (editorLockedMessageRef.current !== null) {
      return { ok: false, reason: "locked" } as const;
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
      return { ok: false, reason: "busy" } as const;
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
      // F-7: same quiesce ordering as onView, encoded once. markCleanAfter:true
      // runs editorRef.markClean() after the flush + cancel — cancelPendingSaves
      // clears useProjectEditor-level retry/backoff state but NOT the Editor's
      // internal debounceTimerRef, so a keystroke landing between flush and the
      // snapshot POST would otherwise re-dirty the editor and schedule a racing
      // PATCH; markClean zeroes the dirty flag + debounce timer, closing that
      // window. disableEditor is omitted: snapshot create captures the live
      // content and does not overwrite the editor, so it stays editable.
      const flushed = await quiesceEditorForServerOp(editorRef, cancelPendingSaves, {
        markCleanAfter: true,
      });
      if (flushed) {
        return { ok: true } as const;
      }
      return { ok: false, reason: "flush_failed" } as const;
    } catch (err) {
      clientWarn("SnapshotPanel onBeforeCreate aborted:", err);
      return { ok: false, reason: "flush_failed" } as const;
    }
  }, [editorLockedMessageRef, isActionBusy, setActionInfo, editorRef, cancelPendingSaves]);

  return {
    handleRestoreSnapshot,
    onSnapshotView,
    onSnapshotBeforeCreate,
  };
}
