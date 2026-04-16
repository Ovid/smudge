import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useSnapshotState } from "../hooks/useSnapshotState";
import { api } from "../api/client";
import type { SnapshotListItem, SnapshotRow } from "@smudge/shared";

vi.mock("../api/client", () => ({
  api: {
    snapshots: {
      list: vi.fn(),
      get: vi.fn(),
      restore: vi.fn(),
    },
  },
}));

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

  it("resets count to 0 when chapterId is null", () => {
    const { result } = renderHook(() => useSnapshotState(null));
    expect(result.current.snapshotCount).toBe(0);
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
    let ok: boolean = false;
    await act(async () => {
      ok = await result.current.restoreSnapshot("snap-1");
    });

    expect(ok).toBe(true);
    expect(api.snapshots.restore).toHaveBeenCalledWith("snap-1");
    expect(result.current.viewingSnapshot).toBeNull();
  });

  it("restoreSnapshot returns false on failure", async () => {
    vi.mocked(api.snapshots.restore).mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let ok: boolean = true;
    await act(async () => {
      ok = await result.current.restoreSnapshot("snap-1");
    });

    expect(ok).toBe(false);
  });

  it("silently handles list fetch failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.snapshots.list).mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useSnapshotState("ch-1"));

    // Should not throw, count stays at 0
    await vi.waitFor(() => {
      expect(result.current.snapshotCount).toBe(0);
    });
    warnSpy.mockRestore();
  });
});
