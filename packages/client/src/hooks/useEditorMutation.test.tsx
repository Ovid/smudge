import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import {
  useEditorMutation,
  type MutationDirective,
} from "../hooks/useEditorMutation";
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
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

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
    const cacheOrder =
      vi.mocked(clearAllCachedContent).mock.invocationCallOrder[0];
    const reloadOrder =
      vi.mocked(projectEditor.reloadActiveChapter).mock.invocationCallOrder[0];
    expect(cacheOrder).toBeDefined();
    expect(reloadOrder).toBeDefined();
    expect(cacheOrder!).toBeLessThan(reloadOrder!);
  });

  it("skips reloadActiveChapter when directive says false", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
  });

  it("skips clearAllCachedContent when directive.clearCacheFor is empty", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      data: undefined,
    }));

    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
  });

  it("threads typed data through to the success result", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

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

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
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
});

describe("useEditorMutation — mutate failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stage 'mutate' on throw and skips cache/reload", async () => {
    const { editorRef, projectEditor } = buildHandles();

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
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

  it("returns stage 'reload' when reloadActiveChapter invokes onError", async () => {
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(
      async (onError?: (msg: string) => void) => {
        onError?.("reload-failed-msg");
        return false;
      },
    );

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
    const res = await result.current.run<{ replaced: number }>(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      data: { replaced: 3 },
    }));

    expect(res).toEqual({
      ok: false,
      stage: "reload",
      data: { replaced: 3 },
      error: "reload-failed-msg",
    });
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(true);
    // cache-clear still happened — server committed the mutation
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
  });

  it("returns stage 'reload' with data when reloadActiveChapter returns false without onError", async () => {
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => false);

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
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
      new Promise<{
        clearCacheFor: string[];
        reloadActiveChapter: boolean;
        data: void;
      }>((resolve) => {
        resolveMutate = () =>
          resolve({
            clearCacheFor: [],
            reloadActiveChapter: false,
            data: undefined,
          });
      });

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

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

describe("useEditorMutation — null editor ref", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs mutate, cache-clear, and reload when editorRef.current is null", async () => {
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );

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
