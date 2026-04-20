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
//
// Returns true if the setEditable actually applied to a live editor, false
// if either the ref was null (no editor to apply to) or TipTap threw
// during a mid-remount window. Lock-convergence callers (the ones that
// raise the "refresh the page" banner) MUST check the return value and
// escalate on false — without the apply, the editor is left writable (or
// a new editor mounts writable after the throw), and a keystroke auto-
// save can silently revert the server-committed mutation (C1). Callers
// using this opportunistically (re-enable-after-success) can ignore the
// return.
export function safeSetEditable(
  editorRef: MutableRefObject<EditorHandle | null>,
  editable: boolean,
): boolean {
  const current = editorRef.current;
  if (!current) return false;
  try {
    current.setEditable(editable);
    return true;
  } catch (err) {
    console.warn("safeSetEditable: setEditable threw", err);
    return false;
  }
}
