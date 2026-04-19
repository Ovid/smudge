import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import { useEditorMutation, type MutationDirective } from "../hooks/useEditorMutation";
import { clearAllCachedContent } from "./useContentCache";

vi.mock("./useContentCache", () => ({
  clearAllCachedContent: vi.fn(),
}));

function buildHandles() {
  const calls: string[] = [];
  const editor: EditorHandle = {
    flushSave: vi.fn(async () => {
      calls.push("flushSave");
      return true;
    }),
    editor: null,
    insertImage: vi.fn(),
    markClean: vi.fn(() => {
      calls.push("markClean");
    }),
    setEditable: vi.fn((editable: boolean) => {
      calls.push(`setEditable(${editable})`);
    }),
  };
  const editorRef: MutableRefObject<EditorHandle | null> = { current: editor };
  const projectEditor = {
    cancelPendingSaves: vi.fn(() => {
      calls.push("cancelPendingSaves");
    }),
    reloadActiveChapter: vi.fn(async () => {
      calls.push("reloadActiveChapter");
      return true;
    }),
  };
  return { calls, editor, editorRef, projectEditor };
}

describe("useEditorMutation — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs steps in the required order", async () => {
    const { calls, editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    const res = await result.current.run(async () => {
      calls.push("mutate");
      return { clearCacheFor: ["c1"], reloadActiveChapter: true, data: undefined };
    });

    expect(res).toEqual({ ok: true, data: undefined });
    expect(calls).toEqual([
      "setEditable(false)",
      "flushSave",
      "cancelPendingSaves",
      "markClean",
      "mutate",
      "reloadActiveChapter",
      "setEditable(true)",
    ]);
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
    const cacheOrder = vi.mocked(clearAllCachedContent).mock.invocationCallOrder[0];
    const reloadOrder = vi.mocked(projectEditor.reloadActiveChapter).mock.invocationCallOrder[0];
    expect(cacheOrder).toBeDefined();
    expect(reloadOrder).toBeDefined();
    expect(cacheOrder!).toBeLessThan(reloadOrder!);
  });

  it("skips reloadActiveChapter when directive says false", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
  });

  it("skips clearAllCachedContent when directive.clearCacheFor is empty", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
  });

  it("threads typed data through to the success result", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    const res = await result.current.run<{ replaced: number }>(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: { replaced: 7 },
    }));

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toEqual({ replaced: 7 });
    }
  });
});

describe("useEditorMutation — flush failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stage 'flush' when flushSave rejects and does not proceed", async () => {
    const { editorRef, projectEditor } = buildHandles();
    editorRef.current!.flushSave = vi.fn(async () => {
      throw new Error("boom");
    });
    const mutate = vi.fn<() => Promise<MutationDirective<void>>>();

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(mutate);

    expect(res).toEqual({
      ok: false,
      stage: "flush",
      error: expect.objectContaining({ message: "boom" }),
    });
    expect(mutate).not.toHaveBeenCalled();
    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
  });

  it("returns stage 'flush' when flushSave resolves false and does not proceed", async () => {
    const { editorRef, projectEditor } = buildHandles();
    editorRef.current!.flushSave = vi.fn(async () => false);
    const mutate = vi.fn<() => Promise<MutationDirective<void>>>();

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(mutate);

    expect(res.ok).toBe(false);
    if (!res.ok && res.stage === "flush") {
      expect(res.error).toBeInstanceOf(Error);
      expect((res.error as Error).message).toBe("flushSave returned false");
    } else {
      throw new Error(`expected stage 'flush', got ${JSON.stringify(res)}`);
    }
    expect(mutate).not.toHaveBeenCalled();
    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
    expect(projectEditor.cancelPendingSaves).not.toHaveBeenCalled();
    expect(editorRef.current!.markClean).not.toHaveBeenCalled();
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
  });
});

describe("useEditorMutation — mutate failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stage 'mutate' on throw and skips cache/reload", async () => {
    const { editorRef, projectEditor } = buildHandles();

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(async () => {
      throw new Error("server-no");
    });

    expect(res).toEqual({
      ok: false,
      stage: "mutate",
      error: expect.objectContaining({ message: "server-no" }),
    });
    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
    expect(editorRef.current!.markClean).toHaveBeenCalled(); // markClean runs before mutate
  });
});

describe("useEditorMutation — reload failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stage 'reload' when reloadActiveChapter returns false", async () => {
    const { editorRef, projectEditor } = buildHandles();
    // The hook passes a no-op onError; reloadActiveChapter's onError
    // signalling is intentionally suppressed (see useEditorMutation).
    // What matters is the boolean return: false -> stage:"reload".
    projectEditor.reloadActiveChapter = vi.fn(async () => false);

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run<{ replaced: number }>(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      data: { replaced: 3 },
    }));

    expect(res).toEqual({
      ok: false,
      stage: "reload",
      data: { replaced: 3 },
    });
    // Editor must stay read-only on reload failure: markClean + cache-clear
    // have already happened, but the TipTap doc still holds pre-mutation
    // content. Re-enabling would let the user type over stale content and
    // the next auto-save would silently revert the server-committed replace.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
    // cache-clear still happened — server committed the mutation
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
  });

  it("suppresses reloadActiveChapter's onError output (S1)", async () => {
    // Regression guard: the hook passes a no-op onError so the reload
    // failure does NOT flip useProjectEditor's fallback setError path,
    // which would otherwise switch EditorPage into the full-screen
    // error branch in place of the persistent lock banner.
    const { editorRef, projectEditor } = buildHandles();
    const onErrorSpy = vi.fn();
    projectEditor.reloadActiveChapter = vi.fn(async (onError?: (msg: string) => void) => {
      onError?.("would-flip-to-full-page-error");
      onErrorSpy();
      return false;
    });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: undefined,
    }));

    // reloadActiveChapter was called (onErrorSpy proves that).
    expect(onErrorSpy).toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.stage).toBe("reload");
  });

  it("returns stage 'reload' with data when reloadActiveChapter returns false without onError", async () => {
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => false);

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run<{ affected: string[] }>(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: { affected: ["c9"] },
    }));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.stage).toBe("reload");
      if (res.stage === "reload") {
        expect(res.data).toEqual({ affected: ["c9"] });
      }
    }
    // inFlightRef must still be released so a user-triggered refresh works.
    // Verify by firing another run and confirming it is not rejected as busy.
    projectEditor.reloadActiveChapter = vi.fn(async () => true);
    const res2 = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: undefined,
    }));
    expect(res2.ok).toBe(true);
  });
});

describe("useEditorMutation — busy guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects overlapping run with stage 'busy' and no side effects", async () => {
    const { editorRef, projectEditor } = buildHandles();

    let resolveMutate: () => void = () => {};
    const blockingMutate = () =>
      new Promise<MutationDirective>((resolve) => {
        resolveMutate = () =>
          resolve({
            clearCacheFor: [],
            reloadActiveChapter: false,
            data: undefined,
          });
      });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    const firstPromise = result.current.run(blockingMutate);
    // Yield to allow the first run to enter the in-flight region
    await Promise.resolve();
    await Promise.resolve();

    const secondResult = await result.current.run(async () => ({
      clearCacheFor: ["x"],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(secondResult).toEqual({ ok: false, stage: "busy" });
    // Second call must have zero side effects
    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalledWith(["x"]);
    // editor handle methods called for second run? Should not have additional calls.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1); // only the first run's (false)

    resolveMutate();
    await firstPromise;
  });
});

describe("useEditorMutation — synchronous setEditable throw (C1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("releases inFlightRef when setEditable(false) throws synchronously", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const editor = editorRef.current!;
    let throwOnce = true;
    editor.setEditable = vi.fn((_editable: boolean) => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("editor destroyed");
      }
    });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    await expect(
      result.current.run(async () => ({
        clearCacheFor: [],
        reloadActiveChapter: false,
        data: undefined,
      })),
    ).rejects.toThrow();

    // The latch must have cleared so a follow-up run is not rejected as busy.
    const second = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(second).toEqual({ ok: true, data: undefined });
  });

  it("releases inFlightRef when setEditable(true) in finally throws synchronously", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const editor = editorRef.current!;
    // setEditable(false) on entry is fine; setEditable(true) in finally throws
    // once. Mirrors the TipTap mid-remount window on the exit side of the
    // mutation — without the fix, inFlightRef latches for the session.
    let callCount = 0;
    editor.setEditable = vi.fn((editable: boolean) => {
      callCount += 1;
      if (editable && callCount === 2) {
        throw new Error("editor destroyed on exit");
      }
    });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    const first = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(first).toEqual({ ok: true, data: undefined });

    // The latch must have cleared so a follow-up run is not rejected as busy.
    const second = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(second).toEqual({ ok: true, data: undefined });
  });
});

describe("useEditorMutation — isBusy probe (I2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns true while a run() is mid-flight and false after it resolves", async () => {
    const { editorRef, projectEditor } = buildHandles();

    let resolveMutate: () => void = () => {};
    const blockingMutate = () =>
      new Promise<MutationDirective>((resolve) => {
        resolveMutate = () =>
          resolve({ clearCacheFor: [], reloadActiveChapter: false, data: undefined });
      });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    expect(result.current.isBusy()).toBe(false);

    const promise = result.current.run(blockingMutate);
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.isBusy()).toBe(true);

    resolveMutate();
    await promise;
    expect(result.current.isBusy()).toBe(false);
  });
});

describe("useEditorMutation — null editor ref", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs mutate, cache-clear, and reload when editorRef.current is null", async () => {
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    const res = await result.current.run(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(res).toEqual({ ok: true, data: undefined });
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
    expect(projectEditor.reloadActiveChapter).toHaveBeenCalled();
  });
});

describe("useEditorMutation — expected chapter id (I2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes reloadChapterId to reloadActiveChapter so the hook can skip on mismatch", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const reloadSpy = vi.fn(
      async (_onError?: (msg: string) => void, _expectedChapterId?: string) => true,
    );
    projectEditor.reloadActiveChapter = reloadSpy;

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    await result.current.run(async () => ({
      clearCacheFor: ["ch-1"],
      reloadActiveChapter: true,
      reloadChapterId: "ch-1",
      data: undefined,
    }));

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    // Second arg is the expected chapter id the directive asked to reload.
    expect(reloadSpy.mock.calls[0]![1]).toBe("ch-1");
  });

  it("omits the expected chapter id when the directive does not set one (backward compat)", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const reloadSpy = vi.fn(
      async (_onError?: (msg: string) => void, _expectedChapterId?: string) => true,
    );
    projectEditor.reloadActiveChapter = reloadSpy;

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(reloadSpy).toHaveBeenCalledTimes(1);
    expect(reloadSpy.mock.calls[0]![1]).toBeUndefined();
  });
});

describe("useEditorMutation — isLocked predicate (I1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips setEditable(true) when isLocked() returns true", async () => {
    // Simulates a prior reload-failure that set EditorPage's persistent
    // lock banner. A subsequent successful mutation must NOT re-enable the
    // editor — the banner is still telling the user to refresh, and typing
    // into re-enabled-but-stale content would silently overwrite the
    // server-committed change on the next auto-save.
    const { editorRef, projectEditor } = buildHandles();
    const isLocked = vi.fn(() => true);
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, isLocked }));

    const res = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(res).toEqual({ ok: true, data: undefined });
    // setEditable(false) on entry, but NOT setEditable(true) on exit.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
  });

  it("re-enables setEditable(true) when isLocked() returns false", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const isLocked = vi.fn(() => false);
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, isLocked }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(editorRef.current!.setEditable).toHaveBeenCalledWith(true);
  });

  it("does not call setEditable(true) when locked, even through the finally's busy-latch safety path", async () => {
    // Lock flips true between entry and exit: simulates the reload-failed
    // banner being set by a prior run. This run succeeds, but the exit
    // re-enable must still be gated.
    const { editorRef, projectEditor } = buildHandles();
    let locked = false;
    const isLocked = () => locked;
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, isLocked }));

    await result.current.run(async () => {
      locked = true;
      return { clearCacheFor: [], reloadActiveChapter: false, data: undefined };
    });

    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
  });
});

describe("useEditorMutation — latest-ref pattern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls the latest projectEditor methods even when parent re-renders with new identities", async () => {
    const { editorRef } = buildHandles();

    const firstCancel = vi.fn();
    const firstReload = vi.fn(async () => true);
    const secondCancel = vi.fn();
    const secondReload = vi.fn(async () => true);

    const { result, rerender } = renderHook(
      (props: { cancel: () => void; reload: () => Promise<boolean> }) =>
        useEditorMutation({
          editorRef,
          projectEditor: {
            cancelPendingSaves: props.cancel,
            reloadActiveChapter: props.reload,
          },
        }),
      { initialProps: { cancel: firstCancel, reload: firstReload } },
    );

    rerender({ cancel: secondCancel, reload: secondReload });

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(firstCancel).not.toHaveBeenCalled();
    expect(firstReload).not.toHaveBeenCalled();
    expect(secondCancel).toHaveBeenCalled();
    expect(secondReload).toHaveBeenCalled();
  });
});
