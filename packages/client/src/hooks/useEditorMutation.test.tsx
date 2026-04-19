import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import { useEditorMutation } from "../hooks/useEditorMutation";

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

describe("useEditorMutation", () => {
  it("exports a hook", () => {
    expect(typeof useEditorMutation).toBe("function");
  });
});

describe("useEditorMutation — happy path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs steps in the required order", async () => {
    const { calls, editorRef, projectEditor } = buildHandles();
    const { clearAllCachedContent } = await import("./useContentCache");
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
    expect(vi.mocked(clearAllCachedContent).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(projectEditor.reloadActiveChapter).mock.invocationCallOrder[0],
    );
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
    const { clearAllCachedContent } = await import("./useContentCache");
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
    const mutate = vi.fn();
    const { clearAllCachedContent } = await import("./useContentCache");

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor }),
    );
    const res = await result.current.run(mutate as never);

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
