import { useRef, useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import type { UseProjectEditorReturn } from "./useProjectEditor";
import { clearAllCachedContent } from "./useContentCache";

export type MutationStage = "flush" | "mutate" | "reload" | "busy";

export type MutationDirective<T = void> = {
  clearCacheFor: string[];
  reloadActiveChapter: boolean;
  // Optional: the chapter id the caller expects to reload. If the user
  // switched chapters between the mutate callback returning and the hook
  // invoking reloadActiveChapter, the reload is skipped — otherwise we
  // would clear the now-active (unrelated) chapter's cache and pull its
  // server copy, wiping an in-progress draft (I2).
  reloadChapterId?: string;
  data: T;
};

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
  projectEditor: Pick<UseProjectEditorReturn, "cancelPendingSaves" | "reloadActiveChapter">;
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
      const editor = args.editorRef.current;
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
        projectEditorRef.current.cancelPendingSaves();
        editor?.markClean();
        let directive: MutationDirective<T>;
        try {
          directive = await mutate();
        } catch (error) {
          return { ok: false, stage: "mutate", error };
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
          const ok = await projectEditorRef.current.reloadActiveChapter(
            () => {},
            directive.reloadChapterId,
          );
          if (!ok) {
            reloadFailed = true;
            return {
              ok: false,
              stage: "reload",
              data: directive.data,
            };
          }
          reloadSucceeded = true;
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
        const lockedByCaller = isLockedRef.current?.() === true && !reloadSucceeded;
        if (!reloadFailed && !lockedByCaller) {
          try {
            editor?.setEditable(true);
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
