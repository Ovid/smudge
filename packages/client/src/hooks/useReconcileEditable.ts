import { useEffect, type MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import type { EditorMutationState } from "./useEditorMutationMachine";
import { safeSetEditable } from "../utils/editorSafeOps";

/**
 * Reconcile the machine's editable intent into a MOUNTED TipTap instance —
 * the re-enable / re-assert direction. (The lock-down `false` is additionally
 * applied synchronous-imperatively in `useEditorMutation` so input is blocked
 * before the first `await`, and mount-time editability comes from `Editor`'s
 * `editable` prop; see CLAUDE.md §"Machine intent reaches TipTap by two
 * routes".) Reuses `safeSetEditable` so a mid-remount throw is absorbed and
 * logged once.
 *
 * Keyed on the state OBJECT, not on `state.editable` (S2, agentic review
 * 2026-08-18). Three reducer arms — MUTATION_SETTLED_SUPERSEDED, RELOADED,
 * EDITOR_REMOUNTED — all produce `editable: true`, so a dispatch that lands
 * while the machine ALREADY reads `editable: true` moves no primitive, and an
 * effect keyed on the boolean would not re-run.
 *
 * That combination is reachable, not hypothetical. `useEditorMutation` calls
 * `safeSetEditable(editorRef, false)` against a mid-mutation-remounted editor
 * *without* dispatching, so TipTap reads read-only while the machine still
 * reads editable; its `finally` then dispatches MUTATION_SETTLED_SUPERSEDED,
 * which changes no boolean. Keyed on the boolean, that dispatch would never
 * reach TipTap and would strand a chapter the mutation never touched. Every
 * reducer arm returns a fresh object, so keying on the object re-runs this once
 * per dispatch; `safeSetEditable` is idempotent, so the extra applications are
 * free.
 */
export function useReconcileEditable(
  editorRef: MutableRefObject<EditorHandle | null>,
  state: EditorMutationState,
  activeChapterId: string | undefined,
  chapterReloadKey: number,
): void {
  useEffect(() => {
    safeSetEditable(editorRef, state.editable);
  }, [editorRef, state, activeChapterId, chapterReloadKey]);
}
