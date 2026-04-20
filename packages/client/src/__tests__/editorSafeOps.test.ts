import { describe, it, expect, vi } from "vitest";
import type { MutableRefObject } from "react";
import { safeSetEditable } from "../utils/editorSafeOps";
import type { EditorHandle } from "../components/Editor";

function makeRef(editor: EditorHandle | null): MutableRefObject<EditorHandle | null> {
  return { current: editor };
}

describe("safeSetEditable", () => {
  it("forwards to editor.setEditable when ref is non-null", () => {
    const setEditable = vi.fn();
    const handle = { setEditable } as unknown as EditorHandle;
    const ok = safeSetEditable(makeRef(handle), true);
    expect(setEditable).toHaveBeenCalledWith(true);
    expect(ok).toBe(true);
  });

  it("returns false when ref is null — no editor on which to apply", () => {
    // A null ref means there is no editor instance available to update.
    // The helper reports that no apply happened by returning false. The
    // return is informational (see editorSafeOps.ts contract); the real
    // data-loss defense is handleSaveLockGated, which short-circuits
    // auto-save PATCHes while the lock banner is up regardless of the
    // editor's setEditable state.
    expect(safeSetEditable(makeRef(null), false)).toBe(false);
  });

  it("returns false and logs when setEditable throws synchronously", () => {
    // TipTap can throw synchronously during the mid-remount window; the
    // helper must absorb the throw, log it, and report the failed apply
    // via its informational boolean return value.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setEditable = vi.fn().mockImplementation(() => {
      throw new Error("TipTap instance destroyed");
    });
    const handle = { setEditable } as unknown as EditorHandle;
    let returned: boolean | undefined;
    expect(() => {
      returned = safeSetEditable(makeRef(handle), true);
    }).not.toThrow();
    expect(returned).toBe(false);
    expect(warn).toHaveBeenCalledWith("safeSetEditable: setEditable threw", expect.any(Error));
    warn.mockRestore();
  });
});
