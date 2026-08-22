import { useRef, useCallback, useMemo, type Dispatch, type MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import type { UseProjectEditorReturn } from "./useProjectEditor";
import type { EditorMutationEvent } from "./useEditorMutationMachine";
import { clearAllCachedContent } from "./useContentCache";
import { safeSetEditable } from "../utils/editorSafeOps";
import { clientWarn } from "../errors";

/** What the seam needs in order to finish the committed-but-unreloaded
 * transition itself instead of handing a half-made state to the caller (F-07).
 *
 * Required, and that is the point. Before F-07's fix the terminal dispatch on
 * this path was a caller obligation carried by a comment, so a new caller that
 * simply ignored the returned MutationResult left the machine at
 * `{editable:false}` with no banner — a read-only editor with nothing on
 * screen to explain it. Making the mutate callback hand over the banner copy
 * and the drift reference point converts that obligation into a compile error.
 */
export type CommittedLockSpec = {
  /** strings.ts copy for the persistent lock banner. Flow-specific (a restore
   * and a replace say different things), so the seam cannot author it. */
  message: string;
  /** The chapter this mutation was ABOUT, captured when the user asked for it.
   * The seam compares it against the live active chapter to decide whether the
   * banner still belongs on screen. Deliberately not derived from
   * `reloadChapterId`: that is the chapter the reload targeted at directive
   * time, which for a project-scope replace can be a chapter the user drifted
   * ONTO mid-flight — pinning a persistent banner there would misattribute it
   * to a chapter the user never started from. Omit only when the mutation has
   * no meaningful target (no chapter open), which reads as "never drifted". */
  targetChapterId?: string;
};

// Discriminated union so the type system forces reloadChapterId whenever
// reloadActiveChapter is true. Without this, a caller that set
// reloadActiveChapter: true without reloadChapterId would arm the
// reload call with an undefined expected chapter id — the hook's
// mismatch guard (current.id !== expectedChapterId) only fires when
// expectedChapterId !== undefined, so the reload would unconditionally
// wipe the active chapter's draft even if the user switched chapters
// between directive-return and the hook's reload call (I2). Making
// the shape discriminated moves the constraint from caller discipline
// to construction.
export type MutationDirective<T = void> = {
  clearCacheFor: string[];
  data: T;
  committedLock: CommittedLockSpec;
} & ({ reloadActiveChapter: false } | { reloadActiveChapter: true; reloadChapterId: string });

export type MutationResult<T = void> =
  | { ok: true; data: T }
  // committed_but_unreloaded: server-side mutation committed but the client
  // cannot confirm what is on screen (follow-up GET failed, or race-only
  // supersession). Subsumes the former stage:"reload". No `error` field —
  // callers always render a hardcoded strings.ts banner whose wording does not
  // depend on any failure text, so keeping an error here would only invite
  // drift between the hook's passed-through message and the banner copy.
  //
  // `drifted` reports the decision the seam ALREADY acted on when it dispatched
  // (F-07): true means the user is no longer on the chapter this mutation was
  // about, so the seam re-enabled the editor and the caller should surface a
  // dismissible, chapter-attributed notice; false means the seam raised the
  // persistent lock. Callers read it rather than recomputing the comparison, so
  // the copy they choose cannot contradict the state the machine is in.
  | { ok: false; stage: "committed_but_unreloaded"; data: T; drifted: boolean }
  // flush and mutate are split into separate members (rather than a single
  // stage:"flush" | "mutate" member) so that each consumer's stage-discriminated
  // if-chain narrows the residual to `never` for the exhaustive `_exhaustive`
  // guard. A combined-discriminant member does not subtract cleanly across
  // sequential `=== "flush"` / `=== "mutate"` returns.
  | { ok: false; stage: "flush"; error: unknown }
  | { ok: false; stage: "mutate"; error: unknown }
  | { ok: false; stage: "busy" };

export type UseEditorMutationArgs = {
  editorRef: MutableRefObject<EditorHandle | null>;
  projectEditor: Pick<
    UseProjectEditorReturn,
    "cancelPendingSaves" | "reloadActiveChapter" | "getActiveChapter"
  >;
  /** Editor-state machine dispatch (EditorPage owns the machine). The hook
   * emits MUTATION_STARTED at entry and exactly one terminal event on settle,
   * on every path (F-07): MUTATION_SETTLED_OK / _SUPERSEDED / RELOADED, or —
   * on the committed-but-unreloaded path — COMMITTED_UNRELOADED with the copy
   * the mutate callback supplied, or MUTATION_SETTLED_SUPERSEDED when the user
   * has drifted off the chapter the mutation was about. Consumers never need to
   * complete a transition themselves. */
  dispatch: Dispatch<EditorMutationEvent>;
};

export type UseEditorMutationReturn = {
  run: <T>(mutate: () => Promise<MutationDirective<T>>) => Promise<MutationResult<T>>;
  // Read-only synchronous probe used by external flushSave entry points
  // (chapter switch, snapshot view, snapshot create) to refuse hand-composed
  // setEditable/flushSave/cancelPendingSaves sequences while a mutation is
  // mid-flight (I2). Without this, the hook's busy guard only protects
  // run()-routed callers — external callers could still race the in-flight
  // mutation by aborting its save controller or re-enabling the editor.
  isBusy: () => boolean;
};

export function useEditorMutation(args: UseEditorMutationArgs): UseEditorMutationReturn {
  // Assign the latest-ref during render (matches useKeyboardShortcuts.ts).
  // A useEffect update would leave a commit-window where `run()` dispatched
  // from a freshly-rendered handler could still see the prior identities of
  // cancelPendingSaves/reloadActiveChapter.
  const projectEditorRef = useRef(args.projectEditor);
  projectEditorRef.current = args.projectEditor;

  // dispatch (from EditorPage's useReducer) and editorRef are both stable
  // identities; destructured here so the run() useCallback dep array is plain
  // identifiers (the react-hooks rule otherwise asks for the whole `args`).
  const { editorRef, dispatch } = args;

  const inFlightRef = useRef(false);

  const run = useCallback(
    async <T>(mutate: () => Promise<MutationDirective<T>>): Promise<MutationResult<T>> => {
      if (inFlightRef.current) {
        return { ok: false, stage: "busy" };
      }
      // Track the reload-failure path explicitly: we must NOT re-enable the
      // editor in that case. By the time reload fails, markClean() has run
      // and the cache has been cleared, but the TipTap document still shows
      // the pre-mutation content. Re-enabling would let the user type over
      // stale content, whose auto-save PATCH would silently revert the
      // server-side replace/restore. Keep the editor read-only and surface
      // a banner directing the user to refresh.
      //
      // F-07: set by committed() below, and the sole record of the committed
      // path having been taken. Holds the drift verdict and the banner copy so
      // the finally's dispatch and the value handed back to the caller are
      // decided in one place and cannot disagree.
      // Held in an object rather than a bare `let` so the finally can narrow it:
      // committed() assigns from inside a closure, which TypeScript's
      // control-flow analysis does not follow for a plain local.
      const committedOutcome: { value: { drifted: boolean; message: string } | null } = {
        value: null,
      };
      // Track reload *success* too: when a prior run left the editor in the
      // lock state and the current run just successfully re-fetched the
      // server copy via reloadActiveChapter, the lock's premise ("we never
      // showed you the post-mutation server state") no longer holds — the
      // fresh state is now on screen, so the finally dispatches RELOADED,
      // whose reducer transition clears the lock and re-enables (I2). The
      // caller's useEffect on chapterReloadKey clears the banner in the
      // same render.
      let reloadSucceeded = false;
      // I1 (review 2026-04-20): when reloadActiveChapter returns
      // "superseded", the user switched chapters (or the chapter
      // vanished) between the directive returning and the reload
      // firing. Any pre-existing lock banner was scoped to the PRIOR
      // chapter — it doesn't apply to whichever chapter is active
      // now. Honoring the lock here would leave the new, unrelated
      // editor read-only while EditorPage's useEffect on activeChapter
      // clears the banner, producing a "looks editable but can't type"
      // dead state the user can't recover from without another chapter
      // switch or refresh. Track explicitly so the finally can bypass
      // the lock gate — distinct from reloadSucceeded because we did
      // NOT refresh the displayed content, so the "lock's premise no
      // longer holds" semantics are different: on superseded the
      // premise was always about a different chapter.
      let reloadSuperseded = false;
      /**
       * Is the chapter the user is looking at RIGHT NOW one this mutation
       * changed? (I1, agentic review 2026-08-21.)
       *
       * `clearCacheFor` is the mutation's own list of chapters it wrote to, so
       * membership means two things at once: that chapter's draft cache has
       * been wiped, and its on-screen content predates the server commit unless
       * a confirming GET refreshed it. Both make it unsafe to type into.
       *
       * Read live rather than captured — every caller sits after an await, and
       * the user may have moved again since the last read.
       */
      const activeChapterIsAffected = (d: MutationDirective<T>): boolean => {
        const currentId = projectEditorRef.current.getActiveChapter()?.id;
        return currentId !== undefined && d.clearCacheFor.includes(currentId);
      };
      /**
       * Take the committed-but-unreloaded path (F-07).
       *
       * The server mutation landed but the client cannot vouch for what is on
       * screen. Whether that warrants the persistent lock depends on where the
       * user actually is now: if they have drifted to a different chapter, a
       * non-dismissible banner would pin to a chapter this mutation was never
       * about, and — because MUTATION_STARTED already set editable:false —
       * skipping the lock without re-enabling would strand that unrelated
       * editor read-only with nothing to explain it. That pairing is the OOSI1
       * and OOSS1 defects, and it is why the drift verdict is computed here
       * rather than left to each caller.
       *
       * A mutation with no target chapter, or a user with no chapter open at
       * all, reads as "not drifted": there is no unrelated editor to strand,
       * and the banner is the honest signal that a refresh is needed.
       *
       * I1: drifting off the target is necessary but NOT sufficient. Drift only
       * makes the editor safe when the chapter drifted ONTO is one this
       * mutation left alone — hence `!activeChapterIsAffected`. A project-scope
       * replace hitting A and B, with the user switching A→B mid-flight and B's
       * confirming GET failing, is drift onto an affected chapter: B's cache is
       * gone, B's post-replace text was never fetched, and re-enabling there
       * lets the next auto-save PATCH pre-replace content over the commit. That
       * omission also silently neutralized both escalation sites below, whose
       * whole entry condition is membership in `clearCacheFor`.
       */
      const committed = (d: MutationDirective<T>): MutationResult<T> => {
        const currentId = projectEditorRef.current.getActiveChapter()?.id;
        const drifted =
          d.committedLock.targetChapterId !== undefined &&
          currentId !== undefined &&
          currentId !== d.committedLock.targetChapterId &&
          !activeChapterIsAffected(d);
        committedOutcome.value = { drifted, message: d.committedLock.message };
        return { ok: false, stage: "committed_but_unreloaded", data: d.data, drifted };
      };
      // Entry-time editor snapshot — used to detect mid-mutate remounts:
      // if editorAtEntry was null (chapter mid-remount) and a new TipTap
      // instance mounts during the await mutate(), we must re-read the
      // ref and lock that new editor too (I3) — otherwise invariants 1–2
      // silently break for the reload window and a user keystroke could
      // race the reload's auto-save.
      const editor = editorRef.current;
      // Null-editor is a deliberate graceful-no-op contract, covered by the
      // "null editor ref" test below: invariants 1–2 (markClean,
      // setEditable(false)) are vacuously satisfied when there is no editor
      // on screen, so the hook proceeds with cancelPendingSaves + mutate +
      // cache-clear + reload. Do not tighten this to a stage:"flush"
      // return without also revising the existing test + any callers that
      // rely on the current behavior.
      // Setting inFlightRef and setEditable inside the try ensures the
      // finally clears inFlightRef even if setEditable throws synchronously
      // (e.g. TipTap mid-remount). Otherwise the busy guard latches for the
      // rest of the session.
      try {
        inFlightRef.current = true;
        dispatch({ type: "MUTATION_STARTED" });
        // S2 (review 2026-04-21): cancelPendingSaves BEFORE the first
        // setEditable. Any pre-existing save in backoff from prior
        // keystrokes must be aborted before we commit to the mutation
        // — if the synchronous entry setEditable(false) throws on a
        // TipTap mid-remount and returns stage:"flush" below, the
        // cancelPendingSaves further down (line ~168) never runs and
        // the backoff save fires seconds later, committing pre-mutation
        // content while the caller banner already says the mutation
        // failed. cancelPendingSaves is a ref+setState touch, idempotent
        // and cannot throw, so running it first is safe. Guard it
        // anyway so a future refactor that introduces a throw cannot
        // short-circuit the locking sequence.
        try {
          projectEditorRef.current.cancelPendingSaves();
        } catch (error) {
          return { ok: false, stage: "flush", error };
        }
        // Synchronous lock-down before the first await. Routed through
        // safeSetEditable, which absorbs a TipTap mid-remount throw internally
        // (logs + returns false) — so the surrounding try/catch is now
        // belt-and-suspenders: on a swallowed throw the run PROCEEDS rather
        // than bailing to stage:"flush" (the catch is effectively unreachable
        // today, retained only in case a future safeSetEditable rethrows, to
        // preserve the no-unhandled-rejection MutationResult contract). The
        // data-loss backstop when the lock-down silently fails is EditorPage's
        // handleSaveLockGated, which no-ops any auto-save PATCH while the lock
        // banner is up (see editorSafeOps.ts rationale).
        try {
          safeSetEditable(editorRef, false);
        } catch (error) {
          return { ok: false, stage: "flush", error };
        }
        try {
          const flushed = await editor?.flushSave();
          if (flushed === false) {
            return {
              ok: false,
              stage: "flush",
              error: new Error("flushSave returned false"),
            };
          }
        } catch (error) {
          return { ok: false, stage: "flush", error };
        }
        // I1: Wrap in try/catch matching the surrounding setEditable /
        // flushSave discipline. Today these implementations are safe
        // (cancelPendingSaves is a ref+setState; markClean is a ref+timer
        // touch), but a future TipTap upgrade or useProjectEditor refactor
        // could reintroduce a synchronous throw — without the wrap, the
        // throw propagates as an unhandled rejection, bypassing every
        // caller's stage-routing contract (no banner, no editor-state
        // cleanup except the finally). Attribute to "flush" because both
        // operations are part of the pre-mutate "settle pending writes"
        // phase, conceptually adjacent to flushSave.
        //
        // cancelPendingSaves repeats here (also called at the top under
        // S2) because flushSave itself creates a new save attempt; this
        // second call ensures no retries are scheduled between the flush
        // resolving and the mutate firing.
        try {
          projectEditorRef.current.cancelPendingSaves();
          editor?.markClean();
        } catch (error) {
          return { ok: false, stage: "flush", error };
        }
        let directive: MutationDirective<T>;
        try {
          directive = await mutate();
        } catch (error) {
          return { ok: false, stage: "mutate", error };
        }
        // Re-read the editor ref after the mutate await (I3). If the entry-
        // time editor was null (mid-remount) and TipTap finished mounting
        // during the server round-trip, this block locks and quiesces the
        // new instance.
        //
        // DO NOT DELETE THIS AS DEAD (I2, review 2026-08-18). Since F-36 a
        // fresh Editor inherits machine intent through its `editable` prop,
        // and MUTATION_STARTED is dispatched synchronously at run() entry
        // (above), so a mid-mutate remount usually constructs read-only
        // already — reading only the setEditable line, this looks redundant.
        // It is not:
        //   1. The prop carries whatever intent React has COMMITTED. A mount
        //      whose render was already in flight when MUTATION_STARTED was
        //      dispatched still comes up writable, so the imperative lock
        //      remains the backstop for that window.
        //   2. markClean() + cancelPendingSaves() below are the real payload
        //      and have no prop equivalent (I6). They kill the fresh
        //      instance's fire-and-forget unmount PATCH, which would
        //      otherwise revert the just-committed server mutation.
        // Swallow throws in the same spirit as the entry-side setEditable: a
        // TipTap mid-remount throw here should not discard a
        // server-successful mutate.
        const editorAfterMutate = editorRef.current;
        if (editorAfterMutate !== null && editorAfterMutate !== editor) {
          try {
            safeSetEditable(editorRef, false);
            // I6: Mid-mutate remount was locked but not markClean-ed. A
            // keystroke landing in the mount→lock window sets dirtyRef=true
            // on the fresh editor; when it later unmounts, Editor's cleanup
            // fires a fire-and-forget PATCH with stale pre-reload content,
            // silently reverting the just-committed server mutation. Mark
            // the new editor clean and re-cancel any pending save that may
            // have been scheduled in that window to close the race.
            editorAfterMutate.markClean();
            projectEditorRef.current.cancelPendingSaves();
          } catch (err) {
            // I1: Previously we logged and fell through to clearAllCachedContent
            // + reloadActiveChapter on the assumption the re-lock worked.
            // If setEditable/markClean/cancelPendingSaves actually throws,
            // the fresh editor is left writable — user keystrokes during
            // the reload-GET window would PATCH pre-mutation content back
            // over the just-committed server change. Promote to
            // stage:"committed_but_unreloaded": the server committed (mutate succeeded), so
            // the caller surfaces the persistent "refresh the page" lock
            // and EditorPage's handleSaveLockGated (C1) refuses any PATCH
            // while the banner is up.
            //
            // C1 (review 2026-04-20): the cache-clear MUST still run
            // before the bail. The server committed the mutation; if we
            // skip the cache-clear and the user refreshes (which the
            // lock banner explicitly directs them to do), localStorage
            // re-hydrates pre-mutation drafts and the first keystroke
            // PATCHes stale content back over the server commit. Skip
            // only the reload — we can't safely load fresh server state
            // into an editor we couldn't re-lock.
            //
            // S1 (review 2026-04-21): cancelPendingSaves in the catch.
            // If setEditable(false) threw before the try-block's
            // cancelPendingSaves ran, a keystroke scheduled on the
            // fresh editor during the mount→throw window still holds
            // a live debounced save. Without this re-cancel it fires
            // seconds later and commits pre-mutation content over the
            // server change, contradicting the lock banner. Wrap in
            // its own try/catch so a cancelPendingSaves throw cannot
            // mask the original setEditable/markClean error.
            clientWarn("useEditorMutation: failed to lock mid-remount editor", err);
            try {
              projectEditorRef.current.cancelPendingSaves();
            } catch (cancelErr) {
              clientWarn(
                "useEditorMutation: cancelPendingSaves threw during re-lock-fail catch",
                cancelErr,
              );
            }
            if (directive.clearCacheFor.length > 0) {
              clearAllCachedContent(directive.clearCacheFor);
            }
            // I1 (review 2026-04-21): honor the directive when it did not
            // ask for a reload. The re-lock bail previously returned
            // stage:"committed_but_unreloaded" unconditionally — callers interpret that as
            // "server committed, follow-up GET failed" and unconditionally
            // raise a persistent lock banner + cache-wipe + editor lock
            // on the NEW editor (which may be an unrelated chapter, e.g.
            // stale-chapter-switch restore or 0-replace). When the
            // directive's reloadActiveChapter is false, the mutation
            // intentionally signaled "no GET needed" — either because
            // nothing was reloadable (0 replace_count) or because the
            // target is no longer the active chapter. In both cases the
            // lock banner + cache-wipe would fire against the wrong
            // chapter. Surface success instead; the cache for affected
            // chapters has been cleared, and the new editor's own chapter
            // is untouched by the mutation so leaving it writable is
            // correct.
            if (!directive.reloadActiveChapter) {
              // I5 (review 2026-04-21): if the now-active chapter was ALSO
              // in clearCacheFor (typical when a chapter switch during the
              // mutation landed on a different affected chapter), returning
              // ok:true leaves the user with a writable editor whose
              // displayed content may be pre-mutation — the cache was
              // cleared, but the on-screen draft is whatever
              // handleSelectChapter's GET loaded, which could have raced the
              // server-side commit. The very next keystroke PATCHes stale
              // content over the server-committed mutation. Escalate to
              // stage:"committed_but_unreloaded" so callers raise the persistent lock banner
              // instead. Readers at a chapter OUTSIDE clearCacheFor are
              // unaffected and the ok:true branch still applies.
              const currentId = projectEditorRef.current.getActiveChapter()?.id;
              if (currentId && directive.clearCacheFor.includes(currentId)) {
                return committed(directive);
              }
              return { ok: true, data: directive.data };
            }
            return committed(directive);
          }
        }
        if (directive.clearCacheFor.length > 0) {
          clearAllCachedContent(directive.clearCacheFor);
        }
        // S5 (review 2026-04-21): re-read the editor ref one more time
        // before the reload. The post-mutate re-read above can miss
        // the unmount-between-mutate-and-reload window — entry editor
        // unmounts during mutate, editorAfterMutate is null so the
        // re-lock is skipped, and a fresh TipTap mounts during the
        // cache-clear step with editable=true. Without this second
        // re-read, a keystroke lands in the reload-GET window and
        // PATCHes pre-reload content back over the server change.
        // Only fires when editorAfterMutate was null (otherwise the
        // above block has already done the lock).
        if (editorAfterMutate === null) {
          const lateMounted = editorRef.current;
          if (lateMounted !== null) {
            try {
              safeSetEditable(editorRef, false);
              lateMounted.markClean();
              projectEditorRef.current.cancelPendingSaves();
            } catch (err) {
              // Match the main re-lock-fail catch's discipline: server
              // already committed, so on failure promote to stage:
              // "committed_but_unreloaded" (or ok:true when directive said no reload),
              // exactly as the post-mutate re-lock catch does above.
              // Inlined here because we've already passed the cache-
              // clear step — duplicating is simpler than threading
              // the state back through the main catch.
              clientWarn("useEditorMutation: failed to lock late-mounted editor (S5)", err);
              try {
                projectEditorRef.current.cancelPendingSaves();
              } catch (cancelErr) {
                clientWarn(
                  "useEditorMutation: cancelPendingSaves threw during S5 late-lock catch",
                  cancelErr,
                );
              }
              if (!directive.reloadActiveChapter) {
                return { ok: true, data: directive.data };
              }
              return committed(directive);
            }
          }
        }
        if (directive.reloadActiveChapter) {
          // Passing a no-op onError is intentional: reloadActiveChapter only
          // emits STRINGS.error.loadChapterFailed, which would never reach
          // the UI (callers render their own banner). Suppressing it here
          // also stops useProjectEditor's fallback-to-setError from firing
          // and flipping EditorPage into the full-screen error branch when
          // we just want the persistent lock banner.
          //
          // S4 (review 2026-04-21): wrap in try/catch matching the
          // surrounding setEditable/flushSave/cancelPendingSaves
          // discipline. Today reloadActiveChapter catches internally and
          // surfaces "failed" through its ReloadOutcome return type, but
          // a future refactor that introduces a throw would escape as
          // an unhandled rejection — bypassing the MutationResult
          // contract (callers `await mutation.run(...)` without
          // try/catch). Treat a throw the same as the "failed" outcome:
          // set reloadFailed and return stage:"committed_but_unreloaded" so the caller
          // raises the persistent lock banner.
          let outcome: Awaited<ReturnType<typeof projectEditorRef.current.reloadActiveChapter>>;
          try {
            outcome = await projectEditorRef.current.reloadActiveChapter(
              () => {},
              directive.reloadChapterId,
            );
          } catch (err) {
            clientWarn("useEditorMutation: reloadActiveChapter threw", err);
            return committed(directive);
          }
          if (outcome === "failed") {
            return committed(directive);
          }
          // "reloaded": fresh server state is on screen — set the unlock
          // flag so a prior lock can clear.
          // "superseded": the user switched chapters (or the call was gated
          // out by expectedChapterId) before the reload ran. The mutation
          // itself still committed server-side, so don't raise a lock
          // banner (I5). Track separately from reloadSucceeded because
          // the displayed chapter's content wasn't refreshed — but the
          // finally still bypasses the caller's lock gate (I1, review
          // 2026-04-20): any pre-existing lock was scoped to the PRIOR
          // chapter, so leaving the unrelated new editor read-only
          // produces a "no banner, can't type" dead state once
          // EditorPage's useEffect clears the banner on chapter change.
          if (outcome === "reloaded") {
            reloadSucceeded = true;
          } else if (outcome === "superseded") {
            reloadSuperseded = true;
            // I3 (review 2026-04-21): supersession means the user switched
            // to a different chapter than reloadChapterId while the
            // mutation was in flight. If the new active chapter was ALSO
            // in this mutation's clearCacheFor (typical case: project-
            // scope replace affecting multiple chapters), handleSelectChapter's
            // GET could have raced the mutation's POST and landed pre-
            // mutation content on screen. With reloadSuperseded set, the
            // finally re-enables the editor, so the very next keystroke
            // would PATCH stale content back over the server-committed
            // change. Re-run the reload without an expectedChapterId so it
            // targets whatever is currently active — a fresh GET pulls the
            // post-mutation content. On failure, fall through to the
            // stage:"committed_but_unreloaded" branch so callers raise the persistent lock
            // banner.
            const currentId = projectEditorRef.current.getActiveChapter()?.id;
            if (currentId && directive.clearCacheFor.includes(currentId)) {
              // I3 (review 2026-04-21): pass currentId as expectedChapterId.
              // Without it, a further chapter switch during this second reload
              // lets a failed fetch land against a third chapter — the hook
              // then sets reloadFailed=true and raises a persistent lock
              // banner on a chapter the mutation never targeted, wiping
              // unrelated local draft state on refresh. With the guard, a
              // further switch returns "superseded" (benign) instead.
              //
              // S4 (review 2026-04-21): wrapped in try/catch for the same
              // reason as the first reload call above — a future refactor
              // that escapes a throw past ReloadOutcome would bypass the
              // MutationResult contract.
              let secondOutcome: Awaited<
                ReturnType<typeof projectEditorRef.current.reloadActiveChapter>
              >;
              try {
                secondOutcome = await projectEditorRef.current.reloadActiveChapter(
                  () => {},
                  currentId,
                );
              } catch (err) {
                clientWarn("useEditorMutation: second reloadActiveChapter threw", err);
                reloadSuperseded = false;
                return committed(directive);
              }
              if (secondOutcome === "failed") {
                reloadSuperseded = false;
                return committed(directive);
              }
              if (secondOutcome === "reloaded") {
                // Fresh content is on screen; prefer the "success" unlock
                // semantics over the superseded "unrelated chapter" semantics.
                reloadSucceeded = true;
              }
              // "superseded" second time: another chapter switch happened,
              // and the newly-active chapter wasn't necessarily affected.
              // Fall through — reloadSuperseded remains true. If the user
              // landed on yet another affected chapter, they'll hit the
              // same race on the NEXT keystroke, which is as rare as this
              // branch and is the same cost as the original I3 window.
            }
          }
        }
        return { ok: true, data: directive.data };
      } finally {
        // Release the synchronous re-entrancy latch FIRST (order matters: a
        // throw must not leave the latch set for the session).
        inFlightRef.current = false;
        // Terminal machine event — EVERY path settles the machine here, with no
        // residual obligation on the caller (F-07). The re-enable is machine
        // intent reconciled by EditorPage's effect, not an imperative
        // setEditable(true) (Decided Q3).
        //
        // The committed path used to dispatch nothing at all and leave the
        // consumer to finish the transition, which is the flaw F-07 records: a
        // caller that ignored the returned MutationResult stranded the editor
        // at editable:false with no banner. Consumers still own their copy and
        // their refreshes — they just no longer own the machine.
        const outcome = committedOutcome.value;
        if (outcome !== null) {
          if (outcome.drifted) {
            // The user moved to a chapter this mutation was not about. Same
            // terminal state as a supersession the hook detects itself: the
            // drifted chapter was loaded after the server commit, so it is safe
            // to type in, and a persistent banner pinned there would name the
            // wrong chapter (OOSI1 / OOSS1).
            dispatch({ type: "MUTATION_SETTLED_SUPERSEDED" });
          } else {
            dispatch({ type: "COMMITTED_UNRELOADED", message: outcome.message });
          }
        } else if (reloadSucceeded) {
          dispatch({ type: "RELOADED" });
        } else if (reloadSuperseded) {
          dispatch({ type: "MUTATION_SETTLED_SUPERSEDED" });
        } else {
          // happy ok:true, or flush/mutate failure: re-enable unless locked
          // (the reducer applies editable:(lock===null)).
          dispatch({ type: "MUTATION_SETTLED_OK" });
        }
      }
    },
    [editorRef, dispatch],
  );

  const isBusy = useCallback(() => inFlightRef.current, []);

  return useMemo(() => ({ run, isBusy }), [run, isBusy]);
}
