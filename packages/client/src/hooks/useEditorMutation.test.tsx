import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { MutableRefObject } from "react";
import type { EditorHandle } from "../components/Editor";
import { useEditorMutation, type MutationDirective, type MutationResult } from "../hooks/useEditorMutation";
import {
  editorMutationReducer,
  INITIAL_EDITOR_MUTATION_STATE,
  type EditorMutationEvent,
} from "../hooks/useEditorMutationMachine";
import type { ReloadOutcome } from "../hooks/useProjectEditor";
import type { Chapter } from "@smudge/shared";
import { clearAllCachedContent } from "./useContentCache";

const STUB_CHAPTER: Chapter = {
  id: "stub",
  project_id: "p1",
  title: "Stub",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  sort_order: 0,
  word_count: 0,
  status: "outline",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
};

function chapterWithId(id: string): Chapter {
  return { ...STUB_CHAPTER, id };
}

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
    getActiveChapter: () => Chapter | null;
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
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

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
    // Entry-side cancelPendingSaves (S2) runs before setEditable so a
    // throw from the sync lock cannot strand a backoff save alive. The
    // re-enable is no longer an imperative setEditable(true) — it is the
    // terminal machine event (RELOADED here, asserted below).
    expect(calls).toEqual([
      "cancelPendingSaves",
      "setEditable(false)",
      "flushSave",
      "cancelPendingSaves",
      "markClean",
      "mutate",
      "reloadActiveChapter",
    ]);
    // A successful reload re-enables via RELOADED, not an imperative call.
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "RELOADED"]);
    expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["c1"]);
    const cacheOrder = vi.mocked(clearAllCachedContent).mock.invocationCallOrder[0];
    const reloadOrder = vi.mocked(projectEditor.reloadActiveChapter).mock.invocationCallOrder[0];
    expect(cacheOrder).toBeDefined();
    expect(reloadOrder).toBeDefined();
    expect(cacheOrder!).toBeLessThan(reloadOrder!);
  });

  it("skips reloadActiveChapter when directive says false", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
  });

  it("skips clearAllCachedContent when directive.clearCacheFor is empty", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

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
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

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

    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
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
    // Re-enable is machine-driven: a flush failure settles OK (re-enable
    // when not locked). The reduced editable returns to true.
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
    const final = events.reduce(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);
    expect(final.editable).toBe(true);
  });

  it("returns stage 'flush' when flushSave resolves false and does not proceed", async () => {
    const { editorRef, projectEditor } = buildHandles();
    editorRef.current!.flushSave = vi.fn(async () => false);
    const mutate = vi.fn<() => Promise<MutationDirective<void>>>();

    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );
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
    // S2 (review 2026-04-21): cancelPendingSaves runs at entry before
    // setEditable so a mid-remount throw cannot strand a backoff save
    // alive; the second call in the settle phase is skipped when
    // flushSave resolves false.
    expect(projectEditor.cancelPendingSaves).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.markClean).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
    const final = events.reduce(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);
    expect(final.editable).toBe(true);
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

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
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

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
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

    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
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
    // Re-enable is machine-driven: a mutate failure settles OK.
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
    const final = events.reduce(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);
    expect(final.editable).toBe(true);
    expect(editorRef.current!.markClean).toHaveBeenCalled(); // markClean runs before mutate
  });
});

describe("useEditorMutation — reload failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stage 'committed_but_unreloaded' when reloadActiveChapter returns failed", async () => {
    const { editorRef, projectEditor } = buildHandles();
    // The hook passes a no-op onError; reloadActiveChapter's onError
    // signalling is intentionally suppressed (see useEditorMutation).
    // What matters is the outcome: "failed" -> stage:"committed_but_unreloaded".
    projectEditor.reloadActiveChapter = vi.fn(async () => "failed" as const);

    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );
    const res = await result.current.run<{ replaced: number }>(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: { replaced: 3 },
    }));

    expect(res).toEqual({
      ok: false,
      stage: "committed_but_unreloaded",
      data: { replaced: 3 },
    });
    // Editor must stay read-only on reload failure: markClean + cache-clear
    // have already happened, but the TipTap doc still holds pre-mutation
    // content. Re-enabling would let the user type over stale content and
    // the next auto-save would silently revert the server-committed replace.
    // The hook dispatches NO terminal re-enable on the committed path —
    // editable stays false (from MUTATION_STARTED). The lock-down
    // setEditable(false) still fires on entry.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED"]);
    const final = events.reduce(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);
    expect(final.editable).toBe(false);
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

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
    const res = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: undefined,
    }));

    // reloadActiveChapter was called (onErrorSpy proves that).
    expect(onErrorSpy).toHaveBeenCalled();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.stage).toBe("committed_but_unreloaded");
  });

  it("returns stage 'committed_but_unreloaded' with data when reloadActiveChapter returns 'failed' without onError", async () => {
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => "failed" as const);

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
    const res = await result.current.run<{ affected: string[] }>(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: { affected: ["c9"] },
    }));

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.stage).toBe("committed_but_unreloaded");
      if (res.stage === "committed_but_unreloaded") {
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

describe("useEditorMutation — committed_but_unreloaded stage (A3)", () => {
  it("exposes committed_but_unreloaded as a distinct stage carrying data", () => {
    // Compile-time + runtime: a result of this shape is assignable and narrows.
    const r: MutationResult<{ n: number }> = {
      ok: false,
      stage: "committed_but_unreloaded",
      data: { n: 3 },
    };
    expect(r.ok).toBe(false);
    if (!r.ok && r.stage === "committed_but_unreloaded") {
      expect(r.data.n).toBe(3);
    }
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

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
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
        (onError?: (message: string) => void, expectedChapterId?: string) => Promise<ReloadOutcome>
      >()
      .mockResolvedValueOnce("superseded")
      .mockResolvedValueOnce("reloaded");
    projectEditor.reloadActiveChapter = reloadMock;
    projectEditor.getActiveChapter = vi.fn(() => chapterWithId("c2"));

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
    const res = await result.current.run(async () => ({
      clearCacheFor: ["c1", "c2"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: undefined,
    }));

    expect(res).toEqual({ ok: true, data: undefined });
    expect(reloadMock).toHaveBeenCalledTimes(2);
    // Second call pins to the now-active chapter id (I3, follow-up review
    // 2026-04-21): without the guard, a further chapter switch during the
    // retry's fetch lets a failed reload raise a lock banner on a third
    // chapter the mutation never targeted.
    expect(reloadMock.mock.calls[1]![1]).toBe("c2");
  });

  it("returns stage:'committed_but_unreloaded' when the I3 second reload fails", async () => {
    // If the second reload (targeting the now-active affected chapter) fails,
    // the editor must remain locked — otherwise the user could type over
    // server-committed content with the stale pre-mutation GET still on screen.
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi
      .fn<
        (onError?: (message: string) => void, expectedChapterId?: string) => Promise<ReloadOutcome>
      >()
      .mockResolvedValueOnce("superseded")
      .mockResolvedValueOnce("failed");
    projectEditor.getActiveChapter = vi.fn(() => chapterWithId("c2"));

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
    const res = await result.current.run<{ n: number }>(async () => ({
      clearCacheFor: ["c1", "c2"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: { n: 5 },
    }));

    expect(res).toEqual({ ok: false, stage: "committed_but_unreloaded", data: { n: 5 } });
  });

  it("does NOT re-reload when the now-active chapter was not in clearCacheFor (I3)", async () => {
    // If the user switched to an unrelated chapter (not in the mutation's
    // clearCacheFor), its content wasn't touched by the server-side
    // mutation and its editor state is independent. A second reload would
    // be a gratuitous GET and could clobber a draft in progress.
    const { editorRef, projectEditor } = buildHandles();
    const reloadMock = vi.fn(async () => "superseded" as const);
    projectEditor.reloadActiveChapter = reloadMock;
    projectEditor.getActiveChapter = vi.fn(() => chapterWithId("c3"));

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
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

  it("bypasses a pre-existing lock when reload was superseded (I1, review 2026-04-20)", async () => {
    // Revised semantics: "superseded" implies the user switched chapters
    // (or the chapter vanished) between the directive returning and the
    // reload firing — every "superseded" code path in useProjectEditor
    // either sees current.id !== expectedChapterId or a seq bump, both
    // of which only happen on chapter change. Any pre-existing lock
    // banner was scoped to the PRIOR chapter; leaving the unrelated
    // new editor read-only while EditorPage's useEffect clears the
    // banner on chapter change produced a dead "no banner, can't type"
    // state the user couldn't recover from without another switch or
    // refresh. The hook now dispatches MUTATION_SETTLED_SUPERSEDED, whose
    // reducer transition clears the lock and re-enables — regardless of a
    // pre-existing lock in the machine state.
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => "superseded" as const);
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "ch-1",
      data: undefined,
    }));

    // The lock-down setEditable(false) still happens on entry (via
    // safeSetEditable), but the re-enable is now machine-driven.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(vi.mocked(editorRef.current!.setEditable).mock.calls[0]![0]).toBe(false);
    expect(events.map((e) => e.type)).toEqual([
      "MUTATION_STARTED",
      "MUTATION_SETTLED_SUPERSEDED",
    ]);
    // Even starting from a locked machine, the superseded terminal clears
    // the lock and re-enables the (now unrelated) editor.
    const preLocked = editorMutationReducer(INITIAL_EDITOR_MUTATION_STATE, {
      type: "COMMITTED_UNRELOADED",
      message: "prior-chapter lock",
    });
    const final = events.reduce(editorMutationReducer, preLocked);
    expect(final.editable).toBe(true);
    expect(final.lock).toBeNull();
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

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

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

  it("absorbs an entry setEditable(false) mid-remount throw via safeSetEditable (A4)", async () => {
    // The entry lock-down now routes through safeSetEditable, which absorbs
    // and logs the TipTap mid-remount synchronous throw rather than bubbling
    // it as stage:"flush". The run proceeds; the data-loss defense for the
    // "editor left writable after a swallowed throw" case is EditorPage's
    // handleSaveLockGated (the save gate short-circuits PATCH while the lock
    // banner is up), not a stage:"flush" bail. The throw is logged once.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
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

      const { result } = renderHook(() =>
        useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }),
      );

      const first = await result.current.run(async () => ({
        clearCacheFor: [],
        reloadActiveChapter: false,
        data: undefined,
      }));
      // Throw absorbed; the run completes successfully.
      expect(first).toEqual({ ok: true, data: undefined });
      expect(warnSpy).toHaveBeenCalledWith("safeSetEditable: setEditable threw", err);

      // The latch must have cleared so a follow-up run proceeds normally.
      const second = await result.current.run(async () => ({
        clearCacheFor: [],
        reloadActiveChapter: false,
        data: undefined,
      }));
      expect(second).toEqual({ ok: true, data: undefined });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("releases inFlightRef in the finally and never re-enables imperatively (A4)", async () => {
    // The finally no longer makes an imperative setEditable(true): re-enable
    // is the terminal machine event (MUTATION_SETTLED_OK here), reconciled by
    // EditorPage's effect. The load-bearing invariant that survives is the
    // latch-release order — inFlightRef.current = false runs FIRST so a throw
    // in the terminal dispatch cannot strand the busy latch for the session.
    const { editorRef, projectEditor } = buildHandles();
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

    const first = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(first).toEqual({ ok: true, data: undefined });
    // Only the entry lock-down setEditable(false); no imperative re-enable.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);

    // The latch must have cleared so a follow-up run is not rejected as busy.
    const second = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(second).toEqual({ ok: true, data: undefined });
  });

  it("releases inFlightRef even when the terminal dispatch throws (latch order)", async () => {
    // Defensive: inFlightRef.current = false runs before the terminal
    // dispatch. If a (hypothetical) dispatch threw, the latch must already be
    // cleared so the next run() is not permanently rejected as busy.
    const { editorRef, projectEditor } = buildHandles();
    let dispatchCount = 0;
    const dispatch = (_e: EditorMutationEvent) => {
      dispatchCount += 1;
      // Throw on the terminal (second) dispatch of the first run only.
      if (dispatchCount === 2) {
        throw new Error("dispatch boom");
      }
    };
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

    // The terminal dispatch throws — run() rejects, but the latch is released.
    await expect(
      result.current.run(async () => ({
        clearCacheFor: [],
        reloadActiveChapter: false,
        data: undefined,
      })),
    ).rejects.toThrow("dispatch boom");

    // A follow-up run is not rejected as busy: the latch cleared first.
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

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

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
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

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

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

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
    // The new editor was locked post-mutate via safeSetEditable. Re-enable is
    // now the terminal machine event (reconciled by EditorPage's effect), so
    // the hook makes NO imperative setEditable(true) on the fresh editor — the
    // only call it sees is the post-mutate lock-down (false).
    expect(newEditor.setEditable).toHaveBeenCalledTimes(1);
    expect(vi.mocked(newEditor.setEditable).mock.calls[0]![0]).toBe(false);
  });

  it("does not re-lock the same editor that was already locked at entry", async () => {
    // Non-remount happy path: the same editor instance is present at entry
    // and at mutate-exit. The post-mutate re-read must not re-call
    // setEditable(false) (redundant work, and would make the call counts
    // harder to reason about for tests that assert the setEditable cadence).
    const { editor, editorRef, projectEditor } = buildHandles();
    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    // Exactly one setEditable(false) (entry lock-down) — no second lock from
    // the post-mutate re-read, and no imperative re-enable (machine-driven now).
    expect(editor.setEditable).toHaveBeenCalledTimes(1);
    expect(vi.mocked(editor.setEditable).mock.calls[0]![0]).toBe(false);
  });

  it("makes no imperative re-enable call on a stale captured reference (A4)", async () => {
    // If the entry-time editor is destroyed mid-run (chapter switch during
    // mutate), the hook no longer makes an imperative setEditable(true) at
    // all — re-enable is the terminal machine event, reconciled by
    // EditorPage's effect against editorRef.current. Here the captured editor
    // is nulled and a fresh one swapped in; the hook must NOT call
    // setEditable(true) on either, and the stale editor only ever saw its
    // entry lock-down (false).
    const { editor, editorRef, projectEditor } = buildHandles();

    const newEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(),
    };

    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

    await result.current.run(async () => {
      editorRef.current = newEditor;
      return { clearCacheFor: [], reloadActiveChapter: false, data: undefined };
    });

    // No imperative re-enable anywhere — the terminal event drives it.
    expect(newEditor.setEditable).not.toHaveBeenCalledWith(true);
    expect(vi.mocked(editor.setEditable).mock.calls).toEqual([[false]]);
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
  });

  it("absorbs a post-mutate setEditable(false) throw via safeSetEditable; reload still runs (A4)", async () => {
    // BEFORE A4: the post-mutate re-lock did `editorAfterMutate.setEditable(false)`
    // inside a try/catch; a throw promoted to stage:"reload" and SKIPPED the
    // reload (couldn't safely load fresh state into an editor we failed to lock).
    //
    // AFTER A4: the lock-down routes through safeSetEditable, which absorbs and
    // logs the TipTap mid-remount throw (the inline catch is replaced by this
    // single wrapper — design "Error handling"). markClean + cancelPendingSaves
    // still succeed, so the hook proceeds to clear the cache and reload. A
    // successful reload puts fresh server content on screen and the terminal
    // RELOADED event re-enables — no stale pre-mutation content remains to type
    // over. The data-loss backstop for the residual mount→reload window is
    // EditorPage's handleSaveLockGated (see editorSafeOps.ts rationale).
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
      const events: EditorMutationEvent[] = [];
      const dispatch = (e: EditorMutationEvent) => events.push(e);
      const { result } = renderHook(() =>
        useEditorMutation({ editorRef, projectEditor, dispatch }),
      );

      const res = await result.current.run(async () => {
        editorRef.current = throwingEditor;
        return {
          clearCacheFor: ["ch-1"],
          reloadActiveChapter: true,
          reloadChapterId: "ch-1",
          data: { payload: "committed" } as const,
        };
      });

      expect(res).toEqual({ ok: true, data: { payload: "committed" } });
      // safeSetEditable logged the swallowed throw.
      expect(warnSpy).toHaveBeenCalledWith(
        "safeSetEditable: setEditable threw",
        expect.any(Error),
      );
      // Cache clear runs (server committed) AND the reload runs (fresh content).
      expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["ch-1"]);
      expect(reloadSpy).toHaveBeenCalled();
      expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "RELOADED"]);
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
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

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
      // The throw was absorbed and logged by safeSetEditable (the inline
      // re-lock catch no longer fires for a setEditable throw).
      expect(warnSpy).toHaveBeenCalledWith(
        "safeSetEditable: setEditable threw",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("escalates a re-lock catch to committed_but_unreloaded when active chapter is in clearCacheFor (I5, review 2026-04-21)", async () => {
    // I1 review (above) relaxed the re-lock bail to ok:true when the
    // directive's reloadActiveChapter was false — on the assumption the
    // new editor is on an unrelated chapter. But if the user switched
    // between AFFECTED chapters mid-mutate, the new editor IS on a chapter
    // in clearCacheFor: its cache was just wiped, and whatever
    // handleSelectChapter's GET loaded may be pre-mutation content. The
    // next keystroke would PATCH stale content over the server commit.
    // Escalate to stage:"committed_but_unreloaded" so callers raise the lock.
    //
    // A4 NOTE: the re-lock catch now fires on a markClean / cancelPendingSaves
    // throw (a setEditable throw is absorbed by safeSetEditable and no longer
    // reaches this catch). markClean throwing exercises the SAME catch and the
    // SAME I5 escalation branch this test guards.
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };
    projectEditor.getActiveChapter = vi.fn(() => chapterWithId("ch-1"));

    const throwingEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(() => {
        throw new Error("markClean mid-remount throw");
      }),
      setEditable: vi.fn(),
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

      const res = await result.current.run(async () => {
        editorRef.current = throwingEditor;
        return {
          clearCacheFor: ["ch-1"],
          reloadActiveChapter: false,
          data: { replaced_count: 1 } as const,
        };
      });

      expect(res.ok).toBe(false);
      if (!res.ok && res.stage === "committed_but_unreloaded") {
        expect(res.data).toEqual({ replaced_count: 1 });
      } else {
        throw new Error(`expected stage:'committed_but_unreloaded', got ${JSON.stringify(res)}`);
      }
      // Cache clear still runs — same invariant as the ok:true branch.
      expect(vi.mocked(clearAllCachedContent)).toHaveBeenCalledWith(["ch-1"]);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("cancelPendingSaves runs at entry even when entry setEditable(false) throws (S2)", async () => {
    // S2: cancelPendingSaves runs at entry BEFORE the first setEditable, so a
    // pre-existing backoff save is aborted before we commit to the mutation.
    //
    // A4: the entry setEditable(false) now routes through safeSetEditable,
    // which absorbs and logs the TipTap mid-remount throw rather than bailing
    // to stage:"flush". The run proceeds to ok:true; the data-loss backstop is
    // EditorPage's handleSaveLockGated, not the (removed) flush bail. The
    // entry-side cancelPendingSaves still fires regardless.
    const { projectEditor } = buildHandles();
    const cancelSpy = vi.fn();
    projectEditor.cancelPendingSaves = cancelSpy;

    const throwingEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(() => {
        throw new Error("mid-remount throw");
      }),
    };
    const editorRef: MutableRefObject<EditorHandle | null> = { current: throwingEditor };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

      const res = await result.current.run(async () => ({
        clearCacheFor: [],
        reloadActiveChapter: false,
        data: undefined,
      }));

      // The swallowed throw no longer aborts the run.
      expect(res).toEqual({ ok: true, data: undefined });
      // cancelPendingSaves must have run despite the entry setEditable throw —
      // otherwise a save in backoff still commits post-throw.
      expect(cancelSpy).toHaveBeenCalled();
      // safeSetEditable absorbed and logged the throw.
      expect(warnSpy).toHaveBeenCalledWith(
        "safeSetEditable: setEditable threw",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("S5 late-lock catch logs when the nested cancelPendingSaves throws", async () => {
    // Defensive inner try/catch inside the S5 late-lock catch.
    // cancelPendingSaves is a ref+setState touch today but a future
    // refactor could throw; this inner catch ensures the original
    // lock-fail error is still reported and the stage decision stands.
    const { projectEditor } = buildHandles();

    // First two cancelPendingSaves calls succeed (S2 entry, settle
    // phase); the third — inside the S5 late-lock catch — throws.
    let cancelCallCount = 0;
    projectEditor.cancelPendingSaves = vi.fn(() => {
      cancelCallCount++;
      if (cancelCallCount >= 3) throw new Error("cancel boom");
    });

    const throwingLate: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(() => {
        throw new Error("late-mount setEditable boom");
      }),
    };
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };

    vi.mocked(clearAllCachedContent).mockImplementation(() => {
      editorRef.current = throwingLate;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
      const res = await result.current.run(async () => ({
        clearCacheFor: ["c1"],
        reloadActiveChapter: false,
        data: { replaced_count: 0 } as const,
      }));
      // Directive said no reload — S5 late-lock failure returns ok:true.
      expect(res.ok).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        "useEditorMutation: cancelPendingSaves threw during S5 late-lock catch",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("main re-lock-fail catch logs when the nested cancelPendingSaves throws", async () => {
    // Same defensive inner try/catch as S5 above, but on the primary
    // post-mutate re-lock path (editorAfterMutate !== null).
    const { projectEditor } = buildHandles();

    // S2 entry + settle-phase + post-mutate inner all succeed; the
    // one inside the re-lock-fail catch throws.
    let cancelCallCount = 0;
    projectEditor.cancelPendingSaves = vi.fn(() => {
      cancelCallCount++;
      // Call order when setEditable throws in the re-lock try-block:
      // S2 entry (1), settle phase (2), re-lock catch inner cancel (3).
      // The in-try cancelPendingSaves (would be 3 if setEditable
      // succeeded) is never reached because setEditable throws first.
      if (cancelCallCount >= 3) throw new Error("cancel boom");
    });

    const newEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn((flag) => {
        if (flag === false) throw new Error("re-lock boom");
      }),
    };
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
      await result.current.run(async () => {
        editorRef.current = newEditor;
        return {
          clearCacheFor: ["c1"],
          reloadActiveChapter: false,
          data: { replaced_count: 0 } as const,
        };
      });
      expect(warnSpy).toHaveBeenCalledWith(
        "useEditorMutation: cancelPendingSaves threw during re-lock-fail catch",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("S5 late-lock catch with reload directive promotes to committed_but_unreloaded", async () => {
    // Covers the catch path inside the S5 late-mount re-read block. When the
    // late-mounted editor's lock-down fails, we cancel any pending save
    // (matching the main re-lock-fail discipline) and promote to
    // stage:"committed_but_unreloaded".
    //
    // A4: a setEditable throw is now absorbed by safeSetEditable and no longer
    // reaches this catch; markClean throwing exercises the SAME S5 catch and
    // promotion branch this test guards.
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };
    const cancelSpy = vi.fn();
    projectEditor.cancelPendingSaves = cancelSpy;

    const throwingLate: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(() => {
        throw new Error("late-mount markClean throw");
      }),
      setEditable: vi.fn(),
    };
    vi.mocked(clearAllCachedContent).mockImplementation(() => {
      editorRef.current = throwingLate;
    });
    const reloadSpy = vi.fn(async () => "reloaded" as const);
    projectEditor.reloadActiveChapter = reloadSpy;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
      const res = await result.current.run(async () => ({
        clearCacheFor: ["c1"],
        reloadActiveChapter: true,
        reloadChapterId: "c1",
        data: { payload: "x" } as const,
      }));
      expect(res.ok).toBe(false);
      if (!res.ok && res.stage === "committed_but_unreloaded") {
        expect(res.data).toEqual({ payload: "x" });
      } else {
        throw new Error(`expected committed_but_unreloaded, got ${JSON.stringify(res)}`);
      }
      // The reload was skipped — we can't safely load fresh server state
      // into an editor we couldn't re-lock.
      expect(reloadSpy).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        "useEditorMutation: failed to lock late-mounted editor (S5)",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("S5 late-lock throw with reloadActiveChapter:false returns ok:true", async () => {
    // When the directive did not request a reload (e.g. 0-replace),
    // a late-lock throw should still honor the directive and return
    // ok:true — same discipline as the main re-lock-fail I1 branch.
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };

    const throwingLate: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(() => {
        throw new Error("late-mount throw");
      }),
    };
    vi.mocked(clearAllCachedContent).mockImplementation(() => {
      editorRef.current = throwingLate;
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
      const res = await result.current.run(async () => ({
        clearCacheFor: ["c1"],
        reloadActiveChapter: false,
        data: { replaced_count: 0 } as const,
      }));
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data).toEqual({ replaced_count: 0 });
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("second reloadActiveChapter throw surfaces as stage:committed_but_unreloaded (S4)", async () => {
    // Covers the catch path on the "superseded-then-retry" branch:
    // first reload returns superseded, getActiveChapter is in
    // clearCacheFor, then the second reload throws. Must be
    // classified as reloadFailed (not reloadSuperseded) so the
    // caller raises the persistent lock banner.
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.getActiveChapter = vi.fn(() => chapterWithId("c2"));

    let callCount = 0;
    projectEditor.reloadActiveChapter = vi.fn(async () => {
      callCount++;
      if (callCount === 1) return "superseded" as const;
      throw new Error("second reload boom");
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
      const res = await result.current.run(async () => ({
        clearCacheFor: ["c1", "c2"],
        reloadActiveChapter: true,
        reloadChapterId: "c1",
        data: { payload: "x" } as const,
      }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.stage).toBe("committed_but_unreloaded");
      expect(warnSpy).toHaveBeenCalledWith(
        "useEditorMutation: second reloadActiveChapter threw",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("locks an editor that mounts between cache-clear and reload (S5)", async () => {
    // If editorAfterMutate is null (unmount-during-mutate window),
    // the hook skipped the re-lock entirely. A new editor that
    // mounts in the pre-reload cache-clear step starts editable=true
    // and unmarked — any keystroke in that window races the reload
    // GET and PATCHes pre-reload content back over the server change.
    // Re-read the ref right before the reload call so the late-mounted
    // editor is locked before the GET begins.
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };

    const lateMountedEditor: EditorHandle = {
      flushSave: vi.fn(async () => true),
      editor: null,
      insertImage: vi.fn(),
      markClean: vi.fn(),
      setEditable: vi.fn(),
    };

    // Simulate the TipTap mount happening during the cache-clear step,
    // after the post-mutate re-read already observed null.
    vi.mocked(clearAllCachedContent).mockImplementation(() => {
      editorRef.current = lateMountedEditor;
    });

    projectEditor.reloadActiveChapter = vi.fn(async () => {
      // The pre-reload re-read must have locked the late-mounted
      // editor BEFORE this reload call fires.
      expect(lateMountedEditor.setEditable).toHaveBeenCalledWith(false);
      return "reloaded" as const;
    });

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

    await result.current.run(async () => {
      // editorRef is still null at mutate return; the editor mounts
      // during clearAllCachedContent (simulated above).
      return {
        clearCacheFor: ["c1"],
        reloadActiveChapter: true,
        reloadChapterId: "c1",
        data: undefined,
      };
    });

    expect(lateMountedEditor.setEditable).toHaveBeenCalledWith(false);
  });

  it("reloadActiveChapter throw surfaces as stage:committed_but_unreloaded (S4)", async () => {
    // Today reloadActiveChapter catches internally and returns "failed",
    // but a future refactor that escapes a throw past ReloadOutcome
    // would bypass the MutationResult contract — callers await
    // mutation.run() without a try/catch and expect the discriminated
    // union. Treat a throw the same as "failed": set reloadFailed and
    // return stage:"committed_but_unreloaded".
    const { editorRef, projectEditor } = buildHandles();
    const reloadSpy = vi.fn(async () => {
      throw new Error("reload boom");
    });
    projectEditor.reloadActiveChapter = reloadSpy as typeof projectEditor.reloadActiveChapter;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

      const res = await result.current.run(async () => ({
        clearCacheFor: ["c1"],
        reloadActiveChapter: true,
        reloadChapterId: "c1",
        data: { payload: "committed" } as const,
      }));

      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.stage).toBe("committed_but_unreloaded");
        if (res.stage === "committed_but_unreloaded") {
          expect(res.data).toEqual({ payload: "committed" });
        }
      }
      expect(warnSpy).toHaveBeenCalledWith(
        "useEditorMutation: reloadActiveChapter threw",
        expect.any(Error),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("re-cancels pending saves on the freshly-mounted editor so a keystroke save can't commit (S1)", async () => {
    // The post-mutate re-lock try-block runs: safeSetEditable(false),
    // markClean, cancelPendingSaves — in that order. Any keystroke that
    // scheduled a debounced save on the freshly-mounted editor between mount
    // and lock-down must be cancelled; otherwise it commits pre-mutation
    // content over the server commit.
    //
    // A4: the setEditable(false) lock-down now routes through safeSetEditable
    // (the throw is absorbed and logged), so the in-try cancelPendingSaves
    // still runs and performs this re-cancel.
    const { projectEditor } = buildHandles();
    const editorRef: MutableRefObject<EditorHandle | null> = { current: null };
    const cancelSpy = vi.fn();
    projectEditor.cancelPendingSaves = cancelSpy;

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
      const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));

      await result.current.run(async () => {
        editorRef.current = throwingEditor;
        return {
          clearCacheFor: ["ch-1"],
          reloadActiveChapter: true,
          reloadChapterId: "ch-1",
          data: undefined,
        };
      });

      const cancelCalls = cancelSpy.mock.calls.length;
      // At least: the pre-mutate cancelPendingSaves (entry/S2) plus the
      // post-mutate re-lock cancel on the freshly-mounted editor.
      expect(cancelCalls).toBeGreaterThanOrEqual(2);
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

    const { result } = renderHook(() => useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }));
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

describe("useEditorMutation — lock gating now lives in the reducer (A4/A6)", () => {
  // The hook no longer takes an isLocked predicate; the "don't re-enable
  // under a persistent banner" guard moved into the reducer's
  // MUTATION_SETTLED_OK transition (editable := lock === null). The hook
  // ALWAYS emits its terminal event; the machine decides whether that
  // re-enables. These tests reduce the captured events from a seeded
  // machine state to verify the user-visible editable outcome.
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // A locked starting state: a prior committed_but_unreloaded raised the banner.
  const lockedState = () =>
    editorMutationReducer(INITIAL_EDITOR_MUTATION_STATE, {
      type: "COMMITTED_UNRELOADED",
      message: "refresh the page",
    });

  it("MUTATION_SETTLED_OK keeps the editor locked when a banner is up (no reload)", async () => {
    // Simulates a prior reload-failure that raised EditorPage's persistent
    // lock banner. A subsequent successful no-reload mutation must NOT
    // re-enable the editor — typing into re-enabled-but-stale content would
    // silently overwrite the server-committed change on the next auto-save.
    const { editorRef, projectEditor } = buildHandles();
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

    const res = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(res).toEqual({ ok: true, data: undefined });
    // Lock-down (false) still fires on entry; no imperative re-enable.
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
    // Reduced from a locked machine: the banner survives and editable stays false.
    const final = events.reduce(editorMutationReducer, lockedState());
    expect(final.editable).toBe(false);
    expect(final.lock).not.toBeNull();
  });

  it("MUTATION_SETTLED_OK re-enables the editor when no banner is up", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
    const final = events.reduce(editorMutationReducer, INITIAL_EDITOR_MUTATION_STATE);
    expect(final.editable).toBe(true);
    expect(final.lock).toBeNull();
  });

  it("RELOADED clears a pre-existing lock and re-enables (recovery path, I2)", async () => {
    // Recovery path: after a prior reload-failure set the lock banner, a
    // subsequent mutation that successfully reloads the server state
    // supersedes the lock. The displayed content now matches the server, so
    // the hook emits RELOADED, whose reducer transition clears the lock and
    // re-enables.
    const { editorRef, projectEditor } = buildHandles();
    projectEditor.reloadActiveChapter = vi.fn(async () => "reloaded" as const);
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: undefined,
    }));

    expect(projectEditor.reloadActiveChapter).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "RELOADED"]);
    const final = events.reduce(editorMutationReducer, lockedState());
    expect(final.editable).toBe(true);
    expect(final.lock).toBeNull();
  });

  it("stays locked when a banner is up AND no reload was performed (I2)", async () => {
    // Guardrail: a mutation that succeeds without reloading must still honor
    // the lock. Without the reload there is no fresh server state on screen,
    // so re-enabling would let the user auto-save stale content over the
    // original server-committed change.
    const { editorRef, projectEditor } = buildHandles();
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    expect(projectEditor.reloadActiveChapter).not.toHaveBeenCalled();
    expect(editorRef.current!.setEditable).toHaveBeenCalledTimes(1);
    expect(editorRef.current!.setEditable).toHaveBeenLastCalledWith(false);
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
    const final = events.reduce(editorMutationReducer, lockedState());
    expect(final.editable).toBe(false);
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

    const getActiveChapterStub = vi.fn(() => null as Chapter | null);
    const { result, rerender } = renderHook(
      (props: { cancel: () => void; reload: () => Promise<ReloadOutcome> }) =>
        useEditorMutation({
          editorRef,
          projectEditor: {
            cancelPendingSaves: props.cancel,
            reloadActiveChapter: props.reload,
            getActiveChapter: getActiveChapterStub,
          },
          dispatch: () => {},
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

describe("useEditorMutation — synchronous lock-down before first await (A7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks input synchronously: setEditable(false) runs before the first await (flushSave)", async () => {
    // Regression guard (Decided Q3): the entry lock-down via safeSetEditable
    // runs synchronously — before the first await (flushSave). TipTap rejects
    // user keystrokes as soon as run() is called, with no microtask gap where
    // a keystroke could slip through.
    const { editorRef, projectEditor } = buildHandles();
    const order: string[] = [];

    editorRef.current!.setEditable = vi.fn((v: boolean) => {
      order.push(`setEditable(${v})`);
    });
    editorRef.current!.flushSave = vi.fn(async () => {
      order.push("flushSave");
      return true;
    });

    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch: () => {} }),
    );

    await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));

    // Guard against vacuous pass: both entries must be present.
    expect(order).toContain("setEditable(false)");
    expect(order).toContain("flushSave");
    // The lock-down setEditable(false) precedes flushSave (the first await),
    // proving TipTap input is blocked before any yield (Decided Q3).
    expect(order.indexOf("setEditable(false)")).toBeLessThan(order.indexOf("flushSave"));
  });
});

describe("useEditorMutation — machine dispatch (A4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches MUTATION_STARTED then MUTATION_SETTLED_OK on a no-reload happy path", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );
    const res = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(res).toEqual({ ok: true, data: undefined });
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
  });

  it("on reload-GET failure: returns committed_but_unreloaded and dispatches NO re-enable", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    projectEditor.reloadActiveChapter = vi.fn(async () => "failed" as const);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );
    const res = await result.current.run(async () => ({
      clearCacheFor: ["c1"],
      reloadActiveChapter: true,
      reloadChapterId: "c1",
      data: { x: 1 },
    }));
    expect(res).toEqual({ ok: false, stage: "committed_but_unreloaded", data: { x: 1 } });
    // hook leaves editable:false (no terminal re-enable); consumer raises the banner.
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED"]);
  });

  it("re-entrancy: a second run() while busy returns stage:busy and dispatches nothing", async () => {
    const { editorRef, projectEditor } = buildHandles();
    const events: EditorMutationEvent[] = [];
    const dispatch = (e: EditorMutationEvent) => events.push(e);
    const { result } = renderHook(() =>
      useEditorMutation({ editorRef, projectEditor, dispatch }),
    );
    let release!: () => void;
    const first = result.current.run(
      () =>
        new Promise<MutationDirective>(
          (r) =>
            (release = () =>
              r({ clearCacheFor: [], reloadActiveChapter: false, data: undefined })),
        ),
    );
    // Yield so the first run latches inFlightRef before the second call.
    await Promise.resolve();
    await Promise.resolve();
    const second = await result.current.run(async () => ({
      clearCacheFor: [],
      reloadActiveChapter: false,
      data: undefined,
    }));
    expect(second).toEqual({ ok: false, stage: "busy" });
    // The second (busy) run dispatched nothing; only the first's MUTATION_STARTED.
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED"]);
    release();
    await first;
    // After the first settles, its terminal event has landed.
    expect(events.map((e) => e.type)).toEqual(["MUTATION_STARTED", "MUTATION_SETTLED_OK"]);
  });
});
