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
// during a mid-remount window.
//
// GH review 2026-04-20: an earlier revision of this comment claimed
// lock-convergence callers MUST check the boolean return and escalate on
// false. In practice they don't — and don't need to — because the real
// data-loss defense is EditorPage's handleSaveLockGated (see
// EditorPage.tsx around `editorLockedMessageRef.current !== null`): once
// the lock banner is up, every auto-save PATCH is short-circuited to a
// no-op regardless of the editor's setEditable state. That gate is what
// prevents the "editor left writable after a mid-remount throw → first
// keystroke PATCHes stale content" path from turning into actual
// data loss. Callers therefore can and do ignore the boolean; the
// internal console.warn is the signal of record. Treat the return value
// as informational only — useful if a caller wants to branch on whether
// the editor actually accepted the change, but not a contract obligation.
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
