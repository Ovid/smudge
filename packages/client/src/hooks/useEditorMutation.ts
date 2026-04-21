import { useRef, useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import type { UseProjectEditorReturn } from "./useProjectEditor";
import { clearAllCachedContent } from "./useContentCache";

export type MutationStage = "flush" | "mutate" | "reload" | "busy";

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
} & ({ reloadActiveChapter: false } | { reloadActiveChapter: true; reloadChapterId: string });

export type MutationResult<T = void> =
  | { ok: true; data: T }
  // reload: server-side mutation succeeded, but the follow-up GET failed.
  // No `error` field — callers always render a hardcoded strings.ts banner
  // ("refresh the page…") whose wording does not depend on the reload
  // failure's text, and reloadActiveChapter only surfaces
  // STRINGS.error.loadChapterFailed anyway. Keeping it would invite
  // drift between the hook's passed-through message and the banner copy.
  | { ok: false; stage: "reload"; data: T }
  | { ok: false; stage: "flush" | "mutate"; error: unknown }
  | { ok: false; stage: "busy" };

export type UseEditorMutationArgs = {
  editorRef: MutableRefObject<EditorHandle | null>;
  projectEditor: Pick<
    UseProjectEditorReturn,
    "cancelPendingSaves" | "reloadActiveChapter" | "getActiveChapter"
  >;
  // Optional predicate the hook consults before re-enabling the editor in
  // its finally block. When a prior run ended in stage:"reload" the caller
  // (EditorPage) shows a persistent "refresh the page" banner — the editor
  // is deliberately left setEditable(false) so typing can't overwrite the
  // server-committed mutation. Without this gate, the NEXT successful
  // run() would unconditionally setEditable(true) while the banner still
  // claims the editor is locked, inviting data loss (I1). Return true from
  // isLocked() to keep the editor read-only even after a successful run.
  isLocked?: () => boolean;
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

  const isLockedRef = useRef(args.isLocked);
  isLockedRef.current = args.isLocked;

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
      let reloadFailed = false;
      // Track reload *success* too: when a prior run left the editor in the
      // lock state and the current run just successfully re-fetched the
      // server copy via reloadActiveChapter, the lock's premise ("we never
      // showed you the post-mutation server state") no longer holds — the
      // fresh state is now on screen, so the finally should re-enable the
      // editor regardless of isLocked (I2). The caller's useEffect on
      // chapterReloadKey clears the banner in the same render.
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
      // Entry-time editor snapshot — used to detect mid-mutate remounts:
      // if editorAtEntry was null (chapter mid-remount) and a new TipTap
      // instance mounts during the await mutate(), we must re-read the
      // ref and lock that new editor too (I3) — otherwise invariants 1–2
      // silently break for the reload window and a user keystroke could
      // race the reload's auto-save.
      const editor = args.editorRef.current;
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
        // Wrap the synchronous setEditable(false) in its own try/catch so a
        // TipTap mid-remount throw surfaces as a typed stage:"flush" failure
        // rather than rejecting the returned Promise (S4). All call sites
        // `await mutation.run(...)` without a try/catch and rely on the
        // discriminated MutationResult contract — letting the throw escape
        // would produce an unhandled rejection and bypass every caller's
        // stage-specific copy. Attribute to "flush" because a locked editor
        // prevents us from flushing pending changes before the mutation.
        try {
          editor?.setEditable(false);
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
        // during the server round-trip, the new editor starts editable=true
        // by default. Without locking it here, the reload window below
        // leaves a fresh editor writable — a user keystroke in that window
        // would either be lost to the reload or PATCH-ed back over the
        // server commit on the next auto-save. Swallow throws in the same
        // spirit as the entry-side setEditable: a TipTap mid-remount throw
        // here should not discard a server-successful mutate.
        const editorAfterMutate = args.editorRef.current;
        if (editorAfterMutate !== null && editorAfterMutate !== editor) {
          try {
            editorAfterMutate.setEditable(false);
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
            // stage:"reload": the server committed (mutate succeeded), so
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
            console.warn("useEditorMutation: failed to lock mid-remount editor", err);
            if (directive.clearCacheFor.length > 0) {
              clearAllCachedContent(directive.clearCacheFor);
            }
            // I1 (review 2026-04-21): honor the directive when it did not
            // ask for a reload. The re-lock bail previously returned
            // stage:"reload" unconditionally — callers interpret that as
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
              // stage:"reload" so callers raise the persistent lock banner
              // instead. Readers at a chapter OUTSIDE clearCacheFor are
              // unaffected and the ok:true branch still applies.
              const currentId = projectEditorRef.current.getActiveChapter()?.id;
              if (currentId && directive.clearCacheFor.includes(currentId)) {
                reloadFailed = true;
                return {
                  ok: false,
                  stage: "reload",
                  data: directive.data,
                };
              }
              return { ok: true, data: directive.data };
            }
            reloadFailed = true;
            return {
              ok: false,
              stage: "reload",
              data: directive.data,
            };
          }
        }
        if (directive.clearCacheFor.length > 0) {
          clearAllCachedContent(directive.clearCacheFor);
        }
        if (directive.reloadActiveChapter) {
          // Passing a no-op onError is intentional: reloadActiveChapter only
          // emits STRINGS.error.loadChapterFailed, which would never reach
          // the UI (callers render their own banner). Suppressing it here
          // also stops useProjectEditor's fallback-to-setError from firing
          // and flipping EditorPage into the full-screen error branch when
          // we just want the persistent lock banner.
          const outcome = await projectEditorRef.current.reloadActiveChapter(
            () => {},
            directive.reloadChapterId,
          );
          if (outcome === "failed") {
            reloadFailed = true;
            return {
              ok: false,
              stage: "reload",
              data: directive.data,
            };
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
            // stage:"reload" branch so callers raise the persistent lock
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
              const secondOutcome = await projectEditorRef.current.reloadActiveChapter(
                () => {},
                currentId,
              );
              if (secondOutcome === "failed") {
                reloadSuperseded = false;
                reloadFailed = true;
                return {
                  ok: false,
                  stage: "reload",
                  data: directive.data,
                };
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
        // inFlightRef.current = false FIRST, then setEditable(true). If the
        // TipTap instance is mid-remount, setEditable(true) can throw
        // synchronously on the exit side just like it can on entry (see C1).
        // If this throw hit the un-run `inFlightRef.current = false`, the
        // busy latch would stay set for the session and every subsequent
        // mutation would short-circuit as stage:"busy". Order matters.
        inFlightRef.current = false;
        // If a prior run left the editor in the reload-failed lock state,
        // EditorPage's "refresh the page" banner is still showing. Don't
        // re-enable editing here (I1) — the finally would otherwise silently
        // override the lock while the banner claims the editor is read-only,
        // so the next keystroke would PATCH pre-mutation content back over
        // the server-committed change.
        // A successful reload supersedes a stale lock: the banner is about
        // to clear via the caller's chapterReloadKey useEffect, and the
        // editor's displayed content now matches the server (no stale
        // pre-mutation content the user could type over). Without this,
        // the editor would stay setEditable(false) after the banner cleared,
        // leaving the user in an unrecoverable "looks editable but can't
        // type" state until chapter switch (I2).
        // I3 (review 2026-04-20): wrap the predicate call. Today's
        // closure (() => editorLockedMessageRef.current !== null) can't
        // throw, but the public type is () => boolean — a future caller
        // reading flaky state could throw and bypass the discriminated
        // MutationResult contract. Callers `await mutation.run(...)`
        // without try/catch, so an escaping throw would surface as an
        // unhandled rejection. Conservative default on throw: treat as
        // locked, so unknown predicate state can't accidentally unlock
        // an editor over a server-committed change.
        let lockedByCaller: boolean;
        try {
          lockedByCaller =
            isLockedRef.current?.() === true && !reloadSucceeded && !reloadSuperseded;
        } catch (err) {
          // I4 (review 2026-04-21): honor reloadSucceeded / reloadSuperseded
          // even when the predicate throws. An unconditional lockedByCaller=true
          // would leave the editor setEditable(false) AFTER chapterReloadKey
          // had already cleared the lock banner — reproducing the "looks
          // editable but can't type" dead state the flags exist to prevent.
          // Conservative default otherwise: treat as locked so an unknown
          // predicate state can't accidentally unlock an editor over a
          // server-committed change.
          console.warn("useEditorMutation: isLocked predicate threw", err);
          lockedByCaller = !reloadSucceeded && !reloadSuperseded;
        }
        if (!reloadFailed && !lockedByCaller) {
          // Re-read editorRef.current (I3): if the entry-time editor was
          // destroyed mid-run (chapter switch during mutate) its setEditable
          // throws, and the new editor mounts with editable=true by default
          // — no unlock needed. If the editor is the same instance as at
          // entry, this is a no-op change. Either way, target the current
          // editor rather than the captured reference.
          const editorForUnlock = args.editorRef.current;
          try {
            editorForUnlock?.setEditable(true);
          } catch (err) {
            // Swallowing here keeps run()'s happy-path return value intact
            // for the caller. The editor being non-editable after a
            // successful mutation is a degraded but recoverable state —
            // the next remount resets editable=true. Emit a warn so the
            // silent failure leaves at least one signal behind for
            // devtools inspection (I4) — previously the catch was silent
            // and a TipTap mid-remount throw here would leave the editor
            // stuck read-only with no indication anything had happened.
            console.warn("useEditorMutation: failed to re-enable editor", err);
          }
        }
      }
    },
    [args.editorRef],
  );

  const isBusy = useCallback(() => inFlightRef.current, []);

  return useMemo(() => ({ run, isBusy }), [run, isBusy]);
}
