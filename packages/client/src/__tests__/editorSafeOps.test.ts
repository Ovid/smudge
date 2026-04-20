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
    safeSetEditable(makeRef(handle), true);
    expect(setEditable).toHaveBeenCalledWith(true);
  });

  it("no-ops when ref is null", () => {
    // Exercises the optional-chaining path — must not throw.
    expect(() => safeSetEditable(makeRef(null), false)).not.toThrow();
  });

  it("swallows a synchronous throw from setEditable and logs it", () => {
    // TipTap can throw synchronously during the mid-remount window; the
    // helper must absorb the throw so hand-composed save-pipeline flows
    // don't see an unhandled rejection mid-sequence.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setEditable = vi.fn().mockImplementation(() => {
      throw new Error("TipTap instance destroyed");
    });
    const handle = { setEditable } as unknown as EditorHandle;
    expect(() => safeSetEditable(makeRef(handle), true)).not.toThrow();
    expect(warn).toHaveBeenCalledWith("safeSetEditable: setEditable threw", expect.any(Error));
    warn.mockRestore();
  });
});
