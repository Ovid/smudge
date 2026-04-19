import { useRef, useEffect, useCallback, type MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import type { useProjectEditor } from "./useProjectEditor";
import { clearAllCachedContent } from "./useContentCache";

export type MutationStage = "flush" | "mutate" | "reload" | "busy";

export type MutationDirective<T = void> = {
  clearCacheFor: string[];
  reloadActiveChapter: boolean;
  data: T;
};

export type MutationResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; stage: "reload"; data: T; error?: unknown }
  | { ok: false; stage: "flush" | "mutate" | "busy"; error?: unknown };

export type UseEditorMutationArgs = {
  editorRef: MutableRefObject<EditorHandle | null>;
  projectEditor: Pick<
    ReturnType<typeof useProjectEditor>,
    "cancelPendingSaves" | "reloadActiveChapter"
  >;
};

export type UseEditorMutationReturn = {
  run: <T>(
    mutate: () => Promise<MutationDirective<T>>,
  ) => Promise<MutationResult<T>>;
};

export function useEditorMutation(
  args: UseEditorMutationArgs,
): UseEditorMutationReturn {
  const projectEditorRef = useRef(args.projectEditor);
  useEffect(() => {
    projectEditorRef.current = args.projectEditor;
  });

  const inFlightRef = useRef(false);

  const run = useCallback(
    async <T,>(
      mutate: () => Promise<MutationDirective<T>>,
    ): Promise<MutationResult<T>> => {
      if (inFlightRef.current) {
        return { ok: false, stage: "busy" };
      }
      inFlightRef.current = true;
      const editor = args.editorRef.current;
      editor?.setEditable(false);
      try {
        try {
          await editor?.flushSave();
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
          const ok = await projectEditorRef.current.reloadActiveChapter(
            (msg) => {
              reloadMessage = msg;
            },
          );
          if (!ok) {
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
        editor?.setEditable(true);
        inFlightRef.current = false;
      }
    },
    [args.editorRef],
  );

  return { run };
}
