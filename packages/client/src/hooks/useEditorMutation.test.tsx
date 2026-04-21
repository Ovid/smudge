import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import { useEditorMutation, type MutationDirective } from "../hooks/useEditorMutation";
import type { ReloadOutcome } from "../hooks/useProjectEditor";
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
  // Typed so individual tests can reassign reloadActiveChapter to mocks
  // that return "failed" or "superseded" without TS narrowing the return
  // to a single literal from the initial assignment.
  const projectEditor: {
    cancelPendingSaves: () => void;
    reloadActiveChapter: (
      onError?: (message: string) => void,
      expectedChapterId?: string,
    ) => Promise<ReloadOutcome>;
    getActiveChapter: () => { id: string } | null;
  } = {
    cancelPendingSaves: vi.fn(() => {
      calls.push("cancelPendingSaves");
    }),
    reloadActiveChapter: vi.fn(async () => {
      calls.push("reloadActiveChapter");
      return "reloaded" as const;
    }),
    getActiveChapter: vi.fn(() => null),
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
      return {
        clearCacheFor: ["c1"],
        reloadActiveChapter: true,
        reloadChapterId: "c1",
        data: undefined,
      };
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
      reloadChapterId: "c1",
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

describe("useEditorMutation — settle-phase failure (I1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stage 'flush' when cancelPendingSaves throws synchronously", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const err = new Error("cancelPendingSaves boom");
    projectEditor.cancelPendingSaves = vi.fn(() => {
      throw err;
    });
    const mutate = vi.fn<() => Promise<MutationDirective<void>>>();

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(mutate);

    expect(res).toEqual({ ok: false, stage: "flush", error: err });
    expect(mutate).not.toHaveBeenCalled();
    expect(vi.mocked(clearAllCachedContent)).not.toHaveBeenCalled();
  });

  it("returns stage 'flush' when markClean throws synchronously", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const err = new Error("markClean boom");
    editorRef.current!.markClean = vi.fn(() => {
      throw err;
    });
    const mutate = vi.fn<() => Promise<MutationDirective<void>>>();

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(mutate);

    expect(res).toEqual({ ok: false, stage: "flush", error: err });
    expect(mutate).not.toHaveBeenCalled();
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
    // What matters is the outcome: "failed" -> stage:"reload".
    projectEditor.reloadActiveChapter = vi.fn(async () => "failed" as const);

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run<{ replaced: number }>(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
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
      return "failed" as const;
    });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: undefined,
    }));

    // reloadActiveChapter was called (onErrorSpy proves that).
    expect(onErrorSpy).toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.stage).toBe("reload");
  });

  it("returns stage 'reload' with data when reloadActiveChapter returns 'failed' without onError", async () => {
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => "failed" as const);

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run<{ affected: string[] }>(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
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
    projectEditor.reloadActiveChapter = vi.fn(async () => "reloaded" as const);
    const res2 = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: undefined,
    }));
    expect(res2.ok).toBe(true);
  });
});

describe("useEditorMutation — reload superseded (I5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats 'superseded' reload as success — no stage:'reload', no lock banner", async () => {
    // User switched chapters between the directive returning and the hook
    // invoking reloadActiveChapter. The mutation itself committed server-side
    // and the newly-active chapter is unrelated — we must NOT raise a
    // persistent lock banner pinned to a chapter the mutation didn't touch.
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => "superseded" as const);

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run<{ replaced: number }>(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: { replaced: 3 },
    }));

    // ok:true, stage is NOT "reload".
    expect(res).toEqual({ ok: true, data: { replaced: 3 } });
  });

  it("re-reloads the now-active chapter when it was in clearCacheFor (I3, review 2026-04-21)", async () => {
    // Project-scope replace affected [c1, c2]. User switched from c1 (the
    // reloadChapterId) to c2 mid-flight. Without the fix, the hook cleared
    // c2's cache, re-locked then re-unlocked the freshly-mounted c2 editor,
    // and left whatever handleSelectChapter's (possibly pre-replace) GET
    // had loaded on screen — the next keystroke would PATCH stale content
    // over the server-committed replace. With the fix, the hook detects
    // that the new active chapter is in clearCacheFor and fires a second
    // reload without an expectedChapterId so a fresh GET pulls post-
    // mutation content.
    const { editorRef, projectEditor } = buildHandles();
    const reloadMock = vi
      .fn<
        (
          onError?: (message: string) => void,
          expectedChapterId?: string,
        ) => Promise<ReloadOutcome>
      >()
      .mockResolvedValueOnce("superseded")
      .mockResolvedValueOnce("reloaded");
    projectEditor.reloadActiveChapter = reloadMock;
    projectEditor.getActiveChapter = vi.fn(() => ({ id: "c2" }) as { id: string });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(async () => ({
      clearCacheFor: ["c1", "c2"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: undefined,
    }));

    expect(res).toEqual({ ok: true, data: undefined });
    expect(reloadMock).toHaveBeenCalledTimes(2);
    // Second call has no expectedChapterId — hook reloads whatever is current.
    expect(reloadMock.mock.calls[1]![1]).toBeUndefined();
  });

  it("returns stage:'reload' when the I3 second reload fails", async () => {
    // If the second reload (targeting the now-active affected chapter) fails,
    // the editor must remain locked — otherwise the user could type over
    // server-committed content with the stale pre-mutation GET still on screen.
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi
      .fn<
        (
          onError?: (message: string) => void,
          expectedChapterId?: string,
        ) => Promise<ReloadOutcome>
      >()
      .mockResolvedValueOnce("superseded")
      .mockResolvedValueOnce("failed");
    projectEditor.getActiveChapter = vi.fn(() => ({ id: "c2" }) as { id: string });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run<{ n: number }>(async () => ({
      clearCacheFor: ["c1", "c2"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: { n: 5 },
    }));

    expect(res).toEqual({ ok: false, stage: "reload", data: { n: 5 } });
  });

  it("does NOT re-reload when the now-active chapter was not in clearCacheFor (I3)", async () => {
    // If the user switched to an unrelated chapter (not in the mutation's
    // clearCacheFor), its content wasn't touched by the server-side
    // mutation and its editor state is independent. A second reload would
    // be a gratuitous GET and could clobber a draft in progress.
    const { editorRef, projectEditor } = buildHandles();
    const reloadMock = vi.fn(async () => "superseded" as const);
    projectEditor.reloadActiveChapter = reloadMock;
    projectEditor.getActiveChapter = vi.fn(() => ({ id: "c3" }) as { id: string });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));
    const res = await result.current.run(async () => ({
      clearCacheFor: ["c1", "c2"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: undefined,
    }));

    expect(res).toEqual({ ok: true, data: undefined });
    // Only the first reload — no second GET.
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it("bypasses a pre-existing caller lock when reload was superseded (I1, review 2026-04-20)", async () => {
    // Revised semantics: "superseded" implies the user switched chapters
    // (or the chapter vanished) between the directive returning and the
    // reload firing — every "superseded" code path in useProjectEditor
    // either sees current.id !== expectedChapterId or a seq bump, both
    // of which only happen on chapter change. Any pre-existing lock
    // banner was scoped to the PRIOR chapter; leaving the unrelated
    // new editor read-only while EditorPage's useEffect clears the
    // banner on chapter change produced a dead "no banner, can't type"
    // state the user couldn't recover from without another switch or
    // refresh. The finally now unlocks on superseded regardless of the
    // isLocked predicate.
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => "superseded" as const);
    const isLocked = vi.fn(() => true);
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, isLocked }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "ch-1",
      data: undefined,
    }));

    // setEditable(false) on entry, setEditable(true) in the finally — the
    // superseded outcome bypasses the caller's lock so the (now unrelated)
    // editor is usable.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(2);
    expect(vi.mocked(editorRef.current!.setEditable).mock.calls[0]![0]).toBe(false);
    expect(vi.mocked(editorRef.current!.setEditable).mock.calls[1]![0]).toBe(true);
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
      reloadChapterId: "c1",
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

  it("returns stage:'flush' when setEditable(false) throws synchronously (S4)", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const editor = editorRef.current!;
    let throwOnce = true;
    const err = new Error("editor destroyed");
    editor.setEditable = vi.fn((_editable: boolean) => {
      if (throwOnce) {
        throwOnce = false;
        throw err;
      }
    });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    // Previously rejected the Promise, escaping the discriminated
    // MutationResult contract. Now surfaces as stage:"flush" so callers
    // can handle it via their existing stage ladder without try/catch.
    const first = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(first).toEqual({ ok: false, stage: "flush", error: err });

    // The latch must have cleared so a follow-up run proceeds normally.
    const second = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(second).toEqual({ ok: true, data: undefined });
  });

  it("releases inFlightRef when setEditable(true) in finally throws synchronously", async () => {
    // CLAUDE.md zero-warnings policy: the warn is deliberate (I4), so
    // spy-suppress and assert rather than letting it leak into test
    // output where real problems would be drowned.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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

    // I4: the silent catch would otherwise leave no trace of a
    // degraded-editor state. Assert the warn fired so the dev signal
    // is preserved.
    expect(warnSpy).toHaveBeenCalledWith(
      "useEditorMutation: failed to re-enable editor",
      expect.any(Error),
    );

    // The latch must have cleared so a follow-up run is not rejected as busy.
    const second = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(second).toEqual({ ok: true, data: undefined });

    warnSpy.mockRestore();
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
      reloadChapterId: "c1",
      data: undefined,
    }));

    expect(res).toEqual({ ok: true, data: undefined });
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
    expect(projectEditor.reloadActiveChapter).toHaveBeenCalled();
  });
});

describe("useEditorMutation — mid-mutate editor remount (I3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("locks a freshly mounted editor if the entry-time ref was null", async () => {
    // Scenario: chapter is mid-remount at run() entry (editorRef.current is
    // null). During the mutate await, TipTap finishes mounting. Without the
    // I3 fix the new editor stayed editable=true for the reload window —
    // user keystrokes could race the reload's auto-save and overwrite the
    // server commit.
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };

    const newEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(),
    };

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    const res = await result.current.run(async () => {
      // Simulate TipTap finishing its mount during the server round-trip.
      editorRef.current = newEditor;
      return {
        clearCacheFor: [],
        reloadActiveChapter: false,
        data: undefined,
      };
    });

    expect(res.ok).toBe(true);
    // The new editor was locked post-mutate, then re-enabled by the finally.
    expect(newEditor.setEditable).toHaveBeenCalledWith(false);
    expect(newEditor.setEditable).toHaveBeenCalledWith(true);
    // setEditable(false) must land BEFORE setEditable(true).
    const falseCallIdx = vi
      .mocked(newEditor.setEditable)
      .mock.calls.findIndex((c) => c[0] === false);
    const trueCallIdx = vi.mocked(newEditor.setEditable).mock.calls.findIndex((c) => c[0] === true);
    expect(falseCallIdx).toBeLessThan(trueCallIdx);
  });

  it("does not re-lock the same editor that was already locked at entry", async () => {
    // Non-remount happy path: the same editor instance is present at entry
    // and at mutate-exit. The post-mutate re-read must not re-call
    // setEditable(false) (redundant work, and would make the call counts
    // harder to reason about for tests that assert the setEditable cadence).
    const { editor, editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    // Exactly one setEditable(false) (entry) and one setEditable(true)
    // (finally) — no second lock from the post-mutate re-read.
    expect(editor.setEditable).toHaveBeenCalledTimes(2);
    expect(vi.mocked(editor.setEditable).mock.calls[0]![0]).toBe(false);
    expect(vi.mocked(editor.setEditable).mock.calls[1]![0]).toBe(true);
  });

  it("re-enables the current editor in the finally, not a stale captured reference", async () => {
    // If the entry-time editor is destroyed mid-run (chapter switch during
    // mutate), the finally must call setEditable(true) on editorRef.current,
    // not on the captured reference. Here we null the captured editor and
    // swap in a fresh one before the reload completes.
    const { editor, editorRef, projectEditor } = buildHandles();

    const newEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(),
    };

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

    await result.current.run(async () => {
      editorRef.current = newEditor;
      return { clearCacheFor: [], reloadActiveChapter: false, data: undefined };
    });

    // The finally targets the NEW editor for the unlock.
    expect(newEditor.setEditable).toHaveBeenCalledWith(true);
    // The stale editor was locked on entry but NOT re-enabled on exit.
    expect(vi.mocked(editor.setEditable).mock.calls).toEqual([[false]]);
  });

  it("promotes a throwing post-mutate setEditable(false) to stage:reload (I1)", async () => {
    // Before I1: the hook logged and fell through to clearAllCachedContent
    // + reloadActiveChapter on the assumption the re-lock succeeded. If
    // it actually threw, the fresh editor was left writable and the
    // cache for affected chapters had already been wiped — user
    // keystrokes during the reload-GET window would PATCH pre-mutation
    // content back over the just-committed server change.
    //
    // After: on throw, return stage:"reload" with the directive's data.
    // The caller surfaces the persistent lock banner and the save gate
    // (handleSaveLockGated, C1) refuses to PATCH while that banner is up.
    //
    // C1 (review 2026-04-20): cache-clear MUST run before the bail —
    // server committed the mutation, so localStorage drafts must be
    // wiped to prevent refresh-and-PATCH-stale-content. Reload must NOT
    // run (we can't safely load fresh state into an editor we failed
    // to re-lock).
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };
    const reloadSpy = vi.fn(async () => "reloaded" as const);
    projectEditor.reloadActiveChapter = reloadSpy;

    const throwingEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(() => {
        throw new Error("mid-remount throw");
      }),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

      const res = await result.current.run(async () => {
        editorRef.current = throwingEditor;
        return {
          clearCacheFor: ["ch-1"],
          reloadActiveChapter: true,
          reloadChapterId: "ch-1",
          data: { payload: "committed" } as const,
        };
      });

      expect(res.ok).toBe(false);
      if (res.ok === false) {
        expect(res.stage).toBe("reload");
        if (res.stage === "reload") {
          expect(res.data).toEqual({ payload: "committed" });
        }
      }
      expect(warnSpy).toHaveBeenCalled();
      // Cache clear MUST run (server committed; prevent stale-draft
      // rehydration on refresh). Reload MUST NOT run (editor is in a
      // degraded state — re-lock failed, so loading fresh content
      // into a writable editor would race with user keystrokes).
      expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["ch-1"]);
      expect(reloadSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns ok:true on re-lock throw when directive.reloadActiveChapter is false (I1, review 2026-04-21)", async () => {
    // Prior behavior: the re-lock bail unconditionally returned
    // stage:"reload" regardless of whether the directive asked for a
    // reload. Callers treat stage:"reload" as "server committed, GET
    // failed" and raise a persistent lock banner + cache-wipe + editor
    // lock. When the directive's reloadActiveChapter is false (e.g.
    // stale-chapter-switch restore, 0-replace), the mutation intentionally
    // signaled "no reload needed" — and the new editor that mounted
    // mid-mutate is on an unrelated chapter. Locking it would be the
    // wrong chapter, and the contradictory banners (I2 / I3) would fire.
    //
    // After fix: honor the directive. Cache-clear still runs, but the
    // hook returns ok:true with the data so callers surface the normal
    // success path.
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };
    const reloadSpy = vi.fn(async () => "reloaded" as const);
    projectEditor.reloadActiveChapter = reloadSpy;

    const throwingEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(() => {
        throw new Error("mid-remount throw");
      }),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor }));

      const res = await result.current.run(async () => {
        editorRef.current = throwingEditor;
        return {
          clearCacheFor: ["ch-1"],
          reloadActiveChapter: false,
          data: { replaced_count: 0 } as const,
        };
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.data).toEqual({ replaced_count: 0 });
      }
      // Cache clear still runs — server committed even if 0-replace.
      expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["ch-1"]);
      // Reload was not requested by the directive — must not be called.
      expect(reloadSpy).not.toHaveBeenCalled();
      // The throw was still logged via console.warn so devtools has a signal.
      expect(warnSpy).toHaveBeenCalledWith(
        "useEditorMutation: failed to lock mid-remount editor",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("useEditorMutation — expected chapter id (I2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes reloadChapterId to reloadActiveChapter so the hook can skip on mismatch", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const reloadSpy = vi.fn(
      async (_onError?: (msg: string) => void, _expectedChapterId?: string) => "reloaded" as const,
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

  // Former test "omits the expected chapter id when the directive does
  // not set one (backward compat)" — removed with the discriminated
  // union. MutationDirective now requires reloadChapterId whenever
  // reloadActiveChapter is true, so the untyped "omit it" branch no
  // longer type-checks (I2).
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

  it("re-enables setEditable(true) when isLocked() is true but reloadActiveChapter succeeds (I2)", async () => {
    // Recovery path: after a prior reload-failure set the lock banner, a
    // subsequent mutation that successfully reloads the server state
    // supersedes the lock. The editor's displayed content now matches the
    // server, so the lock's premise no longer holds — re-enable so the user
    // can edit. The caller's chapterReloadKey useEffect clears the banner
    // in the same render.
    const { editorRef, projectEditor } = buildHandles();
    const isLocked = vi.fn(() => true);
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, isLocked }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: undefined,
    }));

    expect(projectEditor.reloadActiveChapter).toHaveBeenCalled();
    expect(editorRef.current!.setEditable).toHaveBeenCalledWith(true);
  });

  it("stays setEditable(false) when isLocked() is true AND no reload was performed (I2)", async () => {
    // Guardrail for the I2 fix: a mutation that succeeds without reloading
    // must still honor the lock. Without the reload there is no fresh
    // server state on screen, so typing into a re-enabled editor would
    // auto-save stale content back over the original server-committed
    // change.
    const { editorRef, projectEditor } = buildHandles();
    const isLocked = vi.fn(() => true);
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, isLocked }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
  });

  it("treats a throwing isLocked predicate as locked (I3, review 2026-04-20)", async () => {
    // Defensive: the public contract is () => boolean, but a future
    // caller could pass a predicate that reads flaky state. Without the
    // wrap, a throw here would escape run() as an unhandled rejection
    // and bypass the discriminated MutationResult contract. Conservative
    // default on throw is "locked" — unknown predicate state must not
    // accidentally unlock the editor after a server-committed change.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { editorRef, projectEditor } = buildHandles();
      const isLocked = vi.fn(() => {
        throw new Error("flaky predicate");
      });
      const { result } = renderHook(() =>
        useEditorMutation({ editorRef, projectEditor, isLocked }),
      );

      const res = await result.current.run(async () => ({
        clearCacheFor: [],
        reloadActiveChapter: false,
        data: undefined,
      }));

      expect(res).toEqual({ ok: true, data: undefined });
      // Conservative default: stay locked. setEditable(true) must NOT
      // have run in the finally.
      expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
      expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
      expect(warnSpy).toHaveBeenCalledWith(
        "useEditorMutation: isLocked predicate threw",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("still unlocks after a successful reload when the predicate throws (I4, review 2026-04-21)", async () => {
    // Prior behavior: the catch branch set lockedByCaller=true
    // unconditionally, which overrode reloadSucceeded / reloadSuperseded.
    // On a reload-succeeded run whose isLocked predicate throws, the
    // editor stayed setEditable(false) while chapterReloadKey cleared
    // the banner — reproducing the "looks editable but can't type" dead
    // state the flags exist to prevent.
    //
    // After: the catch preserves the reloadSucceeded / reloadSuperseded
    // bypass. Conservative default on throw is still "locked" when the
    // premise for unlocking doesn't hold.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { editorRef, projectEditor } = buildHandles();
      projectEditor.reloadActiveChapter = vi.fn(async () => "reloaded" as const);
      const isLocked = vi.fn(() => {
        throw new Error("flaky predicate");
      });
      const { result } = renderHook(() =>
        useEditorMutation({ editorRef, projectEditor, isLocked }),
      );

      const res = await result.current.run(async () => ({
        clearCacheFor: ["ch-1"],
        reloadActiveChapter: true,
        reloadChapterId: "ch-1",
        data: undefined,
      }));

      expect(res).toEqual({ ok: true, data: undefined });
      // Entry locked the editor (false). The finally re-enables it (true)
      // because reloadSucceeded bypasses the predicate's throw fallback.
      const setEditableCalls = vi.mocked(editorRef.current!.setEditable).mock.calls;
      expect(setEditableCalls).toEqual([[false], [true]]);
      expect(warnSpy).toHaveBeenCalledWith(
        "useEditorMutation: isLocked predicate threw",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
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
    const firstReload = vi.fn(async () => "reloaded" as const);
    const secondCancel = vi.fn();
    const secondReload = vi.fn(async () => "reloaded" as const);

    const { result, rerender } = renderHook(
      (props: { cancel: () => void; reload: () => Promise<ReloadOutcome> }) =>
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
      reloadChapterId: "c1",
      data: undefined,
    }));

    expect(firstCancel).not.toHaveBeenCalled();
    expect(firstReload).not.toHaveBeenCalled();
    expect(secondCancel).toHaveBeenCalled();
    expect(secondReload).toHaveBeenCalled();
  });
});
