import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Chapter, ProjectWithChapters } from "@smudge/shared";
import { api } from "../api/client";
import { mapApiError, isNotFound } from "../errors";
import { clearCachedContent, clearAllCachedContent } from "./useContentCache";
import { useAbortableAsyncOperation } from "./useAbortableAsyncOperation";
import { STRINGS } from "../strings";
import type { useEditorMutation } from "./useEditorMutation";
import type { useFindReplaceState } from "./useFindReplaceState";
import type { useSnapshotState } from "./useSnapshotState";

// Find-and-replace orchestration seam of EditorPage (F-1 decomposition,
// 2026-05-29): the replace-all / replace-one / replace-confirmation flow,
// extracted verbatim from EditorPage so the documented save-pipeline and
// cross-caller busy/lock invariants (16 rounds of review on the snapshots
// /find-and-replace branch) are preserved exactly. The replaceOp network-
// cancellation controller and the slug latest-ref are used only by these
// handlers, so they are allocated here (cohesion). The genuinely shared
// primitives — the single useEditorMutation instance, the cross-caller
// actionBusyRef, the editor-lock predicate/refs, the action banners, and
// the snapshot count/panel handles — are owned by EditorPage and threaded
// in via deps so the "single mutation instance shared by every caller"
// invariant holds.
export interface FindReplaceControllerDeps {
  project: ProjectWithChapters | null;
  slug: string | undefined;
  findReplace: ReturnType<typeof useFindReplaceState>;
  mutation: ReturnType<typeof useEditorMutation>;
  getActiveChapter: () => Chapter | null;
  isActionBusy: () => boolean;
  actionBusyRef: MutableRefObject<boolean>;
  editorLockedMessageRef: MutableRefObject<string | null>;
  applyReloadFailedLock: (bannerMessage: string) => void;
  setActionError: Dispatch<SetStateAction<string | null>>;
  setActionInfo: Dispatch<SetStateAction<string | null>>;
  snapshotPanelRef: ReturnType<typeof useSnapshotState>["snapshotPanelRef"];
  refreshSnapshotCount: () => void;
}

export interface ReplaceConfirmation {
  scope: { type: "project" } | { type: "chapter"; chapter_id: string };
  query: string;
  replacement: string;
  options: { case_sensitive: boolean; whole_word: boolean; regex: boolean };
  totalCount: number;
  chapterCount: number;
  perChapterCount: number;
}

export function useFindReplaceController(deps: FindReplaceControllerDeps) {
  const {
    project,
    slug,
    findReplace,
    mutation,
    getActiveChapter,
    isActionBusy,
    actionBusyRef,
    editorLockedMessageRef,
    applyReloadFailedLock,
    setActionError,
    setActionInfo,
    snapshotPanelRef,
    refreshSnapshotCount,
  } = deps;

  // I6 (review 2026-04-21): latest-ref for slug so finalizeReplaceSuccess
  // reads the CURRENT slug at completion time, not the one captured when
  // the callback was created. Without this, a project rename mid-replace
  // would leave the closure pointing at the old slug — the post-replace
  // findReplace.search call 404s against the stale slug, pinning a
  // searchProjectNotFound error banner next to a successful replace.
  const slugRef = useRef(slug);
  slugRef.current = slug;

  // Frozen snapshot of state at the moment the user clicked "Replace All".
  // This prevents the confirmation copy from drifting if the user edits the
  // panel while the dialog is open.
  const [replaceConfirmation, setReplaceConfirmation] = useState<ReplaceConfirmation | null>(null);

  const finalizeReplaceSuccess = useCallback(
    async ({
      replacedCount,
      reloadFailed,
      lockMessage,
      targetChapterId,
    }: {
      replacedCount: number | null;
      reloadFailed: boolean;
      // Override banner copy (used for the 2xx BAD_JSON "possibly committed"
      // path — C1). Defaults to replaceSucceededReloadFailed when reloadFailed
      // is true and no override is provided.
      lockMessage?: string;
      // I1: chapter id the replace targeted (for chapter-scope and replace-one)
      // OR the active chapter at dispatch (for project-scope). When reloadFailed
      // and the currently-active chapter has drifted away from this target,
      // prefer a dismissible action error over a persistent lock banner pinned
      // to an untouched chapter. Mirrors handleRestoreSnapshot's
      // possibly_committed stale-chapter-switch branch. Omit to preserve legacy
      // unconditional-lock behavior (e.g. paths where no target can be inferred).
      targetChapterId?: string;
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
      //
      // I1: If the active chapter has drifted from the replace target, the
      // lock banner would pin to a chapter the mutation never touched — and
      // the [activeChapter?.id] effect would silently dismiss it on the next
      // chapter switch anyway. Fall through to the dismissible action-error
      // branch below in that case.
      const currentId = targetChapterId !== undefined ? getActiveChapter()?.id : undefined;
      const stale = targetChapterId !== undefined && currentId !== targetChapterId;
      if (reloadFailed && !stale) {
        // I6: applyReloadFailedLock sets banner + safeSetEditable as an
        // invariant pair. In the stage:"reload" path the hook kept the
        // editor setEditable(false) (reloadFailed branch skips the
        // finally's re-enable). In the stage:"mutate" 2xx BAD_JSON path
        // the hook's finally already re-enabled it. The helper call
        // converges both call sites on the same read-only invariant —
        // the banner and the editor state never disagree (C1). The
        // embedded safeSetEditable (I2) prevents a TipTap mid-remount
        // throw from skipping the awaited search refresh below.
        applyReloadFailedLock(lockMessage ?? STRINGS.findReplace.replaceSucceededReloadFailed);
      } else if (reloadFailed && stale) {
        // I1: the target chapter is no longer active. A persistent lock
        // banner here would be misattributed — the user is looking at a
        // different chapter that the replace did not touch. Surface the
        // same copy as a dismissible action error so the signal reaches the
        // user without disabling an unrelated chapter's editor.
        setActionError(lockMessage ?? STRINGS.findReplace.replaceSucceededReloadFailed);
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
    [
      findReplace,
      snapshotPanelRef,
      refreshSnapshotCount,
      getActiveChapter,
      setActionError,
      setActionInfo,
      applyReloadFailedLock,
    ],
  );

  // Shared controller for the find-and-replace flow. executeReplace
  // (replace-all) and handleReplaceOne (replace-one) are mutually
  // exclusive at runtime — both are gated by isActionBusy() — so a
  // single replaceOp is correct: starting either operation aborts any
  // prior in-flight call, and unmount cancels whichever is open.
  // useEditorMutation still owns staleness/locking; replaceOp is the
  // orthogonal network-cancellation layer (per design §2.2 C-10/C-11).
  const replaceOp = useAbortableAsyncOperation();

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
      // I1: capture target chapter id at dispatch. For chapter-scope, the
      // explicit scope chapter; for project-scope, the active chapter at
      // click time (best-effort — project-scope can affect many chapters,
      // but the user's mental model pins the lock banner to whatever they
      // were looking at). finalizeReplaceSuccess uses this to skip the
      // persistent lock when the user has since switched chapters.
      const targetChapterId =
        frozen.scope.type === "chapter" ? frozen.scope.chapter_id : getActiveChapter()?.id;
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
          const { promise } = replaceOp.run((s) =>
            api.search.replace(
              slug,
              frozen.query,
              frozen.replacement,
              frozen.options,
              frozen.scope,
              s,
            ),
          );
          const resp = await promise;
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
            targetChapterId,
          });
          return;
        }
        // stage === "mutate"
        const err = result.error;
        const mapped = mapApiError(err, "findReplace.replace");
        // 2xx BAD_JSON: the server almost certainly committed the replace
        // (and the auto-snapshot) and only the response body was unreadable.
        // Route to the persistent lock UX so the editor stays
        // setEditable(false) until refresh; a retry would double-commit.
        // I5 (2026-04-23): the scope-level mapper already applies the
        // 2xx BAD_JSON predicate — consult possiblyCommitted instead of
        // re-implementing the check inline so future broadening of the
        // predicate propagates to every call site automatically.
        if (mapped.possiblyCommitted) {
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
          // possiblyCommitted implies scope.committed is defined, so
          // mapped.message is a non-null string (replaceResponseUnreadable).
          await finalizeReplaceSuccess({
            replacedCount: null,
            reloadFailed: true,
            lockMessage: mapped.message as string,
            targetChapterId,
          });
          return;
        }
        if (mapped.message) setActionError(mapped.message);
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
      setActionInfo,
      mutation,
      isActionBusy,
      replaceOp,
      actionBusyRef,
      editorLockedMessageRef,
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
          const { promise } = replaceOp.run((s) =>
            api.search.replace(
              slug,
              frozenQuery,
              frozenReplacement,
              frozenOptions,
              {
                type: "chapter",
                chapter_id: chapterId,
                match_index: matchIndex,
              },
              s,
            ),
          );
          const resp = await promise;
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
            // I1 (this review): replace-one always targets chapterId. If the
            // user switched chapters mid-flight, route to dismissible error.
            targetChapterId: chapterId,
          });
          return;
        }
        // stage === "mutate"
        const err = result.error;
        const mapped = mapApiError(err, "findReplace.replace");
        // 2xx BAD_JSON: same C1 branch as executeReplace. The server likely
        // committed the replace-one (and its auto-snapshot) but the response
        // body was unreadable. Lock the editor until refresh so auto-save
        // cannot overwrite a possibly-committed server-side change.
        // I5 (2026-04-23): consult mapped.possiblyCommitted rather than
        // re-implementing the predicate inline — the scope mapper already
        // applies it at apiErrorMapper.ts:31.
        if (mapped.possiblyCommitted) {
          // Replace-one is single-chapter — clear that chapter's cached draft
          // (C1). The mutate callback threw before returning a directive, so
          // the hook's clearAllCachedContent never ran.
          clearCachedContent(chapterId);
          // possiblyCommitted implies scope.committed is defined, so
          // mapped.message is a non-null string (replaceResponseUnreadable).
          await finalizeReplaceSuccess({
            replacedCount: null,
            reloadFailed: true,
            lockMessage: mapped.message as string,
            targetChapterId: chapterId,
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
        // the action banner set by mapApiError is the single source of
        // truth for this click.
        if (isNotFound(err)) {
          await findReplace.search(slug);
          findReplace.clearError();
        }
        if (mapped.message) setActionError(mapped.message);
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
      setActionInfo,
      mutation,
      isActionBusy,
      replaceOp,
      actionBusyRef,
      editorLockedMessageRef,
    ],
  );

  return {
    replaceConfirmation,
    setReplaceConfirmation,
    executeReplace,
    handleReplaceAllInManuscript,
    handleReplaceAllInChapter,
    handleReplaceOne,
  };
}
