import type { MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";

// TipTap can throw synchronously during the brief mid-remount window when
// its editor instance has been destroyed but the ref still holds the old
// handle. The hook (useEditorMutation) wraps its own setEditable calls in
// try/catch for exactly this reason; the four hand-composed call sites in
// EditorPage previously did not, leaving each one a latent unhandled-
// rejection hazard that would skip subsequent banner / cleanup work (I2).
//
// Centralizing here keeps the gate uniform and stops future setEditable
// callers from re-introducing the same hole. The error is logged (not
// silently swallowed) so a TipTap-throw still leaves at least one signal
// in devtools — see useEditorMutation's matching warn for the rationale.
export function safeSetEditable(
  editorRef: MutableRefObject<EditorHandle | null>,
  editable: boolean,
): void {
  try {
    editorRef.current?.setEditable(editable);
  } catch (err) {
    console.warn("safeSetEditable: setEditable threw", err);
  }
}
