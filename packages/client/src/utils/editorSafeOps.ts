import type { MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import { clientWarn } from "../errors";

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
// EditorPage.tsx around `editorMachine.isLocked()`): once
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
    clientWarn("safeSetEditable: setEditable threw", err);
    return false;
  }
}

export interface QuiesceEditorOptions {
  /**
   * Disable the editor (via {@link safeSetEditable}) BEFORE flushing, and
   * re-enable it if the flush fails. Use when the editor stays mounted and
   * must not accept keystrokes during the round trip (onView). Omit when the
   * caller captures current content and does not overwrite the editor
   * (onBeforeCreate — snapshot create reads the live content).
   */
  disableEditor?: boolean;
  /**
   * Call `editorRef.current.markClean()` after a successful flush + cancel,
   * clearing the dirty flag and debounce timer so a keystroke landing between
   * flush and the server op cannot schedule a racing PATCH (onBeforeCreate).
   */
  markCleanAfter?: boolean;
}

/**
 * Quiet the editor before a non-content-mutating server interaction (snapshot
 * view, snapshot create) by applying the load-bearing save-pipeline ordering
 * ONCE (F-7):
 *
 *   [disable] -> flushSave -> (flush failed? [re-enable] and bail) ->
 *   cancelPendingSaves -> [markClean]
 *
 * This is the same ordering `useEditorMutation` enforces by construction for
 * content-MUTATING flows; CLAUDE.md sanctions these view/create handlers as
 * outside that hook's scope (they do not overwrite editor content), so the
 * ordering lives here as a shared helper rather than being hand-composed at
 * each call site (where a future edit could silently desync it).
 *
 * `flushSave` returning `undefined` (null editor ref) is treated as flushed
 * (`?? true`), matching the prior hand-composed behavior. All `setEditable`
 * calls route through `safeSetEditable`, so a TipTap mid-remount throw is
 * absorbed and logged rather than rejecting the caller's promise.
 *
 * @returns `true` if the flush succeeded and the editor is quiesced (the
 * caller may proceed with the server op); `false` if the flush failed (the
 * caller must bail — the editor has been re-enabled when `disableEditor`).
 */
export async function quiesceEditorForServerOp(
  editorRef: MutableRefObject<EditorHandle | null>,
  cancelPendingSaves: () => void,
  opts: QuiesceEditorOptions = {},
): Promise<boolean> {
  if (opts.disableEditor) {
    safeSetEditable(editorRef, false);
  }

  const flushed = (await editorRef.current?.flushSave()) ?? true;
  if (!flushed) {
    // Re-enable so the user can retry — the op was refused.
    if (opts.disableEditor) {
      safeSetEditable(editorRef, true);
    }
    return false;
  }

  cancelPendingSaves();
  if (opts.markCleanAfter) {
    editorRef.current?.markClean();
  }
  return true;
}
