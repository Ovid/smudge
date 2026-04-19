import { useRef, useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import type { useProjectEditor } from "./useProjectEditor";
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
  | { ok: false; stage: "reload"; data: T; error?: string }
  | { ok: false; stage: "flush" | "mutate"; error: unknown }
  | { ok: false; stage: "busy" };

export type UseEditorMutationArgs = {
  editorRef: MutableRefObject<EditorHandle | null>;
  projectEditor: Pick<
    ReturnType<typeof useProjectEditor>,
    "cancelPendingSaves" | "reloadActiveChapter"
  >;
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
      const editor = args.editorRef.current;
      // Setting inFlightRef and setEditable inside the try ensures the
      // finally clears inFlightRef even if setEditable throws synchronously
      // (e.g. TipTap mid-remount). Otherwise the busy guard latches for the
      // rest of the session.
      try {
        inFlightRef.current = true;
        editor?.setEditable(false);
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
          let reloadMessage: string | undefined;
          const ok = await projectEditorRef.current.reloadActiveChapter((msg) => {
            reloadMessage = msg;
          }, directive.reloadChapterId);
          if (!ok) {
            reloadFailed = true;
            return {
              ok: false,
              stage: "reload",
              data: directive.data,
              error: reloadMessage,
            };
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
        if (!reloadFailed) {
          try {
            editor?.setEditable(true);
          } catch {
            // Swallowing here keeps run()'s happy-path return value intact
            // for the caller. The editor being non-editable after a
            // successful mutation is a degraded but recoverable state —
            // the next remount resets editable=true.
          }
        }
      }
    },
    [args.editorRef],
  );

  const isBusy = useCallback(() => inFlightRef.current, []);

  return useMemo(() => ({ run, isBusy }), [run, isBusy]);
}
