import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/react";
import { useSnapshotState } from "../hooks/useSnapshotState";
import { api, ApiRequestError } from "../api/client";
import { mapApiError } from "../errors";
import { STRINGS } from "../strings";
import { SNAPSHOT_ERROR_CODES } from "@smudge/shared";
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

    expect(api.snapshots.get).toHaveBeenCalledWith("snap-42", expect.any(AbortSignal));
    expect(result.current.viewingSnapshot).not.toBeNull();
    expect(result.current.viewingSnapshot!.id).toBe("snap-42");
    expect(result.current.viewingSnapshot!.label).toBe("Test");
    expect(result.current.viewingSnapshot!.content).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("viewSnapshot returns not-found error when snapshot is gone (404)", async () => {
    vi.mocked(api.snapshots.get).mockRejectedValue(
      new ApiRequestError("missing", 404, "NOT_FOUND"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; error?: ApiRequestError; superseded?: string } = { ok: true };
    await act(async () => {
      r = await result.current.viewSnapshot({
        id: "snap-gone",
        label: null,
        created_at: new Date().toISOString(),
      });
    });

    expect(r.ok).toBe(false);
    if (!r.error) throw new Error("unreachable");
    expect(r.error).toBeInstanceOf(ApiRequestError);
    expect(r.error.status).toBe(404);
    // Feeds the new "snapshot.view" scope: 404 → viewFailedNotFound copy
    // via byStatus. Regression guard that the failure arm stays shaped
    // for mapApiError (no raw string copy leaks into the hook contract).
    expect(mapApiError(r.error, "snapshot.view").message).toBe(
      STRINGS.snapshots.viewFailedNotFound,
    );
    expect(result.current.viewingSnapshot).toBeNull();
  });

  it("viewSnapshot returns corrupt-snapshot error when full.content is malformed JSON", async () => {
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
    let r: { ok: boolean; error?: ApiRequestError; superseded?: string } = { ok: true };
    await act(async () => {
      r = await result.current.viewSnapshot({
        id: "snap-1",
        label: null,
        created_at: new Date().toISOString(),
      });
    });

    expect(r.ok).toBe(false);
    if (!r.error) throw new Error("unreachable");
    expect(r.error.code).toBe(SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT);
    expect(mapApiError(r.error, "snapshot.view").message).toBe(STRINGS.snapshots.viewFailedCorrupt);
  });

  it.each([
    ["null literal", "null"],
    ["number literal", "42"],
    ["string literal", '"hello"'],
    ["array literal", "[1,2,3]"],
  ])(
    "viewSnapshot returns corrupt-snapshot error when content parses as %s (not a TipTap doc)",
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
      let r: { ok: boolean; error?: ApiRequestError; superseded?: string } = { ok: true };
      await act(async () => {
        r = await result.current.viewSnapshot({
          id: "snap-1",
          label: null,
          created_at: new Date().toISOString(),
        });
      });

      expect(r.ok).toBe(false);
      if (!r.error) throw new Error("unreachable");
      expect(r.error.code).toBe(SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT);
    },
  );

  it("viewSnapshot maps 2xx BAD_JSON to corrupt-snapshot error, not network", async () => {
    // GET-side BAD_JSON means the snapshot response body was unreadable —
    // no "maybe committed" ambiguity (GETs don't commit). Previously this
    // surfaced as reason:"network", inviting a pointless retry. Mapping
    // to a CORRUPT_SNAPSHOT synthetic error lets the view scope render
    // "this snapshot is corrupt" copy instead of "check your connection."
    vi.mocked(api.snapshots.get).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: { ok: boolean; error?: ApiRequestError; superseded?: string } = { ok: true };
    await act(async () => {
      r = await result.current.viewSnapshot({
        id: "snap-1",
        label: null,
        created_at: new Date().toISOString(),
      });
    });

    expect(r.ok).toBe(false);
    if (!r.error) throw new Error("unreachable");
    expect(r.error.code).toBe(SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT);
    expect(mapApiError(r.error, "snapshot.view").message).toBe(STRINGS.snapshots.viewFailedCorrupt);
    // The transient/connection branch MUST NOT fire — retrying a BAD_JSON
    // GET just re-reads the same garbled bytes.
    expect(mapApiError(r.error, "snapshot.view").transient).toBe(false);
  });

  it("viewSnapshot returns superseded='chapter' on chapter switch (S6)", async () => {
    // Review S6 (2026-04-22): the old shape `{ok:true, staleChapterSwitch:true}`
    // conflated two different causes of supersession into one discriminant,
    // and the panel UI then surfaced "belongs to a different chapter" copy
    // even when the user had NOT switched chapters. Pin the split:
    // cToken.isStale() path → superseded === "chapter".
    let resolveGet: (row: SnapshotRow) => void = () => {};
    vi.mocked(api.snapshots.get).mockImplementationOnce(
      () =>
        new Promise<SnapshotRow>((resolve) => {
          resolveGet = resolve;
        }),
    );

    const { result, rerender } = renderHook(
      ({ chapterId }: { chapterId: string }) => useSnapshotState(chapterId),
      { initialProps: { chapterId: "ch-1" } },
    );

    let viewPromise: ReturnType<typeof result.current.viewSnapshot> = Promise.resolve({
      ok: true,
    });
    act(() => {
      viewPromise = result.current.viewSnapshot({
        id: "snap-1",
        label: null,
        created_at: new Date().toISOString(),
      });
    });
    // Chapter switch while the GET is pending. The chapterId effect fires
    // chapterSeq.abort() so the captured cToken becomes stale.
    rerender({ chapterId: "ch-2" });

    let r: { ok: boolean; error?: ApiRequestError; superseded?: string } = { ok: false };
    await act(async () => {
      resolveGet(makeSnapshotRow());
      r = await viewPromise;
    });

    expect(r.ok).toBe(true);
    expect(r.superseded).toBe("chapter");
  });

  it("viewSnapshot returns superseded='sameChapterNewer' when a newer view click wins (S6)", async () => {
    // Review S6: two rapid View clicks on the SAME chapter must not report
    // the older click's outcome as "belongs to a different chapter." Pin
    // the split: vToken.isStale() path (chapter epoch unchanged, view
    // epoch advanced) → superseded === "sameChapterNewer".
    let resolveFirstGet: (row: SnapshotRow) => void = () => {};
    vi.mocked(api.snapshots.get)
      .mockImplementationOnce(
        () =>
          new Promise<SnapshotRow>((resolve) => {
            resolveFirstGet = resolve;
          }),
      )
      .mockResolvedValueOnce(makeSnapshotRow({ id: "snap-2" }));

    const { result } = renderHook(() => useSnapshotState("ch-1"));

    let firstPromise: ReturnType<typeof result.current.viewSnapshot> = Promise.resolve({
      ok: true,
    });
    act(() => {
      firstPromise = result.current.viewSnapshot({
        id: "snap-1",
        label: null,
        created_at: new Date().toISOString(),
      });
    });
    // Second (newer) View click on the same chapter. viewSeq.start() bumps
    // the view epoch, invalidating the first call's vToken. Chapter epoch
    // is unchanged.
    await act(async () => {
      await result.current.viewSnapshot({
        id: "snap-2",
        label: null,
        created_at: new Date().toISOString(),
      });
    });

    let r: { ok: boolean; error?: ApiRequestError; superseded?: string } = { ok: false };
    await act(async () => {
      resolveFirstGet(makeSnapshotRow({ id: "snap-1" }));
      r = await firstPromise;
    });

    expect(r.ok).toBe(true);
    expect(r.superseded).toBe("sameChapterNewer");
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

    // Now restore. I20 (review 2026-04-24): the prior annotation
    // `{ ok: boolean; reason?: string }` reflected a pre-refactor
    // RestoreResult shape — the current shape is discriminated with
    // `error` on the failure arm. Drop the annotation; the assignment
    // inside act() infers the return type directly from restoreSnapshot.
    let r: Awaited<ReturnType<typeof result.current.restoreSnapshot>> | undefined;
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r?.ok).toBe(true);
    // I3 (review 2026-04-24): restore threads an AbortSignal so chapter
    // switch / unmount during the restore drops the fetch cleanly.
    expect(api.snapshots.restore).toHaveBeenCalledWith("snap-1", expect.any(AbortSignal));
    expect(result.current.viewingSnapshot).toBeNull();
  });

  // I3 (review 2026-04-24): restore + follow-up list run past unmount
  // if no signal is threaded. Hook now holds a restoreAbortRef which
  // the unmount cleanup aborts so the browser drops the in-flight
  // request instead of finishing it for a gone caller.
  it("restoreSnapshot aborts in-flight restore on unmount (I3)", async () => {
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.snapshots.restore).mockImplementation((_id, signal) => {
      capturedSignal = signal;
      return new Promise(() => {}); // never resolves
    });

    const { result, unmount } = renderHook(() => useSnapshotState("ch-1"));

    act(() => {
      void result.current.restoreSnapshot("snap-1");
    });

    await waitFor(() => {
      expect(api.snapshots.restore).toHaveBeenCalled();
    });
    expect(capturedSignal?.aborted).toBe(false);

    unmount();

    expect(capturedSignal?.aborted).toBe(true);
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

    // Switch chapters mid-flight. The chapterId effect calls chapterSeq.abort().
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

  it("restoreSnapshot routes a non-ApiRequestError throw as possiblyCommitted 200 BAD_JSON (I2)", async () => {
    // I2 (2026-04-23 review): apiFetch wraps every network/fetch error
    // in ApiRequestError, so a bare non-ApiRequestError throw from the
    // restore pipeline is effectively post-success (e.g.
    // localStorage.removeItem throwing in Safari private mode, an
    // extension proxying storage, a setState on a torn-down boundary).
    // The server almost certainly committed the restore + its auto-
    // snapshot by that point, so synthesizing NETWORK (transient retry)
    // would invite a double-restore on the user's next click. Synthesize
    // 200 BAD_JSON instead so mapApiError routes through the
    // possiblyCommitted arm → persistent lock banner → no retry.
    vi.mocked(api.snapshots.restore).mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: {
      ok: boolean;
      error?: ApiRequestError;
      staleChapterSwitch?: boolean;
      restoredChapterId?: string;
    } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    if (!r.error) throw new Error("unreachable");
    expect(r.error).toBeInstanceOf(ApiRequestError);
    expect(r.error.code).toBe("BAD_JSON");
    expect(r.error.status).toBe(200);
    const mapped = mapApiError(r.error, "snapshot.restore");
    expect(mapped.possiblyCommitted).toBe(true);
    expect(mapped.transient).toBe(false);
    expect(mapped.message).toBe(STRINGS.snapshots.restoreResponseUnreadable);
  });

  it("restoreSnapshot surfaces CORRUPT_SNAPSHOT via the failure arm on 400 CORRUPT_SNAPSHOT", async () => {
    vi.mocked(api.snapshots.restore).mockRejectedValue(
      new ApiRequestError("Corrupt", 400, "CORRUPT_SNAPSHOT"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: {
      ok: boolean;
      error?: ApiRequestError;
      staleChapterSwitch?: boolean;
      restoredChapterId?: string;
    } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    if (!r.error) throw new Error("unreachable");
    expect(r.error.code).toBe(SNAPSHOT_ERROR_CODES.CORRUPT_SNAPSHOT);
    expect(mapApiError(r.error, "snapshot.restore").message).toBe(
      STRINGS.snapshots.restoreFailedCorrupt,
    );
  });

  it("restoreSnapshot surfaces a 404 via the failure arm", async () => {
    vi.mocked(api.snapshots.restore).mockRejectedValue(
      new ApiRequestError("Snapshot or chapter not found.", 404, "NOT_FOUND"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: {
      ok: boolean;
      error?: ApiRequestError;
      staleChapterSwitch?: boolean;
      restoredChapterId?: string;
    } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    if (!r.error) throw new Error("unreachable");
    expect(r.error.status).toBe(404);
    expect(mapApiError(r.error, "snapshot.restore").message).toBe(
      STRINGS.snapshots.restoreFailedNotFound,
    );
  });

  it("restoreSnapshot surfaces a possibly-committed error on 2xx BAD_JSON (C2)", async () => {
    // apiFetch throws ApiRequestError(status=2xx, code="BAD_JSON") when a
    // 2xx response body fails to parse. The server almost certainly
    // committed the restore (and its auto-snapshot) but the client cannot
    // verify. Previously this fell through to reason:"network" — the
    // EditorPage handler then surfaced the generic "retry" banner and
    // re-enabled the editor. Auto-save would then silently revert the
    // committed restore. With the failure arm carrying the ApiRequestError
    // directly, mapApiError("snapshot.restore") classifies this as
    // possiblyCommitted=true, which the caller routes to a persistent
    // lock banner.
    vi.mocked(api.snapshots.restore).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: {
      ok: boolean;
      error?: ApiRequestError;
      staleChapterSwitch?: boolean;
      restoredChapterId?: string;
    } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    if (!r.error) throw new Error("unreachable");
    expect(r.error.code).toBe("BAD_JSON");
    expect(r.error.status).toBe(200);
    const mapped = mapApiError(r.error, "snapshot.restore");
    expect(mapped.possiblyCommitted).toBe(true);
    expect(mapped.transient).toBe(false);
    expect(mapped.message).toBe(STRINGS.snapshots.restoreResponseUnreadable);
  });

  it("restoreSnapshot surfaces ABORTED via the failure arm (mapApiError returns message:null) (I7)", async () => {
    // viewSnapshot already treats ABORTED as a silent no-op via its
    // supersession discriminant. restoreSnapshot forwards the
    // ApiRequestError verbatim — the caller runs it through mapApiError
    // which returns message:null for ABORTED, the agreed-upon silent-bail
    // signal. No path triggers ABORTED on restore today; this test guards
    // the contract for future wiring (e.g., AbortController wiring for
    // cancellable restores).
    vi.mocked(api.snapshots.restore).mockRejectedValue(
      new ApiRequestError("Request aborted", 0, "ABORTED"),
    );

    const { result } = renderHook(() => useSnapshotState("ch-1"));
    let r: {
      ok: boolean;
      error?: ApiRequestError;
      staleChapterSwitch?: boolean;
      restoredChapterId?: string;
    } = { ok: true };
    await act(async () => {
      r = await result.current.restoreSnapshot("snap-1");
    });

    expect(r.ok).toBe(false);
    if (!r.error) throw new Error("unreachable");
    expect(r.error.code).toBe("ABORTED");
    expect(mapApiError(r.error, "snapshot.restore").message).toBeNull();
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

// (Migration structural check moved to migrationStructuralCheck.test.ts — S2.)
