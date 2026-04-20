import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useSnapshotState } from "../hooks/useSnapshotState";
import { api } from "../api/client";
import type { Chapter, SnapshotListItem, SnapshotRow } from "@smudge/shared";

vi.mock("../hooks/useContentCache", () => ({
  getCachedContent: vi.fn().mockReturnValue(null),
  setCachedContent: vi.fn().mockReturnValue(true),
  clearCachedContent: vi.fn(),
  clearAllCachedContent: vi.fn(),
}));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    ...actual,
    api: {
      snapshots: {
        list: vi.fn(),
        get: vi.fn(),
        restore: vi.fn(),
      },
    },
  };
});

function makeListItem(overrides: Partial<SnapshotListItem> = {}): SnapshotListItem {
  return {
    id: "snap-1",
    chapter_id: "ch-1",
    label: "My snapshot",
    word_count: 500,
    is_auto: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeSnapshotRow(overrides: Partial<SnapshotRow> = {}): SnapshotRow {
  return {
    id: "snap-1",
    chapter_id: "ch-1",
    label: "My snapshot",
    content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
    word_count: 500,
    is_auto: false,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("useSnapshotState", () => {
  beforeEach(() => {
    vi.mocked(api.snapshots.list).mockResolvedValue([]);
    vi.mocked(api.snapshots.get).mockResolvedValue(makeSnapshotRow());
    vi.mocked(api.snapshots.restore).mockResolvedValue({} as never);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("starts with panel closed and no viewing snapshot", () => {
    const { result } = renderHook(() => useSnapshotState("ch-1"));
    expect(result.current.snapshotPanelOpen).toBe(false);
    expect(result.current.viewingSnapshot).toBeNull();
  });

  it("toggles panel open and closed", () => {
    const { result } = renderHook(() => useSnapshotState("ch-1"));
    act(() => result.current.toggleSnapshotPanel());
    expect(result.current.snapshotPanelOpen).toBe(true);
    act(() => result.current.toggleSnapshotPanel());
    expect(result.current.snapshotPanelOpen).toBe(false);
  });

  it("fetches snapshot count on mount", async () => {
    vi.mocked(api.snapshots.list).mockResolvedValue([
      makeListItem(),
      makeListItem({ id: "snap-2" }),
    ]);
    const { result } = renderHook(() => useSnapshotState("ch-1"));
    // Wait for the async effect
    await vi.waitFor(() => {
      expect(result.current.snapshotCount).toBe(2);
    });
  });

  it("keeps count null when chapterId is null", () => {
    const { result } = renderHook(() => useSnapshotState(null));
    expect(result.current.snapshotCount).toBeNull();
    expect(api.snapshots.list).not.toHaveBeenCalled();
  });

  it("viewSnapshot fetches full snapshot and sets viewingSnapshot", async () => {
    const row = makeSnapshotRow({ id: "snap-42", label: "Test" });
    vi.mocked(api.snapshots.get).mockResolvedValue(row);

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    await act(async () => {
      await result.current.viewSnapshot({
        id: "snap-42",
        label: "Test",
        created_at: row.created_at,
      });
    });

    expect(api.snapshots.get).toHaveBeenCalledWith("snap-42");
    expect(result.current.viewingSnapshot).not.toBeNull();
    expect(result.current.viewingSnapshot!.id).toBe("snap-42");
    expect(result.current.viewingSnapshot!.label).toBe("Test");
    expect(result.current.viewingSnapshot!.content).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("viewSnapshot returns not_found when snapshot is gone (404)", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.snapshots.get).mockRejectedValue(
      new ApiRequestError("missing", 404, "NOT_FOUND"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; reason?: string } = { ok: true };
    await act(async () => {
      r = await result.current.viewSnapshot({
        id: "snap-gone",
        label: null,
        created_at: new Date().toISOString(),
      });
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_found");
    expect(result.current.viewingSnapshot).toBeNull();
  });

  it("viewSnapshot returns corrupt_snapshot when full.content is malformed JSON", async () => {
    vi.mocked(api.snapshots.get).mockResolvedValue({
      id: "snap-1",
      chapter_id: "ch-1",
      label: null,
      content: "{not valid json",
      word_count: 0,
      is_auto: false,
      created_at: new Date().toISOString(),
    });

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; reason?: string } = { ok: true };
    await act(async () => {
      r = await result.current.viewSnapshot({
        id: "snap-1",
        label: null,
        created_at: new Date().toISOString(),
      });
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("corrupt_snapshot");
  });

  it.each([
    ["null literal", "null"],
    ["number literal", "42"],
    ["string literal", '"hello"'],
    ["array literal", "[1,2,3]"],
  ])(
    "viewSnapshot returns corrupt_snapshot when content parses as %s (not a TipTap doc)",
    async (_label, payload) => {
      // Server-side restoreSnapshot gates on TipTapDocSchema.safeParse;
      // the client view path used to accept any valid JSON here, so a
      // hand-edited or corrupted snapshot whose content was "42" / "null"
      // / "[1,2,3]" / etc. would parse and then crash the read-only
      // preview editor when handed to TipTap.
      vi.mocked(api.snapshots.get).mockResolvedValue({
        id: "snap-1",
        chapter_id: "ch-1",
        label: null,
        content: payload,
        word_count: 0,
        is_auto: false,
        created_at: new Date().toISOString(),
      });

      const { result } = renderHook(() => useSnapshotState("ch-1"));
      let r: { ok: boolean; reason?: string } = { ok: true };
      await act(async () => {
        r = await result.current.viewSnapshot({
          id: "snap-1",
          label: null,
          created_at: new Date().toISOString(),
        });
      });

      expect(r.ok).toBe(false);
      expect(r.reason).toBe("corrupt_snapshot");
    },
  );

  it("viewSnapshot maps 2xx BAD_JSON to corrupt_snapshot, not network", async () => {
    // GET-side BAD_JSON means the snapshot response body was unreadable —
    // no "maybe committed" ambiguity (GETs don't commit). Previously this
    // surfaced as reason:"network", inviting a pointless retry. Mapping
    // to corrupt_snapshot lets the caller render "this snapshot is
    // corrupt" copy instead of "check your connection."
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.snapshots.get).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; reason?: string } = { ok: true };
    await act(async () => {
      r = await result.current.viewSnapshot({
        id: "snap-1",
        label: null,
        created_at: new Date().toISOString(),
      });
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("corrupt_snapshot");
  });

  it("exitSnapshotView clears the viewing snapshot", async () => {
    const row = makeSnapshotRow();
    vi.mocked(api.snapshots.get).mockResolvedValue(row);

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    await act(async () => {
      await result.current.viewSnapshot({ id: "snap-1", label: null, created_at: row.created_at });
    });
    expect(result.current.viewingSnapshot).not.toBeNull();

    act(() => result.current.exitSnapshotView());
    expect(result.current.viewingSnapshot).toBeNull();
  });

  it("restoreSnapshot calls api and clears viewing snapshot on success", async () => {
    vi.mocked(api.snapshots.restore).mockResolvedValue({} as never);
    vi.mocked(api.snapshots.list).mockResolvedValue([makeListItem()]);

    const { result } = renderHook(() => useSnapshotState("ch-1"));

    // First view a snapshot
    await act(async () => {
      await result.current.viewSnapshot({
        id: "snap-1",
        label: "Test",
        created_at: new Date().toISOString(),
      });
    });
    expect(result.current.viewingSnapshot).not.toBeNull();

    // Now restore
    let r: { ok: boolean; reason?: string } = { ok: false };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(true);
    expect(api.snapshots.restore).toHaveBeenCalledWith("snap-1");
    expect(result.current.viewingSnapshot).toBeNull();
  });

  it("restoreSnapshot flags staleChapterSwitch when chapter changes mid-flight", async () => {
    // Server-side restore succeeds, but the user switched chapters before the
    // promise resolved. We must signal staleChapterSwitch so the caller
    // doesn't reload the now-active (different) chapter.
    let resolveRestore: (v: Chapter) => void = () => {};
    vi.mocked(api.snapshots.restore).mockImplementationOnce(
      () =>
        new Promise<Chapter>((resolve) => {
          resolveRestore = resolve;
        }),
    );

    const { result, rerender } = renderHook(({ id }) => useSnapshotState(id), {
      initialProps: { id: "ch-1" as string | null },
    });

    let restorePromise: Promise<{ ok: boolean; staleChapterSwitch?: boolean }> = Promise.resolve({
      ok: false,
    });
    act(() => {
      restorePromise = result.current.restoreSnapshot("snap-1");
    });

    // Switch chapters mid-flight. The chapterId effect bumps chapterSeqRef.
    rerender({ id: "ch-2" });

    let r: { ok: boolean; staleChapterSwitch?: boolean } = { ok: false };
    await act(async () => {
      resolveRestore({} as Chapter);
      r = await restorePromise;
    });

    expect(r.ok).toBe(true);
    expect(r.staleChapterSwitch).toBe(true);
    // Cache for the restoring chapter must be cleared so next navigation
    // loads the server's restored content rather than stale drafts.
    const { clearCachedContent } = await import("../hooks/useContentCache");
    expect(clearCachedContent).toHaveBeenCalledWith("ch-1");
  });

  it("restoreSnapshot does NOT flag stale on A→B→A round-trip (current chapter IS the restored one)", async () => {
    // User starts restore on ch-1, switches to ch-2 mid-flight, then back to
    // ch-1 before the server responds. seq has moved twice, but the current
    // active chapter equals the restored chapter — caller should reload
    // the editor, NOT skip the reload.
    let resolveRestore: (v: Chapter) => void = () => {};
    vi.mocked(api.snapshots.restore).mockImplementationOnce(
      () =>
        new Promise<Chapter>((resolve) => {
          resolveRestore = resolve;
        }),
    );
    vi.mocked(api.snapshots.list).mockResolvedValue([]);

    const { result, rerender } = renderHook(({ id }) => useSnapshotState(id), {
      initialProps: { id: "ch-1" as string | null },
    });

    let restorePromise: Promise<{
      ok: boolean;
      staleChapterSwitch?: boolean;
      restoredChapterId?: string;
    }> = Promise.resolve({ ok: false });
    act(() => {
      restorePromise = result.current.restoreSnapshot("snap-1");
    });

    // A → B → A
    rerender({ id: "ch-2" });
    rerender({ id: "ch-1" });

    let r: { ok: boolean; staleChapterSwitch?: boolean; restoredChapterId?: string } = {
      ok: false,
    };
    await act(async () => {
      resolveRestore({} as Chapter);
      r = await restorePromise;
    });

    expect(r.ok).toBe(true);
    // Key assertion: seq moved but current chapter === restoring chapter.
    expect(r.staleChapterSwitch).toBeFalsy();
    expect(r.restoredChapterId).toBe("ch-1");
  });

  it("restoreSnapshot returns ok=false on generic failure", async () => {
    vi.mocked(api.snapshots.restore).mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; reason?: string } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("unknown");
  });

  it("restoreSnapshot surfaces corrupt_snapshot reason on 400 CORRUPT_SNAPSHOT", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.snapshots.restore).mockRejectedValue(
      new ApiRequestError("Corrupt", 400, "CORRUPT_SNAPSHOT"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; reason?: string; message?: string } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("corrupt_snapshot");
  });

  it("restoreSnapshot surfaces not_found reason on 404", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.snapshots.restore).mockRejectedValue(
      new ApiRequestError("Snapshot or chapter not found.", 404, "NOT_FOUND"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; reason?: string; message?: string } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_found");
  });

  it("restoreSnapshot surfaces possibly_committed reason on 2xx BAD_JSON (C2)", async () => {
    // apiFetch throws ApiRequestError(status=2xx, code="BAD_JSON") when a
    // 2xx response body fails to parse. The server almost certainly
    // committed the restore (and its auto-snapshot) but the client cannot
    // verify. Previously this fell through to reason:"network" — the
    // EditorPage handler then surfaced the generic "retry" banner and
    // re-enabled the editor. Auto-save would then silently revert the
    // committed restore. The dedicated "possibly_committed" reason lets
    // the caller route to a persistent lock banner instead.
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.snapshots.restore).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; reason?: string; message?: string } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("possibly_committed");
  });

  it("restoreSnapshot surfaces aborted reason on ApiRequestError ABORTED (I7)", async () => {
    // viewSnapshot already treats ABORTED as a silent no-op. Mirror it
    // for restoreSnapshot — without the dedicated reason, ABORTED falls
    // through to the network branch and the caller's banner says "check
    // your connection", which is misleading. No path triggers ABORTED on
    // restore today; this test guards the contract for future wiring.
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.snapshots.restore).mockRejectedValue(
      new ApiRequestError("Request aborted", 0, "ABORTED"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; reason?: string } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    expect(r.reason).toBe("aborted");
  });

  it("leaves count null when list fetch fails so badge stays hidden", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.snapshots.list).mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useSnapshotState("ch-1"));

    // After a failed fetch, count remains null (unknown) rather than being
    // forced to 0 — that would falsely claim "no snapshots" on a network blip.
    // Use a small delay to let the rejected promise microtask settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.snapshotCount).toBeNull();
    warnSpy.mockRestore();
  });
});
