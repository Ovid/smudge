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
    // C1: lock-convergence callers check the return so they know whether
    // the editor was actually locked. A null ref means no apply happened;
    // if a new editor mounts later it will default to editable=true, so
    // the caller must escalate (the save gate at handleSaveLockGated
    // prevents any PATCH while the lock banner is up).
    expect(safeSetEditable(makeRef(null), false)).toBe(false);
  });

  it("returns false and logs when setEditable throws synchronously", () => {
    // TipTap can throw synchronously during the mid-remount window; the
    // helper must absorb the throw AND signal failure to its caller so
    // lock-convergence paths can escalate (C1).
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
