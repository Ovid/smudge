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

  const run = useCallback(async <T,>(): Promise<MutationResult<T>> => {
    throw new Error("not implemented");
  }, []);

  // Suppress unused variable until later tasks wire it in.
  void args.editorRef;
  void clearAllCachedContent;

  return { run };
}
