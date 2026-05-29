import { describe, it, expect, vi } from "vitest";
import type { MutableRefObject } from "react";
import { safeSetEditable, quiesceEditorForServerOp } from "../utils/editorSafeOps";
import type { EditorHandle } from "../components/Editor";

function makeRef(editor: EditorHandle | null): MutableRefObject<EditorHandle | null> {
  return { current: editor };
}

function makeHandle(overrides: Partial<EditorHandle> = {}): {
  handle: EditorHandle;
  flushSave: ReturnType<typeof vi.fn>;
  markClean: ReturnType<typeof vi.fn>;
  setEditable: ReturnType<typeof vi.fn>;
} {
  const flushSave = vi.fn().mockResolvedValue(true);
  const markClean = vi.fn();
  const setEditable = vi.fn();
  const handle = { flushSave, markClean, setEditable, ...overrides } as unknown as EditorHandle;
  return { handle, flushSave, markClean, setEditable };
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

// F-7: the snapshot onView / onBeforeCreate handlers hand-composed the
// load-bearing save-pipeline ordering (disable -> flush -> [fail: re-enable,
// bail] -> cancel pending saves -> markClean). quiesceEditorForServerOp
// encodes that ordering once so the two handlers (and any future caller that
// must quiet the editor before a non-content-mutating server interaction)
// share one implementation instead of duplicating the sequence.
describe("quiesceEditorForServerOp", () => {
  it("flush succeeds (default opts): cancels pending saves, returns true, no setEditable/markClean", async () => {
    const { handle, flushSave, markClean, setEditable } = makeHandle();
    const cancel = vi.fn();

    const ok = await quiesceEditorForServerOp(makeRef(handle), cancel);

    expect(flushSave).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(markClean).not.toHaveBeenCalled();
    expect(setEditable).not.toHaveBeenCalled();
    expect(ok).toBe(true);
  });

  it("disableEditor + flush succeeds: disables BEFORE flush and leaves it disabled, then cancels", async () => {
    const order: string[] = [];
    const flushSave = vi.fn().mockImplementation(async () => {
      order.push("flush");
      return true;
    });
    const setEditable = vi.fn().mockImplementation((v: boolean) => order.push(`setEditable(${v})`));
    const cancel = vi.fn().mockImplementation(() => order.push("cancel"));
    const { handle } = makeHandle({ flushSave, setEditable } as Partial<EditorHandle>);

    const ok = await quiesceEditorForServerOp(makeRef(handle), cancel, { disableEditor: true });

    // Disable must precede the flush (invariant #2 — no typing into content
    // about to be quiesced), and the editor stays disabled on success (the
    // caller drives the read-only view / re-enable from here).
    expect(order).toEqual(["setEditable(false)", "flush", "cancel"]);
    expect(setEditable).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });

  it("markCleanAfter + flush succeeds: cancels then marks clean, returns true", async () => {
    const order: string[] = [];
    const flushSave = vi.fn().mockResolvedValue(true);
    const markClean = vi.fn().mockImplementation(() => order.push("markClean"));
    const cancel = vi.fn().mockImplementation(() => order.push("cancel"));
    const { handle } = makeHandle({ flushSave, markClean } as Partial<EditorHandle>);

    const ok = await quiesceEditorForServerOp(makeRef(handle), cancel, { markCleanAfter: true });

    // cancel must precede markClean (cancel clears retry/backoff state; markClean
    // then zeroes the dirty flag + debounce timer — order matches onBeforeCreate).
    expect(order).toEqual(["cancel", "markClean"]);
    expect(ok).toBe(true);
  });

  it("disableEditor + flush FAILS: re-enables editor, does NOT cancel or markClean, returns false", async () => {
    const flushSave = vi.fn().mockResolvedValue(false);
    const setEditable = vi.fn();
    const markClean = vi.fn();
    const cancel = vi.fn();
    const { handle } = makeHandle({ flushSave, setEditable, markClean } as Partial<EditorHandle>);

    const ok = await quiesceEditorForServerOp(makeRef(handle), cancel, {
      disableEditor: true,
      markCleanAfter: true,
    });

    expect(setEditable.mock.calls).toEqual([[false], [true]]); // disabled, then re-enabled on failure
    expect(cancel).not.toHaveBeenCalled();
    expect(markClean).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it("flush FAILS (default opts): no cancel, no setEditable, returns false", async () => {
    const flushSave = vi.fn().mockResolvedValue(false);
    const setEditable = vi.fn();
    const cancel = vi.fn();
    const { handle } = makeHandle({ flushSave, setEditable } as Partial<EditorHandle>);

    const ok = await quiesceEditorForServerOp(makeRef(handle), cancel);

    expect(cancel).not.toHaveBeenCalled();
    expect(setEditable).not.toHaveBeenCalled();
    expect(ok).toBe(false);
  });

  it("null editor ref: treats absent flushSave as flushed (?? true), cancels, returns true, no throw", async () => {
    const cancel = vi.fn();
    let ok: boolean | undefined;
    await expect(
      (async () => {
        ok = await quiesceEditorForServerOp(makeRef(null), cancel, { markCleanAfter: true });
      })(),
    ).resolves.toBeUndefined();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(ok).toBe(true);
  });
});
