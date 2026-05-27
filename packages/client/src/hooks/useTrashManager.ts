import { useState, useCallback, useEffect, useRef } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError, applyMappedError, devWarn } from "../errors";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { useAbortableSequence } from "./useAbortableSequence";

export interface UseTrashManagerOptions {
  // C2 (review 2026-04-25): wire through to useProjectEditor's
  // seedConfirmedStatus so a chapter restored via this hook seeds the
  // cache that handleStatusChange's local-revert fallback reads. Without
  // it, a later status PATCH on the restored row double-failing would
  // skip the local revert and leave the optimistic status on screen.
  seedConfirmedStatus?: (id: string, status: string) => void;
  // I4 (4b.3c.3): bulk reseed of the confirmed-status cache from a fresh
  // ProjectWithChapters snapshot. Used by handleRestore's committed-
  // recovery branch after a 200 BAD_JSON / RESTORE_READ_FAILURE, where
  // the recovery GET returns the post-restore project state.
  replaceConfirmedStatusesFromProject?: (refreshed: ProjectWithChapters) => void;
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
  const replaceConfirmedStatusesRef = useRef(options?.replaceConfirmedStatusesFromProject);
  useEffect(() => {
    replaceConfirmedStatusesRef.current = options?.replaceConfirmedStatusesFromProject;
  }, [options?.replaceConfirmedStatusesFromProject]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedChapters, setTrashedChapters] = useState<Chapter[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // I5 (review 2026-04-24): api.projects.trash accepts a signal. The
  // trashOp instance aborts any prior in-flight trash fetch before
  // issuing a new one (rapid openTrash clicks; or the refresh in
  // confirmDeleteChapter that shares this instance) and auto-aborts
  // on unmount so the browser drops the request rather than
  // setState-ing into a torn-down hook. The downstream
  // `if (signal.aborted) return` gates uphold the zero-warnings
  // invariant by skipping console.error on a superseded/unmount abort.
  const trashOp = useAbortableAsyncOperation();
  // User callout (2026-04-25 review): handleRestore had no
  // cancellation/unmount guard (unlike openTrash) before this hook
  // was extracted. If the owner unmounts (navigation / chapter
  // switch) while api.chapters.restore() is in flight, the catch
  // path could log and setState on a torn-down hook. The restoreOp
  // instance mirrors trashOp's pattern: one controller per restore
  // call, threaded into api.chapters.restore, aborted on the next
  // call AND on unmount via the hook's auto-abort.
  const restoreOp = useAbortableAsyncOperation();
  // I4 (4b.3c.3, 2026-05-26 pushback Issue 1 option A):
  // restoreRecoveryAbortRef is kept hand-rolled. It fires from the
  // catch branch of handleRestore's possiblyCommitted arm and runs a
  // follow-up GET that must complete even after the primary restoreOp
  // has auto-aborted (e.g. on the next handleRestore after a failed
  // one). Routing this through restoreOp would cause the next restore
  // to cancel the previous restore's recovery refresh — exactly the
  // case where the previous error's user-visible state most needs the
  // refresh to land. Phase 4b.4 replaces this file-level allowlist
  // entry with inline `// eslint-disable-next-line` on the line below.
  const restoreRecoveryAbortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    return () => {
      restoreRecoveryAbortRef.current?.abort();
    };
  }, []);
  // I1 + S2 (review 2026-05-27): sync-on-render refs for the current
  // project id and slug. The recovery .then callback closes over the
  // captured-at-catch project prop, which goes stale once the user
  // navigates A → B mid-GET. Pre-fix, setProject's identity-guard
  // updater bailed for A's refreshed data on B's state, but the
  // unconditional `replaceConfirmedStatusesRef.current?.(refreshed)`
  // call wiped B's confirmed-status cache with A's chapter→status
  // mapping (the C2 cache-corruption hazard). Post-fix, projectRef
  // reflects the latest project on every render — the .then bails if
  // it no longer matches refreshed.id, gating BOTH setProject and the
  // reseed. slugRef mirrors useProjectEditor's projectSlugRef pattern
  // (S2 closure-staleness for the GET URL when a parent-project
  // restore changes the slug between user clicks).
  const projectRef = useRef(project);
  // eslint-disable-next-line react-hooks/refs
  projectRef.current = project;
  const slugRef = useRef(slug);
  // eslint-disable-next-line react-hooks/refs
  slugRef.current = slug;
  // I2 (review 2026-05-27): per-restore epoch token. Each handleRestore
  // call bumps the sequence; the committed-recovery GET's .then checks
  // the token before touching state, so a recovery GET from Restore-A
  // is silently discarded once Restore-B has started (whether B
  // succeeded or also entered its own recovery branch). This closes
  // the cross-restore race where A's stale recovery snapshot would
  // overwrite B's successful chapter merge, silently dropping B's
  // restored row from the sidebar.
  const restoreSeq = useAbortableSequence();

  const openTrash = useCallback(async () => {
    if (!project) return;
    // I2 (review 2026-05-27 round 2, sibling of handleRestore): capture
    // project id at entry so we can bail any state writes after the
    // user has navigated A → B mid-fetch. Pre-fix, both the success
    // path (setTrashedChapters / setTrashOpen) and the catch
    // (applyMappedError) ran unconditionally — B saw A's trash list
    // pinned, or A's failure banner attributed to B. EditorPage stays
    // mounted across project navigation so this is a routine race.
    const startedForProjectId = project.id;
    const isStaleProject = () =>
      startedForProjectId !== undefined && projectRef.current?.id !== startedForProjectId;
    const { promise, signal } = trashOp.run((s) => api.projects.trash(project.slug, s));
    try {
      const trashed = await promise;
      if (signal.aborted) return;
      if (isStaleProject()) return;
      setTrashedChapters(trashed);
      setTrashOpen(true);
    } catch (err) {
      if (signal.aborted) return;
      if (isStaleProject()) return;
      const mapped = mapApiError(err, "trash.load");
      // message:null for ABORTED — skip both the log and the banner.
      if (mapped.message !== null) console.error("Failed to load trash:", err);
      applyMappedError(mapped, { onMessage: setActionError });
    }
  }, [project, trashOp]);

  const handleRestore = useCallback(
    async (chapterId: string) => {
      // I2 (review 2026-05-27): bump the per-restore epoch BEFORE the
      // POST starts so any older restore's still-pending recovery GET
      // is invalidated. The token is checked inside that GET's .then
      // (below) so a stale recovery response from Restore-A is
      // silently discarded once Restore-B has started — closing the
      // cross-restore race where A's snapshot would overwrite B's
      // successful chapter merge.
      const restoreToken = restoreSeq.start();
      // I2 (review 2026-05-27 round 2): capture the project id at
      // handleRestore entry so the catch can identity-guard
      // setActionError before flashing a wrong-project banner. EditorPage
      // stays mounted across project navigation (one Route for both
      // slugs), so a restore POST that resolves after the user has
      // navigated A → B would otherwise land setActionError on B for an
      // event that happened on A. Pre-fix only the committed sub-branch's
      // setProject was identity-gated; the unconditional applyMappedError
      // at the catch tail surfaced the failure banner on whichever
      // project the user was looking at when the response landed.
      const restoreStartedForProjectId = projectRef.current?.id;
      // User callout (2026-04-25): abort any prior in-flight restore
      // before issuing the new one. The restoreOp instance threads the
      // signal into api.chapters.restore so the abort propagates to the
      // network layer, not just gates the client-side response handler.
      // Auto-abort on unmount is provided by the hook itself.
      const { promise, signal } = restoreOp.run((s) => api.chapters.restore(chapterId, s));
      try {
        const restored = await promise;
        if (signal.aborted) return;
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
        // User callout (2026-04-25): unmount/supersession abort stays
        // silent. Without this guard the catch would log and setState
        // on a torn-down hook, polluting test output (CLAUDE.md zero-
        // warnings invariant) and risking React's setState-on-unmount
        // warning.
        if (signal.aborted) return;
        // I2 (review 2026-05-27 round 2): drift guard — bail entirely
        // when the user has navigated to a different project mid-restore.
        // Pre-fix the committed sub-branch's setProject was already
        // identity-gated (see line ~225) but the applyMappedError at
        // line ~258 was unconditional, so a stale-A restore failure
        // would fire setActionError on B. Skipping the whole catch
        // here is correct: the committed recovery GET (if reached)
        // targets A's slug and its .then has its own identity guard,
        // so any post-navigation state corruption was already covered
        // — the only remaining cross-project leak was the actionError
        // banner, which this guard now closes.
        if (
          restoreStartedForProjectId !== undefined &&
          projectRef.current?.id !== restoreStartedForProjectId
        ) {
          return;
        }
        const mapped = mapApiError(err, "trash.restoreChapter");
        // ABORTED returns message: null. Skip log + state update so a
        // late abort does not surface noise.
        if (mapped.message !== null) console.error("Failed to restore chapter:", err);
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
        applyMappedError(mapped, {
          onCommitted: () => {
            setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
            // I4 (4b.3c.3): the server may have committed the restore
            // but the response was unreadable. Fire a recovery GET so
            // the sidebar reflects server-truth state and reseed the
            // confirmed-status cache for the freshly-merged chapters.
            // Uses restoreRecoveryAbortRef (second-tier; survives the
            // next handleRestore's restoreOp abort) so the recovery
            // refresh from a failed restore can finish even if the user
            // immediately retries.
            // S2 (review 2026-05-27): use the freshest slug at the
            // time we know we need it. The useCallback's `slug`
            // closure can lag if a parent-project restore changed it
            // between user clicks; slugRef is sync-on-render.
            const currentSlug = slugRef.current;
            if (!currentSlug) return;
            restoreRecoveryAbortRef.current?.abort();
            const recoveryController = new AbortController();
            restoreRecoveryAbortRef.current = recoveryController;
            api.projects
              .get(currentSlug, recoveryController.signal)
              .then((refreshed) => {
                if (recoveryController.signal.aborted) return;
                // I2 (review 2026-05-27): sequence guard. If a newer
                // handleRestore has started (success or failure)
                // between this recovery GET's dispatch and resolution,
                // restoreToken is stale and the stale snapshot must
                // not touch state. Pre-fix, a successful Restore-B
                // landing while Restore-A's recovery GET was in
                // flight could see GET-A overwrite B's chapter merge.
                if (restoreToken.isStale()) return;
                // I1 (review 2026-05-27): single identity guard for
                // BOTH setProject and replaceConfirmedStatuses. If the
                // user navigated to a different project mid-GET,
                // projectRef.current.id reflects that — bail entirely
                // so the stale snapshot can't touch either piece of
                // state. Pre-fix, only the setProject updater bailed.
                if (projectRef.current?.id !== refreshed.id) return;
                setProject((prev) => (prev?.id === refreshed.id ? refreshed : prev));
                replaceConfirmedStatusesRef.current?.(refreshed);
              })
              .catch((recoveryErr) => {
                devWarn(
                  "handleRestore recovery GET failed",
                  recoveryController.signal,
                  recoveryErr,
                );
              })
              .finally(() => {
                // T1 (review 2026-05-27): null the ref once this
                // recovery GET has settled so a later committed
                // restore's preamble `.abort()` is a no-op on the
                // completed controller rather than flipping its
                // signal.aborted. Identity-checked so we don't clobber
                // a controller a later restore has already replaced.
                // Mirrors S17 (createRecoveryAbortRef in
                // useProjectEditor) and S19 (restoreFollowupAbortRef
                // in useSnapshotState).
                if (restoreRecoveryAbortRef.current === recoveryController) {
                  restoreRecoveryAbortRef.current = null;
                }
              });
          },
          onMessage: setActionError,
        });
      }
    },
    [slug, setProject, navigate, restoreOp, restoreSeq],
  );

  const confirmDeleteChapter = useCallback(async () => {
    if (!deleteTarget) return;
    setActionError(null);
    let success: boolean;
    try {
      success = await handleDeleteChapter(deleteTarget, (message) => {
        setActionError(message);
      });
    } catch (err) {
      // I5 (4b.3c.2, 2026-05-26 pushback): this catch is reachable only on
      // a programming bug — handleDeleteChapter surfaces all API errors via
      // its onError callback (which sets actionError above), never as a
      // throw. The bare catch existed pre-I5 to keep the dialog from
      // hanging open if a future refactor introduced a throw. Add a
      // console.warn so the programming-bug path is observable in dev;
      // the dialog still dismisses so the user isn't stuck.
      console.warn("confirmDeleteChapter programming-bug path:", err);
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
      //
      // I2 (review 2026-05-27 round 2, sibling of handleRestore /
      // openTrash): capture project id at refresh entry so the post-
      // await state writes bail when the user has navigated A → B
      // mid-refresh. Pre-fix, the catch's setActionError would surface
      // A's "failed to load trash" copy on B's UI for a refresh that
      // happened against A.
      const startedForProjectId = project.id;
      const isStaleProject = () =>
        startedForProjectId !== undefined && projectRef.current?.id !== startedForProjectId;
      const { promise, signal } = trashOp.run((s) => api.projects.trash(project.slug, s));
      try {
        const trashed = await promise;
        if (signal.aborted) return;
        if (isStaleProject()) return;
        setTrashedChapters(trashed);
      } catch (err) {
        if (signal.aborted) return;
        if (isStaleProject()) return;
        applyMappedError(mapApiError(err, "trash.load"), { onMessage: setActionError });
      }
    }
  }, [deleteTarget, handleDeleteChapter, trashOpen, project, trashOp]);

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
