import { useCallback, useEffect, useRef } from "react";
import type { Chapter } from "@smudge/shared";
import { countWords } from "@smudge/shared";
import { api } from "../api/client";
import { getCachedContent, clearCachedContent } from "./useContentCache";
import { useAbortableSequence } from "./useAbortableSequence";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { makeStaleProjectGuard } from "./staleProjectGuard";
import {
  mapApiError,
  applyMappedError,
  devWarn,
  isAborted,
  isNotFound,
  clientWarn,
} from "../errors";
import type { ChapterCrudDeps, ReloadOutcome } from "./useProjectEditor.types";

// Chapter-CRUD seam of useProjectEditor (F-2 decomposition, 2026-05-29):
// create / select / reload / delete / reorder. Extracted verbatim from
// useProjectEditor so the documented cross-handler race invariants are
// preserved exactly. The ops below are used only by these handlers, so they
// are allocated here (cohesion); the genuinely shared primitives — project /
// chapter state setters, the shared refs, the save-cancel helper, and the
// confirmed-status reseed — are owned by the parent and threaded in via deps.
export function useChapterCrud(deps: ChapterCrudDeps) {
  const {
    setProject,
    setActiveChapter,
    setSaveStatus,
    setSaveErrorMessage,
    setCacheWarning,
    setChapterWordCount,
    setChapterReloadKey,
    setError,
    activeChapterRef,
    projectRef,
    projectSlugRef,
    confirmedStatusRef,
    onProjectNotFoundRef,
    cancelInFlightSave,
    replaceConfirmedStatusesFromProject,
  } = deps;

  const selectChapterSeq = useAbortableSequence();
  // C-4 (Phase 4b.3b): handleCreateChapter routes its POST through this
  // hook so the in-flight fetch is severed on supersede/unmount. The
  // existing projectRef/projectSlugRef drift checks after the await are
  // orthogonal (response-discard) and remain.
  const createChapterOp = useAbortableAsyncOperation();
  // I1 (review 2026-05-27 round 2): per-create epoch token. Bumped at
  // every handleCreateChapter entry; the recovery branch's post-await
  // .then checks the token before touching state, so a recovery GET
  // from Create-A is silently discarded once Create-B has started
  // (whether B succeeded or also entered its own recovery branch).
  // Closes the cross-create race where A's stale recovery snapshot
  // would overwrite B's successful chapter merge and silently drop B
  // from the sidebar. Mirrors useTrashManager's restoreSeq (I2 round 1)
  // and the existing statusChangeSeq pattern.
  const createChapterSeq = useAbortableSequence();
  // C-7 + C-8 (Phase 4b.3b): handleSelectChapter and reloadActiveChapter
  // share a single instance. Both are mutually-compatible "load chapter
  // content" operations that already share selectChapterSeq for
  // response-staleness via token; a new call from either supersedes the
  // prior. The hook layers network cancellation on top: the in-flight
  // GET is severed rather than just having its setState gated by
  // token.isStale(). useEditorMutation's expected-id supersession path
  // (see useEditorMutation.ts:419-432) remains the cross-caller
  // contract; this shared instance does not change that.
  // useAbortableSequence and useAbortableAsyncOperation are orthogonal —
  // both apply to every call.
  //
  // S6 (review 2026-05-25, follow-up to Pushback #8 in the decision log):
  // verification that the shared instance is race-safe across the two
  // callers — handleSelectChapter and reloadActiveChapter are never
  // BOTH live with mutually-exclusive intents simultaneously. Both
  // funnel through selectChapterSeq.start()/capture() at the top, and
  // either caller's start() invalidates the other's pending token. The
  // "abort prior controller" semantics of useAbortableAsyncOperation
  // therefore align with the seq's "drop stale responses" semantics:
  // when reloadActiveChapter supersedes a slow handleSelectChapter (or
  // vice-versa), the prior fetch is severed AND the stale response
  // would have been discarded anyway. Allocating a second instance
  // would be wasteful, not safer — the two ops have identical
  // supersede semantics (load-the-chapter, drop anything older).
  const selectChapterOp = useAbortableAsyncOperation();
  // C5 (review 2026-04-24): rapid drag-drop reorders used to issue
  // overlapping PUTs to /chapters/order with no client-side ordering
  // guard — the persisted order was whichever PUT SQLite's writer lock
  // serialized last, not the user's last drop. Mirror
  // statusChangeAbortRef: abort the prior in-flight PUT before issuing
  // a new one, and thread the signal into api.projects.reorderChapters
  // so the older request is actually severed.
  const reorderOp = useAbortableAsyncOperation();
  // S-7 (Phase 4b.3b): handleDeleteChapter threads a single signal into
  // TWO sequential api calls within one deleteChapterOp.run() callback:
  // api.chapters.delete AND the post-delete api.chapters.get for the
  // next active chapter. The hook's per-call signal is the SAME
  // instance across both awaits (pinned by the hook-level contract
  // test in useAbortableAsyncOperation.test.ts) — one unmount aborts
  // both calls together. Replaces a hand-rolled
  // `useRef<AbortController>` that paired an `abort()` with a
  // self-clearing identity check; the hook owns that bookkeeping now.
  const deleteChapterOp = useAbortableAsyncOperation();
  // I22 (review 2026-04-24): recovery GETs fired by BAD_JSON catches
  // in handleCreateChapter need an AbortController so unmount drops the
  // in-flight recovery.
  // C1 (review 2026-04-25): each handler owns its own ref. Earlier we
  // tried a single shared ref ("only the latest matters" — superseded
  // recoveries from the SAME handler are fine to abort), but a status
  // revert that fires while a create-recovery GET is in flight would
  // abort the create's controller. The create's recovery body wraps
  // the GET in `try { ... } catch {}`, so the cross-handler abort
  // was silently swallowed and the new chapter never landed in the
  // sidebar. Per-handler refs scope the "latest wins" rule to its own
  // handler and leave siblings untouched.
  //
  // Phase 4b.3b decision matrix row C-5: createRecoveryAbortRef is kept
  // hand-rolled. It fires from the catch branch of handleCreateChapter and
  // runs a follow-up GET that must complete even after the primary
  // mutation's hook has auto-aborted. Routing it through the primary's hook
  // would cause the next mutation to cancel the previous mutation's recovery
  // refresh — exactly the case where the previous error's user-visible
  // state most needs the refresh to land.
  // eslint-disable-next-line no-restricted-syntax -- second-tier create-recovery: must outlive createChapterOp's auto-abort (see comment above)
  const createRecoveryAbortRef = useRef<AbortController | null>(null);

  // Unmount cleanup for the hand-rolled create-recovery controller so a
  // late-resolving recovery GET can't fire setState on a torn-down hook.
  // (The op hooks above auto-abort their own controllers on unmount.)
  useEffect(() => {
    return () => {
      createRecoveryAbortRef.current?.abort();
    };
  }, []);

  const handleCreateChapter = useCallback(
    async (onError?: (message: string) => void) => {
      const slug = projectSlugRef.current;
      const projectId = projectRef.current?.id;
      if (!slug || !projectId) return;
      const isStaleProject = makeStaleProjectGuard(projectRef, projectSlugRef);
      // I1 (review 2026-05-27 round 2): bump the per-create epoch BEFORE
      // anything else so any older create's still-pending recovery GET is
      // invalidated. The token is checked inside that GET's await branch
      // (below) so a stale recovery response from Create-A is silently
      // discarded once Create-B has started — closing the cross-create
      // race where A's snapshot would overwrite B's successful chapter
      // merge and silently drop B from the sidebar.
      const createToken = createChapterSeq.start();
      // S6 (review 2026-04-21) + C1 (review 2026-04-24): the post-await
      // drift guard below combines two checks.
      //   1. Project id captured at POST time vs projectRef.current?.id
      //      at response time. The id is stable across rename and
      //      changes only on cross-project navigation AFTER the new
      //      project finishes loading. This distinguishes rename
      //      (keep) from completed cross-project nav (discard).
      //   2. Slug two-part compare (projectSlugRef vs captured slug
      //      AND vs projectRef.slug). The id check can't see the
      //      window between a URL slug prop change and loadProject
      //      completing — projectRef still holds the old project's
      //      id, so id equality passes. The slug compare catches
      //      that window because projectSlugRef has already advanced
      //      to the new URL slug while projectRef.slug still holds
      //      the old one.
      // Both checks are needed: (1) covers post-load cross-nav, (2)
      // covers pre-load cross-nav, neither covers what the other does.
      // Full cancel of any in-flight save: abort the save sequence, abort
      // the fetch, and unblock any backoff sleep (S1). A bare seq-abort
      // without the controller abort + backoff clear would short-circuit
      // the retry loop's isStale() check but leave the AbortController
      // live and the backoff timer scheduled — the timer would wake up
      // seconds later, do nothing useful (guarded by isStale), but hold a
      // reference to the old chapter id until it fired. Matches the
      // discipline of handleSelectChapter / handleDeleteChapter.
      cancelInFlightSave();
      // Also cancel any in-flight chapter GET (reloadActiveChapter or
      // handleSelectChapter). Without this abort, a pending reload's
      // setActiveChapter landing after the POST would overwrite the
      // newly-created chapter with the old one, and subsequent keystrokes
      // would PATCH the stale chapter id (I4).
      selectChapterSeq.abort();
      setSaveStatus("idle");
      setSaveErrorMessage(null);
      setCacheWarning(false);
      try {
        const { promise, signal } = createChapterOp.run((s) => api.chapters.create(slug, s));
        const newChapter = await promise;
        if (signal.aborted) return;
        // C2 + C1: discard the response if the user navigated to a
        // different project mid-POST. Without this, `setActiveChapter`
        // and the `setProject` merge would write Project A's new
        // chapter into Project B's state, producing a phantom chapter
        // in the sidebar and pointing subsequent edits at the wrong
        // project's chapter id.
        if (isStaleProject()) return;
        // Backlog 8b34a209, residual. SIX writes take the OUTER guard only,
        // not the inside-updater re-test. On the success path:
        // `setActiveChapter` and `setChapterWordCount` immediately below, and
        // the `confirmedStatusRef.current[newChapter.id]` seed after the
        // setProject merge. In the recovery arm further down:
        // `replaceConfirmedStatusesFromProject` plus its own
        // `setActiveChapter`/`setChapterWordCount` pair.
        //
        // The count has now been wrong twice in opposite directions, which is
        // why it is spelled out write by write. I6 (review 2026-08-23) found
        // the original text saying "the confirmedStatusRef seed below",
        // singular — it named the success-path seed and silently dropped the
        // recovery arm's whole-map replacement, the more damaging of the two.
        // S1 (same review, round 2) found the I6 rewrite had swapped one
        // omission for the opposite one: it said "FOUR" over a five-item list
        // and dropped the success-path seed the original HAD named. Per
        // CLAUDE.md F-19 the enumeration IS the mitigation, so a residual
        // missing from it has no mitigation at all.
        //
        // They are plain value sets with no updater body, so there is no
        // drain-time hook where a `prev.id === projectId` re-test could
        // live — the guarantee the setProject call below gets is simply
        // not available to them. Note that adding a second statement-time
        // identity re-check just before them, the way useTrashManager does,
        // does NOT close this: `projectRef.current` is a render-body mirror
        // (useProjectEditor.ts, `projectRef.current = project`), so during
        // the drain window it still reads the OLD project and any re-check
        // against it passes exactly when it needs to fail. useTrashManager's
        // inner re-check earns its keep as defence against a future `await`
        // being inserted above it, which is a different hazard.
        //
        // What would actually close it is making the status write ADDITIVE
        // instead of a whole-map replacement, so a snapshot that loses the
        // race can only add unread keys rather than evict the live project's
        // baselines. That changes the shared helper's semantics for all
        // three of its callers, so it is filed as backlog `9c2ad4e1` rather
        // than done here.
        //
        // S6 (review 2026-08-23): this window may not be reachable today.
        // `useProjectEditor`'s render body writes `projectSlugRef.current = slug`
        // synchronously before the load effect dispatches, so on a real
        // A-to-B navigation `makeStaleProjectGuard` check 2 fires first and the
        // handler bails before any of this runs. Treat the guards as
        // defence-in-depth against a future producer that advances the two refs
        // in a different order, not as a fix for a defect anyone has observed.
        // They cost one comparison; the failure they prevent is silent.
        //
        // The asymmetry is deliberate and bounded: in the queue-drain window
        // the sidebar now stays correct (project B's list is untouched) while
        // the editor may briefly hold A's chapter — confusing, and it clears
        // on the next project load, where before the window left a phantom
        // chapter wedged in B's list that reorder and delete would then
        // operate on. The recovery arm's status-map replacement does NOT
        // self-heal the same way; that is what `9c2ad4e1` covers.
        setActiveChapter(newChapter);
        setChapterWordCount(0);
        // Backlog 8b34a209: re-test identity INSIDE the updater. The
        // isStaleProject() guard above is strictly stronger than an id
        // compare — it also catches the pre-load window — but it is
        // evaluated here, while this updater body runs later, when React
        // drains the queue. A setProject(B) queued by a concurrent
        // loadProject(B) in between drains first, and this updater would
        // then append A's chapter onto B's list: a phantom chapter in
        // project B's sidebar whose id points into project A. An outer
        // guard cannot see inside the queue; only the updater can.
        // Follows the S20 precedent in handleReorderChapters below.
        setProject((prev) =>
          prev && prev.id === projectId
            ? { ...prev, chapters: [...prev.chapters, newChapter] }
            : prev,
        );
        // C2 (review 2026-04-25): seed the confirmed-status cache for the
        // newly-inserted row. Without this, a later status PATCH on this
        // chapter that fails (PATCH + recovery GET both failing) reads
        // previousStatus = undefined and silently skips the local-revert
        // fallback at line "if (!reverted && previousStatus !== undefined)",
        // leaving the optimistic status on screen even though the server
        // never accepted it. Mirrors loadProject's seed.
        confirmedStatusRef.current[newChapter.id] = newChapter.status;
      } catch (err) {
        // I2 (review 2026-05-25): chapter.create now threads the
        // createChapterOp signal, so supersede/unmount rejects this
        // catch with ApiRequestError{ABORTED}. The warn at this site
        // (and the downstream mapApiError + onError) must short-circuit
        // before logging — otherwise every navigate-away mid-POST emits
        // a "Failed to create chapter: ABORTED" warning, violating
        // CLAUDE.md §Testing Philosophy zero-warnings rule.
        if (isAborted(err)) return;
        // I3 (review 2026-05-27): drift guards run BEFORE the S11 404
        // short-circuit. If the user navigated A → B mid-POST and A
        // returned 404 (A was deleted server-side), onProjectNotFound
        // (wired to navigate("/") in EditorPage) would otherwise yank
        // the user out of project B for an event that's irrelevant
        // there. The drift guards convert that stale-A 404 into a
        // silent no-op — same discipline as the existing onError gate
        // below, just hoisted above the navigation side-effect.
        if (isStaleProject()) return;
        // S11 (4b.3c.3): a 404 means the project was deleted between
        // the sidebar render and the POST landing. The default banner
        // (createChapterProjectGone) was the wrong UX because the
        // project no longer exists for the user to act on — fire the
        // navigate-home hook instead. The createChapterProjectGone
        // string stays in scopes.ts as a defensive fallback for the
        // option-omitted consumer (tests, storybook).
        if (isNotFound(err)) {
          if (onProjectNotFoundRef.current) {
            onProjectNotFoundRef.current();
            return;
          }
          // No navigation hook wired: fall through so the dismissible
          // banner stands as a recoverable UX.
        }
        clientWarn("Failed to create chapter:", err);
        // I4: route through the onError callback (same pattern as
        // handleRenameChapter / handleStatusChange / handleDeleteChapter)
        // so a recoverable failure surfaces as a dismissible banner
        // rather than the full-screen error overlay, which would tear
        // down the editor session and leave the user with only a
        // "back to projects" link.
        const { message, possiblyCommitted } = mapApiError(err, "chapter.create");
        if (!message) return;
        // C1: chapter.create is non-idempotent — the server assigns a new
        // row per POST. On an ambiguous-commit outcome (2xx BAD_JSON ⇒
        // possiblyCommitted) or the explicit READ_AFTER_CREATE_FAILURE
        // code, the row may already exist on the server and retrying
        // would create a duplicate. Fetch the project fresh so the new
        // chapter appears in the sidebar without another POST; surface
        // the committed-specific copy so the user knows not to click
        // Add chapter again.
        //
        // S8 (review 2026-04-24): `possiblyCommitted` now covers both
        // 2xx BAD_JSON and the explicit READ_AFTER_CREATE_FAILURE code
        // (via scope.committedCodes). The former inline `err.code ===
        // "READ_AFTER_CREATE_FAILURE"` check lived here to work around
        // that gap; removing it keeps the recovery logic in the scope
        // registry where future committed-intent codes can be added
        // without touching this call site.
        if (possiblyCommitted) {
          // I7: snapshot pre-POST chapter ids so we can identify the
          // server-created row in the refreshed list. The happy path
          // calls setActiveChapter(newChapter); the recovery path must
          // match that intent or the user sees the new chapter appear
          // in the sidebar but stays on the previously-active chapter,
          // contradicting the committed-banner UX.
          const previousChapterIds = new Set(projectRef.current?.chapters.map((c) => c.id) ?? []);
          createRecoveryAbortRef.current?.abort();
          const recoveryController = new AbortController();
          createRecoveryAbortRef.current = recoveryController;
          // S1 (review 2026-05-27 round 2): use the freshest slug at
          // the time we know we need it. The handler-entry `slug`
          // closure can lag if handleUpdateProjectTitle lands between
          // create POST dispatch and this catch firing — the rename
          // writes projectSlugRef.current to the new slug, but the
          // captured `slug` still points at the dead old one. A GET
          // against the old slug 404s, the catch's devWarn logs and
          // the post-recovery banner surfaces with no sidebar refresh.
          // Mirrors useTrashManager.handleRestore's S2 fix.
          //
          // S2 (review 2026-05-27 round 3): drop the `?? slug`
          // fallback. The entry-time guards at 797-799 protect against
          // cross-project navigation, so projectSlugRef.current being
          // undefined here is unreachable in practice. If a future
          // refactor weakens those guards, falling back to the
          // (known-stale) captured `slug` would fire a doomed GET
          // (404 → devWarn) against a dead slug; skip the recovery
          // GET entirely and fall through to the committed banner
          // dispatch below.
          const recoverySlug = projectSlugRef.current;
          try {
            // S2 (round 3): no slug → skip the GET entirely. We stay
            // inside the try so the finally still nulls the ref, and
            // fall through to the message dispatch below.
            if (recoverySlug) {
              const refreshed = await api.projects.get(recoverySlug, recoveryController.signal);
              if (recoveryController.signal.aborted) return;
              // I1 (review 2026-05-27 round 2): sequence guard. If a newer
              // handleCreateChapter has started between this recovery GET's
              // dispatch and resolution, createToken is stale and the
              // stale snapshot must not touch state. Pre-fix, a successful
              // Create-B landing while Create-A's recovery GET was in
              // flight could see GET-A overwrite B's chapter merge —
              // silently dropping B from the sidebar and (via the
              // previousChapterIds capture inside the catch) yanking the
              // user back onto one of A's chapters. The seq guard makes
              // the previousChapterIds capture-timing subsidiary moot
              // because the whole post-await block bails before reaching
              // it.
              if (createToken.isStale()) return;
              // Merge only if the user is still on the same project. The prior
              // slug-OR check let a stale recovery response merge into a
              // different project's state after the user navigated away AND the
              // new project finished loading (the two refs then realign to the
              // new slug, making the OR evaluate true).
              //
              // OOSS1 (agentic-review 2026-08-05): this was the one post-await
              // arm in handleCreateChapter still on the id-only compare while
              // its three siblings used the full-strength guard built at entry.
              // The id check cannot see the PRE-LOAD window (URL slug advanced,
              // loadProject unfinished, projectRef still holding A) — and this
              // arm is the most expensive one to get wrong: setProject writes
              // A's whole snapshot, the confirmed-status map is replaced with
              // A's pairs, setActiveChapter pins A's new chapter, and any
              // keystroke in that window auto-saves against A's chapter id
              // while the user is on B's URL.
              // S14 (review 2026-08-23): `refreshed.id === projectId` is a
              // SEPARATE question from the drift guard, and both are needed.
              // isStaleProject() asks "is the user still on the project this
              // create started in"; this asks "is the snapshot that came back
              // actually that project". They can disagree, because the recovery
              // GET addresses the project by SLUG and a slug is not a stable
              // address: CLAUDE.md §"Slugs are mutable and reclaimable" records
              // that renaming a project away from slug S releases S to the next
              // project whose title generates it. So the GET can answer 200 with
              // a different project's snapshot while every id-based drift check
              // still passes. Checking it here means the arm below never
              // installs a stranger's chapters.
              if (!isStaleProject() && refreshed.id === projectId) {
                // Backlog 8b34a209 (absorbing a65acf76): same queue-drain
                // window as the success path above, and worse here —
                // `refreshed` is A's WHOLE snapshot, so an unguarded
                // merge replaces project B's state outright.
                setProject((prev) => (prev && prev.id === projectId ? refreshed : prev));
                // C2 (review 2026-04-25): re-seed the confirmed-status cache
                // from the refreshed project. The recovery branch is a fresh
                // server snapshot, so it carries the authoritative status
                // for every chapter — same discipline as loadProject's seed.
                // Without this, the newly-created chapter (and any other row
                // whose status changed server-side between initial load and
                // recovery) has no cache entry, and a later revert silently
                // skips.
                replaceConfirmedStatusesFromProject(refreshed);
                const added = refreshed.chapters.filter((c) => !previousChapterIds.has(c.id));
                if (added.length > 0) {
                  // Pick the highest sort_order: the server appends new
                  // chapters to the end. If somehow more than one row
                  // appeared (unexpected), the most-recently-appended
                  // one is still the best candidate for the user's
                  // intended click.
                  const newest = added.reduce((a, b) => (a.sort_order > b.sort_order ? a : b));
                  setActiveChapter(newest);
                  setChapterWordCount(countWords(newest.content));
                }
              }
            }
          } catch (err) {
            // S10 (4b.3c.2): surface the recovery failure in dev. The
            // recoveryController.signal gates the warn — supersede or
            // unmount-driven aborts stay silent. Best-effort otherwise:
            // the error copy still instructs the user to refresh if the
            // post-recovery message lands.
            devWarn("handleCreateChapter recovery GET failed", recoveryController.signal, err);
            // Refresh is best-effort; fall through to the message dispatch.
          } finally {
            // S1 (review 2026-05-27 round 3): null the ref in finally
            // so a recovery-GET reject also clears it (the original
            // S17 fix sat at the success-arm tail and was skipped on
            // catch and on early returns). Mirrors sibling patterns
            // T1 (useTrashManager.handleRestore) and S19
            // (useSnapshotState restoreFollowupAbortRef). Identity-
            // checked so we don't clobber a controller a later handler
            // already replaced.
            if (createRecoveryAbortRef.current === recoveryController) {
              createRecoveryAbortRef.current = null;
            }
          }
        }
        // I3 (review 2026-05-27 round 3): drift recheck before the
        // onError/setError dispatch. The entry-time guards at 797-799
        // ran BEFORE the possiblyCommitted recovery GET awaited; the
        // success arm has its own createToken.isStale() guard plus a
        // projectRef.id check at the inside-updater, but the catch
        // arm's devWarn falls through to here. The recovery GET can
        // take seconds — A→B nav within the window is realistic, and
        // without this recheck the failure-axis banner fires on B for
        // an A event (worst case: setError surfaces the full-page
        // overlay when no onError is wired, tearing down B's editor).
        // S2 (review 2026-07-26): use the full-strength guard already built at
        // this callback's entry rather than a hand-rolled id-only compare. The
        // id check alone cannot see the pre-load window — URL slug advanced to
        // B, loadProject not yet finished, projectRef still holding A's id — so
        // it waved through exactly the case the comment above describes, the
        // worst of which is setError raising the full-page overlay on B for an
        // A event when no onError is wired.
        if (isStaleProject()) return;
        if (onError) {
          onError(message);
        } else {
          setError(message);
        }
      }
    },
    [
      cancelInFlightSave,
      selectChapterSeq,
      createChapterOp,
      createChapterSeq,
      replaceConfirmedStatusesFromProject,
      projectSlugRef,
      projectRef,
      confirmedStatusRef,
      onProjectNotFoundRef,
      setProject,
      setActiveChapter,
      setChapterWordCount,
      setSaveStatus,
      setSaveErrorMessage,
      setCacheWarning,
      setError,
    ],
  );

  /**
   * Resolves TRUE only when `activeChapter` actually became `chapterId`.
   *
   * I1 (review 2026-08-16): this used to be `Promise<void>`, and
   * `handleSelectChapterWithFlush` reported success by returning a hardcoded
   * `true` after awaiting it. Every early exit below leaves the user on the old
   * chapter, and the catch swallows its error into a banner — so the
   * Ctrl+Shift+Arrow live region announced "Navigated to <chapter>" on a failed
   * or superseded load. F-13 removed that lie for `switchToView` refusals; the
   * load-failure path kept it. The truth is only knowable here, so it is
   * reported from here rather than re-derived at the call site.
   */
  const handleSelectChapter = useCallback(
    async (chapterId: string): Promise<boolean> => {
      // Already there: nothing moved, so nothing may be announced as having
      // moved. (Unreachable from Ctrl+Shift+Arrow, which always targets a
      // different index — this is the sidebar re-click path.)
      if (activeChapterRef.current && chapterId === activeChapterRef.current.id) return false;
      // Seq bump + abort + backoff-unblock. Before S3 this path only bumped
      // the seq and aborted — if a retry was asleep in backoff, it would
      // sit for up to 8s before the next iteration's seq check fired.
      cancelInFlightSave();
      setSaveStatus("idle");
      // Mirror handleCreateChapter: the previous chapter's persistent save
      // failure message must not follow the user into the newly-selected
      // chapter. The status reset alone hides the footer indicator, but
      // saveErrorMessage is a separate state and would otherwise linger.
      setSaveErrorMessage(null);
      setCacheWarning(false);
      const token = selectChapterSeq.start();
      try {
        // C-7 (Phase 4b.3b): the shared selectChapterOp severs the
        // network request on supersede/unmount; token.isStale() remains
        // for response-staleness gating. Both checks apply.
        const { promise, signal } = selectChapterOp.run((s) => api.chapters.get(chapterId, s));
        const chapter = await promise;
        if (signal.aborted) return false;
        if (token.isStale()) return false; // superseded by a newer selection
        const cached = getCachedContent(chapterId);
        const effectiveChapter = cached ? { ...chapter, content: cached } : chapter;
        setActiveChapter(effectiveChapter);
        setChapterWordCount(countWords(effectiveChapter.content));
        return true;
      } catch (err) {
        // I2 (review 2026-05-25): selectChapterOp.run aborts prior
        // requests on supersede and unmount, so ABORTED rejections are
        // an intentional control-flow signal here — silence them
        // before the warn so test output stays clean.
        if (isAborted(err)) return false;
        clientWarn("Failed to load chapter:", err);
        if (token.isStale()) return false;
        applyMappedError(mapApiError(err, "chapter.load"), { onMessage: setError });
        return false;
      }
    },
    [
      cancelInFlightSave,
      selectChapterSeq,
      selectChapterOp,
      activeChapterRef,
      setActiveChapter,
      setChapterWordCount,
      setSaveStatus,
      setSaveErrorMessage,
      setCacheWarning,
      setError,
    ],
  );

  const reloadActiveChapter = useCallback(
    async (
      onError?: (message: string) => void,
      expectedChapterId?: string,
    ): Promise<ReloadOutcome> => {
      const current = activeChapterRef.current;
      // No active chapter to reload — treat as superseded so callers don't
      // raise a lock banner. "failed" is reserved for a fetch that actually
      // errored; this path is the "nothing to refresh" case and the editor
      // state is already consistent.
      if (!current) return "superseded";
      // If the caller passed an expected chapter id and the active chapter
      // no longer matches, the user switched between the directive that
      // requested the reload and this call. Skip the reload entirely —
      // blindly clearing the new chapter's cache and fetching its server
      // copy would wipe the user's in-progress draft of an unrelated
      // chapter (I2). Return "superseded" so useEditorMutation knows the
      // skip is intentional (not a failure warranting a lock banner) but
      // also does NOT mark the lock-override "reloadSucceeded" flag — the
      // now-active chapter's server state was NOT refreshed.
      if (expectedChapterId !== undefined && current.id !== expectedChapterId) {
        return "superseded";
      }
      // I7 (review 2026-04-21): a bare saveSeq.abort() short-circuits
      // the retry loop but leaves the in-flight AbortController and any
      // pending backoff timer dangling. The sole current caller
      // (useEditorMutation) already runs cancelPendingSaves() before
      // reloadActiveChapter, but a future direct caller would inherit a
      // resource leak. Use cancelInFlightSave for parity with
      // handleSelectChapter / handleCreateChapter / handleDeleteChapter —
      // all chapter-state transitions consolidate save cancellation
      // through the same helper.
      cancelInFlightSave();
      setSaveStatus("idle");
      setCacheWarning(false);
      const token = selectChapterSeq.start();
      try {
        // C-8 (Phase 4b.3b): the shared selectChapterOp severs the
        // network request on supersede/unmount; token.isStale() remains
        // for response-staleness gating. Both checks apply.
        const { promise, signal } = selectChapterOp.run((s) => api.chapters.get(current.id, s));
        const chapter = await promise;
        if (signal.aborted) return "superseded";
        if (token.isStale()) return "superseded";
        // Clear cache AFTER the server GET succeeds (invariant 3). Before
        // I3, this ran pre-GET — a failed GET would have already erased the
        // draft cache that could serve recovery, weakening defense-in-depth.
        clearCachedContent(current.id);
        setActiveChapter(chapter);
        setChapterWordCount(countWords(chapter.content));
        // Bump reload key so the Editor remounts with fresh server content
        setChapterReloadKey((k) => k + 1);
        return "reloaded";
      } catch (err) {
        // I2 (review 2026-05-25): selectChapterOp.run aborts prior
        // requests on supersede and unmount; ABORTED is intentional and
        // must short-circuit before the warn to keep test output clean.
        // Return "superseded" so callers (useEditorMutation) treat the
        // abort as a non-fatal skip rather than a lock-worthy failure
        // (mirrors the token.isStale() arm immediately below).
        if (isAborted(err)) return "superseded";
        clientWarn("Failed to reload chapter:", err);
        // Token stale during the GET → user navigated away. A newer
        // select owns state now; "superseded" is correct and must not
        // route to the lock banner (I5).
        if (token.isStale()) return "superseded";
        // If an onError callback is provided, route the failure there so
        // callers (e.g. post-replace reload) can surface a non-fatal banner
        // without flipping EditorPage into the full-screen error branch.
        // Falling back to setError preserves the legacy behavior when no
        // callback is supplied (e.g. snapshot restore reload).
        const mapped = mapApiError(err, "chapter.load");
        if (mapped.message === null) return "failed";
        applyMappedError(mapped, {
          onMessage: (message) => {
            if (onError) {
              onError(message);
            } else {
              setError(message);
            }
          },
        });
        return "failed";
      }
    },
    [
      cancelInFlightSave,
      selectChapterSeq,
      selectChapterOp,
      activeChapterRef,
      setActiveChapter,
      setChapterWordCount,
      setChapterReloadKey,
      setSaveStatus,
      setCacheWarning,
      setError,
    ],
  );

  const handleDeleteChapter = useCallback(
    async (chapter: Chapter, onError?: (message: string) => void): Promise<boolean> => {
      // I2 (review 2026-05-27 round 2, sweep): capture project id at
      // entry so the catch can bail before applyMappedError → onError
      // if the user has navigated A → B mid-delete. Pre-fix, the
      // catch fired onError unconditionally and useTrashManager's
      // confirmDeleteChapter (which wires onError to setActionError)
      // surfaced A's "failed to delete" banner on B. Mirrors the
      // captured-id discipline in handleCreateChapter / handleReorderChapters /
      // handleUpdateProjectTitle.
      const isStaleProject = makeStaleProjectGuard(projectRef, projectSlugRef);
      // Sequence abort + controller abort + backoff-unblock. Before S3
      // this path omitted the backoff-unblock, so a retry asleep in
      // backoff could wake up after the chapter was gone. The isStale()
      // check still short-circuits the resume, but the wakeup wasted a
      // setTimeout slot and held a reference to the deleted chapter id
      // until the timer fired.
      cancelInFlightSave();
      // Also cancel any in-flight chapter GET (matches handleCreateChapter
      // discipline): a GET resolving during the delete POST can land
      // setActiveChapter on the chapter the user is deleting, flashing
      // the wrong chapter as active before the delete effect settles.
      selectChapterSeq.abort();
      // Mirror handleSelectChapter: the deleted chapter's save-status must
      // not leak into the empty-state or next-selected chapter. Without
      // this, deleting mid-save leaves the footer stuck on "Saving…" until
      // a new save cycle completes.
      setSaveStatus("idle");
      setSaveErrorMessage(null);
      setCacheWarning(false);
      // S-7 (Phase 4b.3b): I7's "abort prior in-flight delete before
      // issuing a new one" and "cover the controller in unmount cleanup"
      // are now satisfied by deleteChapterOp's hook semantics — run()
      // aborts the prior controller before allocating a fresh one, and
      // the hook auto-aborts on unmount. The single per-call signal
      // `s` threads into BOTH the DELETE and the post-delete GET so
      // one abort severs both calls together (pinned by the
      // useAbortableAsyncOperation hook-level contract test).
      const { promise } = deleteChapterOp.run(async (s): Promise<boolean> => {
        try {
          await api.chapters.delete(chapter.id, s);
          if (s.aborted) return false;
          clearCachedContent(chapter.id);
          // Compute remaining from the ref (current state), not the stale closure
          const remaining = projectRef.current?.chapters.filter((c) => c.id !== chapter.id) ?? [];
          setProject((prev) => {
            if (!prev) return prev;
            return { ...prev, chapters: prev.chapters.filter((c) => c.id !== chapter.id) };
          });

          // OOSS2 (backlog 872b6760): the drift guard covers the SUCCESS path
          // too, not just the two catch arms. Everything below writes
          // active-chapter state, and after an A-to-B navigation those writes
          // land on B.
          //
          // Placed HERE rather than at the entry's suggested spot (right after
          // the DELETE's abort check): `clearCachedContent(chapter.id)` above
          // must still run on drift, because the chapter really is deleted
          // server-side and its cached draft is garbage either way. Bailing
          // earlier would leak that cache entry. The `setProject` filter above
          // is safe on drift by construction — filtering B's chapters by A's
          // deleted id matches nothing — as the catch-path comment already
          // notes.
          //
          // Returning TRUE, matching the two inner arms below: the delete
          // succeeded on the server, so the caller should still refresh its
          // trash list. Only the UI writes are being skipped.
          if (isStaleProject()) return true;
          // If deleting the active chapter, switch to the first remaining
          if (activeChapterRef.current?.id === chapter.id) {
            const first = remaining[0];
            if (first) {
              // Capture-and-compare the select token across the secondary
              // GET (I5). Without this guard, a rapid click-then-click
              // during delete (user selects another chapter after the
              // delete POST resolves but before this GET does) would let
              // the stale "next chapter after delete" fetch pin the
              // sidebar over the user's explicit selection.
              const token = selectChapterSeq.start();
              try {
                // I7: thread the delete signal through the follow-up GET
                // so an unmount (or supersede via the next deleteChapterOp.run)
                // aborts both the DELETE-step and the post-delete
                // active-chapter fetch together.
                const ch = await api.chapters.get(first.id, s);
                if (s.aborted) return true;
                if (token.isStale()) return true;
                // OOSS2: re-check AFTER the await. The guard above ran before
                // this GET was issued; the navigation this defends against
                // typically happens WHILE it is in flight, and because
                // loadProject never calls selectChapterSeq.start(), the token
                // check above cannot see a project switch — only a competing
                // chapter selection. Without this line the GET resolves last
                // and pins project A's chapter as active under project B's
                // URL, and the next keystroke auto-saves into A's chapter id.
                if (isStaleProject()) return true;
                setActiveChapter(ch);
                setChapterWordCount(countWords(ch.content));
              } catch (err) {
                // I2 (review 2026-05-25): the secondary GET now threads
                // the deleteChapterOp signal `s`, so unmount or a
                // superseding delete rejects with ABORTED. Gate the
                // warn first to keep test output clean (matches the
                // outer DELETE catch's discipline at line ~987).
                if (s.aborted) return true;
                // Secondary fetch failed — fall through to the empty state
                // rather than setting activeChapter to the list-level row
                // (which has content=null). Surface the failure via the
                // onError callback and a console.warn so the user and the
                // dev console both learn something went wrong (I3); before
                // I3 the catch was silent and the user saw "Add chapter"
                // as if the project had no chapters left.
                clientWarn("Failed to load chapter after delete:", err);
                if (token.isStale()) return true;
                // I2 (review 2026-05-27 round 2, sweep): drift guard
                // covers the inner secondary-GET catch too — without
                // it, the post-delete chapter-load failure on A's
                // server bubble through onError onto B's UI.
                if (isStaleProject()) return true;
                applyMappedError(mapApiError(err, "chapter.load"), {
                  onMessage: (message) => onError?.(message),
                });
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
          // I7: ABORTED means unmount or a newer delete superseded this
          // one; stay silent so we don't fire a banner on a torn-down
          // caller (happens in practice in tests too).
          if (s.aborted) return false;
          clientWarn("Failed to delete chapter:", err);
          // I2 (review 2026-05-27 round 2, sweep): drift guard before
          // surfacing the failure. The catch already runs after the
          // optimistic-no-op setProject (line 1130, walks new project's
          // chapter list, no match, no change) — only the onError leak
          // matters here.
          if (isStaleProject()) return false;
          applyMappedError(mapApiError(err, "chapter.delete"), {
            onMessage: (message) => onError?.(message),
          });
          return false;
        }
      });

      return promise;
    },
    [
      cancelInFlightSave,
      selectChapterSeq,
      deleteChapterOp,
      projectRef,
      projectSlugRef,
      activeChapterRef,
      setProject,
      setActiveChapter,
      setChapterWordCount,
      setSaveStatus,
      setSaveErrorMessage,
      setCacheWarning,
    ],
  );

  const handleReorderChapters = useCallback(
    async (orderedIds: string[], onError?: (message: string) => void) => {
      const slug = projectSlugRef.current;
      const projectId = projectRef.current?.id;
      if (!slug || !projectId) return;
      const isStaleProject = makeStaleProjectGuard(projectRef, projectSlugRef);
      // C5 (review 2026-04-24): abort any prior in-flight reorder
      // before issuing a new one so overlapping drag-drops cannot
      // commit out of drop order. The signal is threaded through the
      // transport so the browser actually drops the stale request.
      const { promise, signal } = reorderOp.run((s) =>
        api.projects.reorderChapters(slug, orderedIds, s),
      );

      // S4 (dedup review 2026-07-26): the success branch and the
      // possiblyCommitted branch applied the new order with
      // character-for-character identical code — same [S20] inside-updater
      // epoch check, same map, same filter. The committed branch's comment
      // claimed it "stays hand-rolled because it pairs with the [S20]
      // inside-updater epoch check", but the success branch carries that same
      // check, so the justification was void. Precedent: applyTitle in the
      // sibling useChapterMetadata, extracted for exactly this reason.
      //
      // S20 (4b.3c.2): defense-in-depth for the React-scheduling window between
      // each branch's outer project check and this updater actually running. A
      // setProject queued from a concurrent project-switch could drain first,
      // making prev a different project than the one whose orderedIds we
      // captured at handler entry — prev.chapters would then be walked with A's
      // ids, every lookup would miss, and project B would be left with an empty
      // chapter list until refresh.
      const applyOrder = () =>
        setProject((prev) => {
          if (!prev) return prev;
          if (prev.id !== projectId) return prev;
          const reordered = orderedIds
            .map((id, index) => {
              const ch = prev.chapters.find((c) => c.id === id);
              return ch ? { ...ch, sort_order: index } : undefined;
            })
            .filter(Boolean) as Chapter[];
          return { ...prev, chapters: reordered };
        });
      // S6 (review 2026-04-21) + C1 (review 2026-04-24): drift guard —
      // see handleCreateChapter for full rationale.
      try {
        await promise;
        // C2 + C1: discard if the user navigated away mid-PUT. Without
        // this, the reorder would apply Project A's ordered ids to
        // Project B's chapters array — the filter by id then drops
        // everything (ids don't match), leaving Project B with an
        // empty chapters list until refresh.
        if (isStaleProject()) return;
        applyOrder();
      } catch (err) {
        // C5: ABORTED means a newer reorder superseded this one and is
        // driving its own PATCH. Reverting here would stomp the live
        // call; stay silent and let the newer reorder land.
        if (signal.aborted) return;
        clientWarn("Failed to reorder chapters:", err);
        if (isStaleProject()) return;
        // I4: route through the onError callback rather than setError so
        // a 400 on id-list mismatch (recoverable per CLAUDE.md) surfaces
        // as a dismissible banner instead of tearing down the editor.
        const mapped = mapApiError(err, "chapter.reorder");
        // I6 (2026-04-23): 2xx BAD_JSON means the server committed the
        // reorder but the body was unreadable. Before this fix the
        // catch touched no state, so the drag-and-drop visually snapped
        // back to the pre-drag order while the server held the new
        // order — a user retry would re-apply the same order
        // idempotently but confusingly. Apply the requested order to
        // client state on possiblyCommitted so the UI matches the
        // committed server state, and surface the committed copy so
        // the user knows the response was ambiguous.
        //
        // Kept outside applyMappedError's onCommitted so the per-branch
        // placement intent stays visible; the updater itself is applyOrder.
        if (mapped.possiblyCommitted) {
          applyOrder();
        }
        // 4b.3c.2 S15: migrate the message-dispatch tail to applyMappedError.
        // ABORTED's message=null is handled inside the helper; onMessage
        // mirrors the prior `if (onError) onError else setError` ladder.
        applyMappedError(mapped, {
          onMessage: (msg) => {
            if (onError) onError(msg);
            else setError(msg);
          },
        });
      }
    },
    [reorderOp, projectSlugRef, projectRef, setProject, setError],
  );

  return {
    handleCreateChapter,
    handleSelectChapter,
    reloadActiveChapter,
    handleDeleteChapter,
    handleReorderChapters,
  };
}
