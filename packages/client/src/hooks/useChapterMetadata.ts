import { useCallback, useEffect, useRef } from "react";
import { api } from "../api/client";
import { useAbortableSequence } from "./useAbortableSequence";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { STRINGS } from "../strings";
import { mapApiError, applyMappedError, devWarn, isApiError } from "../errors";
import type { ChapterMetadataDeps } from "./useProjectEditor.types";

// Chapter-metadata seam of useProjectEditor (F-2 decomposition, 2026-05-29):
// project-title editing, chapter status changes, and chapter rename. These
// handlers share project/chapter state and the confirmed-status cache with the
// rest of the editor but never touch the save pipeline, so they extract
// cleanly. The status/title/rename ops and the two hand-rolled recovery
// controllers are used only here, so they are allocated in this hook; the
// shared state setters and refs are threaded in via deps.
export function useChapterMetadata(deps: ChapterMetadataDeps) {
  const {
    setProject,
    setActiveChapter,
    setProjectTitleError,
    setError,
    activeChapterRef,
    projectRef,
    projectSlugRef,
    confirmedStatusRef,
    onRequestEditorLockRef,
  } = deps;

  const statusChangeSeq = useAbortableSequence();
  // I11: rapid status clicks (A→B→C) used to issue overlapping PATCHes
  // with no server-side ordering guarantee. statusChangeSeq only
  // discarded response *processing*; both requests still reached the
  // server and the persisted row could settle on A or B while the UI
  // shows C. Mirror saveAbortRef: abort any prior in-flight PATCH
  // before issuing a new one, and thread the signal into
  // api.chapters.update so the abort actually severs the request.
  const statusChangeOp = useAbortableAsyncOperation();
  // I1 (review 2026-04-24): rapid title edits used to fire overlapping
  // PATCHes. The S7 drift guard discarded the stale response but the
  // SECOND PATCH had already reached the server — SQLite's writer-lock
  // ordering determined which title won, not the client's last-typed
  // value. Mirror statusChangeAbortRef: abort any prior in-flight
  // rename before issuing a new one, and thread the signal into
  // api.projects.update so the network request is actually severed.
  const titleChangeOp = useAbortableAsyncOperation();
  // I7 (review 2026-04-24): rename and delete-chapter siblings went
  // without AbortControllers. Rapid renames raced at the server with
  // no ordering guard. Mirror title/status abort refs: the rename path
  // aborts on supersede.
  const renameChapterOp = useAbortableAsyncOperation();
  // I22 (review 2026-04-24): recovery GETs fired by BAD_JSON catches in
  // handleStatusChange / handleUpdateProjectTitle need an AbortController so
  // unmount drops the in-flight recovery.
  // C1 (review 2026-04-25): each handler owns its own ref so a supersede in
  // one handler can't abort another handler's in-flight recovery GET.
  //
  // Phase 4b.3b decision matrix row C-5: statusRecoveryAbortRef and
  // titleRecoveryAbortRef are kept hand-rolled. Each fires from the catch
  // branch of its respective primary mutation and runs a follow-up GET that
  // must complete even after the primary mutation's hook has auto-aborted
  // (e.g. on the next handleStatusChange after a failed one). Routing these
  // through the primary's hook would cause the next mutation to cancel the
  // previous mutation's recovery refresh — exactly the case where the
  // previous error's user-visible state most needs the refresh to land.
  const statusRecoveryAbortRef = useRef<AbortController | null>(null);
  const titleRecoveryAbortRef = useRef<AbortController | null>(null);

  // Unmount cleanup: abort the hand-rolled recovery controllers so a
  // late-resolving recovery GET can't fire setState on a torn-down hook.
  // (The op hooks above auto-abort their own controllers on unmount.)
  useEffect(() => {
    return () => {
      statusRecoveryAbortRef.current?.abort();
      titleRecoveryAbortRef.current?.abort();
    };
  }, []);

  const handleUpdateProjectTitle = useCallback(
    async (title: string): Promise<string | undefined> => {
      const slug = projectSlugRef.current;
      const projectId = projectRef.current?.id;
      if (!slug || !projectId) return undefined;
      // S6 (review 2026-04-21) + C1 (review 2026-04-24): drift guard —
      // see handleCreateChapter for full rationale.
      setProjectTitleError(null);
      // I1: abort any prior in-flight title PATCH before issuing a new
      // one so overlapping renames can't commit out of typing order.
      const { promise, signal } = titleChangeOp.run((s) => api.projects.update(slug, { title }, s));
      try {
        const updated = await promise;
        if (signal.aborted) return undefined;
        // C3 defense-in-depth: if the user navigated mid-PATCH, discard
        // the response. The primary C3 guard lives in useProjectTitleEditing
        // (refuses saveProjectTitle when project.slug !== slug), but this
        // extra check keeps handleUpdateProjectTitle independently safe for
        // any future direct caller.
        if (projectRef.current?.id !== projectId) return undefined;
        if (projectSlugRef.current !== slug && projectSlugRef.current !== projectRef.current?.slug)
          return undefined;
        projectSlugRef.current = updated.slug;
        setProject((prev) => (prev ? { ...prev, title: updated.title, slug: updated.slug } : prev));
        return updated.slug;
      } catch (err) {
        if (signal.aborted) return undefined; // superseded by a newer rename
        console.warn("Failed to update project title:", err);
        // Don't call setError — that triggers the full-page error overlay.
        // Returning undefined keeps the title edit mode open so the user can retry.
        const { message, possiblyCommitted } = mapApiError(err, "project.updateTitle");
        // I3: slug desync recovery. On 2xx BAD_JSON the server may have
        // committed the rename (new slug) but we can't read the new one
        // from the unreadable body. Subsequent save/create/reorder POSTs
        // against projectSlugRef.current would 404 against a dead slug —
        // cascading silent failures until the user refreshes. Attempt a
        // project refresh under the current (old) slug; if the slug did
        // not change (cosmetic rename, same-slug result) this recovers
        // in place. If the slug did change the GET 404s; the committed
        // copy alone tells the user to refresh the page.
        if (possiblyCommitted) {
          titleRecoveryAbortRef.current?.abort();
          const recoveryController = new AbortController();
          titleRecoveryAbortRef.current = recoveryController;
          try {
            const refreshed = await api.projects.get(slug, recoveryController.signal);
            if (recoveryController.signal.aborted) return undefined;
            // Merge only if still on the same project (id stable across
            // rename, changes on cross-project navigation).
            if (projectRef.current?.id === projectId) {
              setProject(refreshed);
              projectSlugRef.current = refreshed.slug;
            }
          } catch (recoveryErr) {
            // I4 (review 2026-04-24): a 404 here means the server moved
            // the project to a new slug but the unreadable body kept us
            // from learning it. projectSlugRef still points at the dead
            // slug; every subsequent save/create/reorder POSTs against
            // it and 404s in a cascade. Fire onRequestEditorLock so the
            // editor locks and auto-save short-circuits via
            // handleSaveLockGated — the banner instructs the user to
            // refresh. Network/other errors fall through to the generic
            // committed banner below (auto-save still works because the
            // slug didn't move; next attempt will succeed or surface its
            // own error).
            if (isApiError(recoveryErr) && recoveryErr.status === 404) {
              onRequestEditorLockRef.current?.(STRINGS.error.updateTitleProjectSlugLost);
            }
          }
        }
        if (message) setProjectTitleError(message);
        return undefined;
      }
    },
    [
      titleChangeOp,
      projectSlugRef,
      projectRef,
      setProjectTitleError,
      setProject,
      onRequestEditorLockRef,
    ],
  );

  const handleStatusChange = useCallback(
    async (chapterId: string, status: string, onError?: (message: string) => void) => {
      const token = statusChangeSeq.start();
      // I2 (review 2026-05-27 round 2, sweep): capture project id at
      // entry. The catch's applyMappedError tail falls back to setError
      // (full-page overlay) when onError is omitted — both surfaces are
      // wrong-project leaks on A→B nav mid-PATCH. The drift guard bails
      // before either fires.
      const startedForProjectId = projectRef.current?.id;
      const isStaleProject = () =>
        startedForProjectId !== undefined && projectRef.current?.id !== startedForProjectId;
      // I11: abort the prior in-flight PATCH before issuing a new one so
      // overlapping status clicks cannot land out-of-order at the server.
      const { promise: statusPromise, signal: statusSignal } = statusChangeOp.run((s) =>
        api.chapters.update(chapterId, { status }, s),
      );
      // I21 (review 2026-04-24): read previousStatus from the confirmed
      // cache, not projectRef. A rapid X→A→B click sequence would
      // otherwise capture `previousStatus = A` for B (A's optimistic
      // setProject has landed but A's PATCH has not confirmed) — a
      // later B-failure revert would restore A, a status the server
      // never saw. The confirmed ref only advances after a successful
      // PATCH, so it holds the authoritative value.
      const previousStatus = confirmedStatusRef.current[chapterId];

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
        await statusPromise;
        // I21: advance the confirmed cache only on server-confirmed
        // success so the next call's previousStatus reads the right
        // value.
        confirmedStatusRef.current[chapterId] = status;
      } catch (err) {
        if (statusSignal.aborted) return;
        if (token.isStale()) return; // newer call owns state
        const mapped = mapApiError(err, "chapter.updateStatus");
        // I11 (follow-on from the new AbortController): an ABORTED
        // error means a later click cancelled this PATCH mid-flight —
        // the newer click already owns the optimistic state and is
        // driving its own PATCH. Reverting here would stomp the live
        // call. Mirror saveAbortRef's ABORTED short-circuit.
        if (mapped.message === null) return;
        // I2 (review 2026-05-27 round 3): hoist the drift guard above
        // the possiblyCommitted branch. The round-2 sweep added the
        // late guard at the catch tail (still present below as
        // defense-in-depth covering the recovery-GET await window),
        // but the possiblyCommitted branch returns BEFORE reaching it.
        // Without this hoist, an A→B nav mid-PATCH followed by a 200
        // BAD_JSON would (a) write A's chapter id into B's
        // confirmed-status cache and (b) surface A's "couldn't be read
        // back" banner on B via onError or, when no onError is wired,
        // setError (full-page overlay).
        if (isStaleProject()) return;
        // I6 (2026-04-23): 2xx BAD_JSON means the server committed the
        // new status but the response body was unreadable. A revert
        // here either silently no-ops (the reload GET returns the new
        // status the user just set) or fights the committed server
        // state (local revert). Keep the optimistic update — the
        // committed copy below tells the user the response was
        // ambiguous, and the next chapter load will reconcile state.
        if (mapped.possiblyCommitted) {
          // I21: the server likely committed the new status despite
          // the unreadable body. Advance the confirmed cache so a
          // later status change captures this value, not the previous
          // one, as the baseline.
          confirmedStatusRef.current[chapterId] = status;
          if (mapped.message) onError?.(mapped.message);
          return;
        }
        // Revert by reloading from server, falling back to local revert
        let reverted = false;
        const slug = projectSlugRef.current;
        if (slug) {
          statusRecoveryAbortRef.current?.abort();
          const recoveryController = new AbortController();
          statusRecoveryAbortRef.current = recoveryController;
          try {
            const data = await api.projects.get(slug, recoveryController.signal);
            if (recoveryController.signal.aborted) return;
            // Re-check the token after the second await (I2). The
            // earlier guard covers only the api.chapters.update await; a
            // rapid A→B (fails) then B→C click where the failure lands
            // mid-api.projects.get would otherwise stomp C's optimistic
            // update back to A's server-side status, losing the user's
            // intent silently. Recovery would require another click.
            if (token.isStale()) return;
            const revertedChapter = data.chapters.find((c) => c.id === chapterId);
            if (revertedChapter) {
              // I21: advance confirmed cache to the server's truth so
              // subsequent calls don't capture a stale baseline.
              confirmedStatusRef.current[chapterId] = revertedChapter.status;
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
          } catch (err) {
            // S10 (4b.3c.2): surface the recovery failure in dev. The
            // per-call recoveryController.signal gates the warn — if a
            // newer status PATCH or unmount cancelled this GET, stay
            // silent so test output isn't polluted by supersede races.
            devWarn("handleStatusChange recovery GET failed", recoveryController.signal, err);
            // Fall through to local revert.
          }
        }
        // Guard the local-revert fallback too: the catch above could be
        // reached with the token already stale, in which case restoring
        // previousStatus would clobber the newer call's optimistic update.
        if (token.isStale()) return;
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
        // S4 (4b.3c.2): when no onError is wired (keyboard-shortcut path),
        // fall back to setError so the failure surfaces via the full-page
        // overlay rather than vanishing — mirrors handleReorderChapters.
        // I2 (review 2026-05-27 round 2, sweep): bail before either
        // surface fires if the user navigated to a different project
        // mid-PATCH. The optimistic-update / revert state writes above
        // already no-op on B (chapterId belongs to A, not in B's
        // chapter list) — only the user-visible error leak matters.
        if (isStaleProject()) return;
        applyMappedError(mapped, {
          onMessage: (message) => {
            if (onError) onError(message);
            else setError(message);
          },
        });
      }
    },
    [
      statusChangeSeq,
      statusChangeOp,
      projectRef,
      projectSlugRef,
      confirmedStatusRef,
      setProject,
      setActiveChapter,
      setError,
    ],
  );

  const handleRenameChapter = useCallback(
    async (chapterId: string, title: string, onError?: (message: string) => void) => {
      // I2 (review 2026-05-27 round 2, sweep): capture project id at
      // entry so the catch's onError bails when the user has navigated
      // A → B mid-rename.
      const startedForProjectId = projectRef.current?.id;
      const isStaleProject = () =>
        startedForProjectId !== undefined && projectRef.current?.id !== startedForProjectId;
      // I7: abort any prior in-flight rename before issuing a new one
      // so overlapping renames cannot commit out of typing order at the
      // server (same rationale as title/status abort refs).
      const { promise, signal } = renameChapterOp.run((s) =>
        api.chapters.update(chapterId, { title }, s),
      );
      try {
        await promise;
        if (signal.aborted) return;
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
        // I7: ABORTED means a newer rename superseded this one; stay
        // silent so the newer call's state update is not contradicted
        // by a stale error banner.
        if (signal.aborted) return;
        console.warn("Failed to rename chapter:", err);
        // Don't call setError — that triggers the full-page error overlay.
        // Rename failures are non-fatal; surface via the optional callback
        // so callers can display inline (same pattern as handleStatusChange).
        // I2 (review 2026-05-27 round 2, sweep): drift guard before
        // onError — useTrashManager-style wrong-project leak.
        if (isStaleProject()) return;
        applyMappedError(mapApiError(err, "chapter.rename"), {
          onMessage: (message) => onError?.(message),
        });
      }
    },
    [renameChapterOp, projectRef, activeChapterRef, setActiveChapter, setProject],
  );

  return {
    handleUpdateProjectTitle,
    handleStatusChange,
    handleRenameChapter,
  };
}
