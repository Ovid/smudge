import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { UNTITLED_CHAPTER } from "@smudge/shared";

import { api, ApiRequestError } from "../api/client";
import { useProjectEditor } from "../hooks/useProjectEditor";
import { STRINGS } from "../strings";
import { flushSaveRetries } from "./helpers/saveRetries";
import { pendingUntilAbort } from "./helpers/abortableMocks";

vi.mock("../api/client", () => ({
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
    ) {
      super(message);
      this.name = "ApiRequestError";
    }
  },
  api: {
    projects: {
      get: vi.fn(),
      update: vi.fn(),
      reorderChapters: vi.fn(),
      trash: vi.fn(),
      velocity: vi.fn().mockResolvedValue({
        words_today: 0,
        daily_average_7d: null,
        daily_average_30d: null,
        current_total: 0,
        target_word_count: null,
        remaining_words: null,
        target_deadline: null,
        days_until_deadline: null,
        required_pace: null,
        projected_completion_date: null,
        today: "2026-04-12",
      }),
    },
    chapters: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      restore: vi.fn(),
    },
    settings: {
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ message: "ok" }),
    },
  },
}));

vi.mock("../hooks/useContentCache", () => ({
  getCachedContent: vi.fn().mockReturnValue(null),
  setCachedContent: vi.fn().mockReturnValue(true),
  clearCachedContent: vi.fn(),
}));

const mockChapter1 = {
  id: "ch1",
  project_id: "p1",
  title: "Chapter 1",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  sort_order: 0,
  word_count: 0,
  status: "outline" as const,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
};

const mockChapter2 = {
  id: "ch2",
  project_id: "p1",
  title: "Chapter 2",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  sort_order: 1,
  word_count: 5,
  status: "outline" as const,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
};

const mockProject = {
  id: "p1",
  slug: "test-project",
  title: "Test Project",
  mode: "fiction" as const,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
  target_word_count: null,
  target_deadline: null,
  author_name: null,
  chapters: [mockChapter1, mockChapter2],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.projects.get).mockResolvedValue(mockProject);
  vi.mocked(api.chapters.get).mockResolvedValue(mockChapter1);
});

describe("useProjectEditor", () => {
  it("loads project and first chapter on mount", async () => {
    const { result } = renderHook(() => useProjectEditor("test-project"));

    await waitFor(() => {
      expect(result.current.project).toEqual(mockProject);
      expect(result.current.activeChapter).toEqual(mockChapter1);
    });
  });

  it("creates a new chapter", async () => {
    const newChapter = {
      id: "ch3",
      project_id: "p1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    vi.mocked(api.chapters.create).mockResolvedValue(newChapter);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    expect(result.current.activeChapter).toEqual(newChapter);
    expect(result.current.project?.chapters).toHaveLength(3);
  });

  it("saves content and transitions through save statuses", async () => {
    const updatedChapter = { ...mockChapter1, word_count: 2 };
    vi.mocked(api.chapters.update).mockResolvedValue(updatedChapter);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(result.current.saveStatus).toBe("saved");
    expect(api.chapters.update).toHaveBeenCalledWith(
      "ch1",
      { content: { type: "doc", content: [] } },
      expect.any(AbortSignal),
    );
  });

  it("syncs activeChapter content and word_count after successful save", async () => {
    const updatedChapter = { ...mockChapter1, word_count: 5 };
    vi.mocked(api.chapters.update).mockResolvedValue(updatedChapter);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    // activeChapter.content should be updated to match saved content
    // so that re-mounting the editor (e.g. after Preview → Editor) uses latest content
    expect(result.current.activeChapter?.content).toEqual({ type: "doc", content: [] });
    // word_count should be synced into project.chapters
    expect(result.current.project?.chapters[0]!.word_count).toBe(5);
  });

  it("sets save status to error after exhausting retries", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Switch to fake timers after hook is set up
    vi.useFakeTimers();
    try {
      await act(async () => {
        const p = result.current.handleSave({ type: "doc", content: [] });
        await flushSaveRetries();
        expect(await p).toBe(false);
      });

      expect(result.current.saveStatus).toBe("error");
      expect(api.chapters.update).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes post-retry-exhaustion NETWORK error through mapApiError (chapter.save scope)", async () => {
    // Regression guard for the Task 2.2 fix: when a NETWORK
    // ApiRequestError exhausts the 4-attempt retry loop, the user-visible
    // banner must come from mapApiError(err, "chapter.save").message —
    // i.e. STRINGS.editor.saveFailedNetwork — not the literal
    // STRINGS.editor.saveFailed fallback. Pre-fix, the catch block
    // surfaced the generic "Save failed. Try again." copy on a
    // connection drop, bypassing the scope's network: mapping and
    // violating CLAUDE.md's "all user-visible API error messages route
    // through mapApiError" invariant.
    // S5 (review 2026-04-26): install a console.warn spy and assert no
    // calls. NETWORK retries do not currently log (the catch ladder's
    // warn lines fire only for terminal-code and 4xx branches), so the
    // test is silent today. A future warn addition on the NETWORK path
    // would otherwise slip past the zero-warnings invariant from
    // CLAUDE.md.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("[dev] Failed to fetch", 0, "NETWORK"),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    vi.useFakeTimers();
    try {
      await act(async () => {
        const p = result.current.handleSave({ type: "doc", content: [] });
        await flushSaveRetries();
        expect(await p).toBe(false);
      });

      expect(result.current.saveStatus).toBe("error");
      expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveFailedNetwork);
      expect(api.chapters.update).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it("routes post-retry-exhaustion bare 500 error through mapApiError (I3, chapter.save scope)", async () => {
    // I3 (review 2026-04-26): mirror the NETWORK exhaustion test for a
    // bare 500 INTERNAL_ERROR. Pre-fix, retry exhaustion of any non-coded
    // 500 routed through the mapper's fallback copy — "Save failed. Try
    // again." — which is misleading after 4 attempts spanning ~14s.
    // The new chapter.save byStatus[500] mapping resolves this to
    // STRINGS.editor.saveFailedServer ("the server is having trouble.
    // Try again in a moment."). Terminal codes (BAD_JSON,
    // UPDATE_READ_FAILURE, CORRUPT_CONTENT) keep their own copy via
    // byCode and are unaffected.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("internal error", 500, "INTERNAL_ERROR"),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    vi.useFakeTimers();
    try {
      await act(async () => {
        const p = result.current.handleSave({ type: "doc", content: [] });
        await flushSaveRetries();
        expect(await p).toBe(false);
      });

      expect(result.current.saveStatus).toBe("error");
      expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveFailedServer);
      expect(api.chapters.update).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it("NETWORK retry mid-backoff chapter switch does not bleed onto new chapter (S2)", async () => {
    // S2 (review 2026-04-26): defensive guard against a future refactor
    // moving `mapApiError(lastErr, "chapter.save")` outside the
    // `!token.isStale()` gate at the post-loop block. The gate is what
    // keeps a stale (cancelled) save's NETWORK exhaustion banner from
    // landing on the chapter the user has since switched to. Without
    // it, the cancelled save would surface STRINGS.editor.saveFailedNetwork
    // on the freshly-loaded chapter.
    //
    // Sequence: kick off a save on ch1 whose first attempt rejects with
    // NETWORK. While the loop is asleep in backoff, switch to ch2 (which
    // calls cancelInFlightSave → saveSeq.abort() → token becomes stale,
    // and unblocks the backoff sleep). Advance timers past the longest
    // backoff. Assert no error state on ch2 and no further PATCH.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("[dev] Failed to fetch", 0, "NETWORK"),
    );
    vi.mocked(api.chapters.get).mockReset();
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1) // initial load
      .mockResolvedValueOnce(mockChapter2); // post-switch fetch

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter?.id).toBe("ch1"));

    vi.useFakeTimers();
    try {
      // Kick off save; do NOT await — the retry loop is now asleep in
      // backoff after the first rejection.
      let savePromise: Promise<boolean> = Promise.resolve(false);
      act(() => {
        savePromise = result.current.handleSave({ type: "doc", content: [] }, "ch1");
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(api.chapters.update).toHaveBeenCalledTimes(1);

      // Switch chapters mid-backoff. cancelInFlightSave aborts the
      // sequence and unblocks the sleep, so the loop's next iteration
      // returns immediately without setting error state.
      await act(async () => {
        await result.current.handleSelectChapter("ch2");
      });
      expect(result.current.activeChapter?.id).toBe("ch2");

      // Drain any residual timers and the save's promise.
      await act(async () => {
        await flushSaveRetries();
        expect(await savePromise).toBe(false);
      });

      // Stale save must NOT surface its NETWORK banner on ch2.
      expect(result.current.saveStatus).not.toBe("error");
      expect(result.current.saveErrorMessage).toBeNull();
      // No further PATCHes after the abort: the retry loop short-
      // circuited via the stale-token check on its next iteration.
      expect(api.chapters.update).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it("S-2: cancelInFlightSave aborts an in-flight save (regression test)", async () => {
    // Phase 4b.3b row S-2: locks the contract that cancelInFlightSave()
    // — invoked by cancelPendingSaves, handleSelectChapter,
    // handleDeleteChapter, handleCreateChapter, and unmount cleanup —
    // actually aborts the AbortSignal threaded into api.chapters.update.
    // Before the migration this came from saveAbortRef.current.abort();
    // after the migration the same guarantee comes from
    // saveOp.abort() via useAbortableAsyncOperation. The test asserts
    // the externally-observable behavior so it passes against both
    // implementations.
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(api.chapters.update).mockImplementation((_id, _data, signal) => {
      capturedSignal = signal;
      return pendingUntilAbort<typeof mockChapter1>(signal);
    });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy(), { timeout: 3000 });

    let savePromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      savePromise = result.current.handleSave({ type: "doc", content: [] }, "ch1");
    });
    await waitFor(() => expect(capturedSignal).toBeDefined(), { timeout: 3000 });
    expect(capturedSignal!.aborted).toBe(false);

    await act(async () => {
      result.current.cancelPendingSaves();
      // Drain the pending save promise — the aborted fetch rejects with
      // ABORTED, which the catch block in handleSave short-circuits via
      // isAborted(err).
      expect(await savePromise).toBe(false);
    });

    expect(capturedSignal!.aborted).toBe(true);
  });

  it("unmount during save-backoff aborts the retry loop and does not fire a further PATCH", async () => {
    // Regression for a pre-existing leak: the retry loop inside handleSave
    // runs outside React's render cycle. Without unmount cleanup, a backoff
    // sleep started before unmount would wake, call api.chapters.update a
    // second time, and attempt state writes on a gone component.
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("network error"));

    const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    vi.useFakeTimers();
    try {
      // Kick off a save whose first attempt rejects and enters backoff.
      void result.current.handleSave({ type: "doc", content: [] });
      // Yield the microtask so the first PATCH rejects and enters the sleep.
      await vi.advanceTimersByTimeAsync(0);
      expect(api.chapters.update).toHaveBeenCalledTimes(1);

      // Unmount mid-backoff; the cleanup must abort the loop and clear the
      // timer before it fires.
      unmount();

      // Fast-forward well past the longest backoff. No further PATCH.
      await vi.advanceTimersByTimeAsync(20000);
      expect(api.chapters.update).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retry after backoff posts keystrokes typed during the backoff and preserves cache", async () => {
    // Regression: the retry loop used to capture the initial content closure
    // and silently drop keystrokes typed during backoff when the retry
    // succeeded, because clearCachedContent ran unconditionally.
    const { clearCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(clearCachedContent).mockClear();
    vi.mocked(api.chapters.update)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ...mockChapter1, word_count: 9 });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    const initialContent = { type: "doc", content: [{ type: "paragraph" }] };
    const typedDuringBackoff = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "typed later" }] }],
    };

    vi.useFakeTimers();
    try {
      await act(async () => {
        const p = result.current.handleSave(initialContent);
        // Simulate user typing during the backoff window.
        result.current.handleContentChange(typedDuringBackoff);
        await vi.advanceTimersByTimeAsync(2000);
        return p;
      });

      // Retry should have posted the newer content, not the initial content.
      expect(api.chapters.update).toHaveBeenNthCalledWith(
        2,
        "ch1",
        { content: typedDuringBackoff },
        expect.any(AbortSignal),
      );
      // Since a newer change was in the cache at save time (the typed content
      // equals latestContentRef, so actually "stillLatest" is true here),
      // clearCachedContent fires. Verify activeChapter reflects the posted
      // (newer) content so remount picks up what the server has.
      expect(result.current.activeChapter?.content).toEqual(typedDuringBackoff);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not clear cache or report 'saved' if newer content arrived after save started", async () => {
    const { clearCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(clearCachedContent).mockClear();
    // Resolve immediately — but the test will race a handleContentChange
    // before the resolution (in practice handleContentChange between save
    // start and fetch return).
    let resolveUpdate: (v: typeof mockChapter1) => void = () => {};
    vi.mocked(api.chapters.update).mockImplementationOnce(
      () =>
        new Promise<typeof mockChapter1>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    const initialContent = { type: "doc", content: [{ type: "paragraph" }] };
    const typedDuringRequest = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "fresh keystroke" }] }],
    };

    await act(async () => {
      const p = result.current.handleSave(initialContent);
      // Simulate typing while the PATCH is in flight. This replaces
      // latestContentRef so that on success the cache should NOT be cleared.
      result.current.handleContentChange(typedDuringRequest);
      resolveUpdate({ ...mockChapter1, word_count: 2 });
      await p;
    });

    // Cache must NOT have been cleared because newer content is pending.
    expect(vi.mocked(clearCachedContent)).not.toHaveBeenCalled();
    // Status should reflect pending unsaved state, not falsely "saved".
    expect(result.current.saveStatus).toBe("unsaved");
  });

  it("uses explicit chapterId over activeChapterRef to prevent cross-chapter clobber", async () => {
    // Regression: Editor unmount cleanup fires onSave after setActiveChapter
    // has already advanced activeChapterRef to the new chapter. Without an
    // explicit chapterId, handleSave would PATCH the NEW chapter with the OLD
    // chapter's content.
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1)
      .mockResolvedValueOnce(mockChapter2);
    vi.mocked(api.chapters.update).mockResolvedValue({ ...mockChapter1, word_count: 2 });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Switch to ch2 so activeChapterRef now points at ch2
    await act(async () => {
      await result.current.handleSelectChapter("ch2");
    });
    expect(result.current.activeChapter?.id).toBe("ch2");

    const oldContent = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "A" }] }],
    };
    // Save with explicit chapterId=ch1 (simulates Editor unmount cleanup)
    await act(async () => {
      await result.current.handleSave(oldContent, "ch1");
    });

    // Must target ch1, not ch2
    expect(api.chapters.update).toHaveBeenCalledWith(
      "ch1",
      { content: oldContent },
      expect.any(AbortSignal),
    );
    expect(api.chapters.update).not.toHaveBeenCalledWith(
      "ch2",
      expect.anything(),
      expect.anything(),
    );
  });

  it("succeeds on retry after transient failure", async () => {
    vi.mocked(api.chapters.update)
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ ...mockChapter1, word_count: 3 });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    vi.useFakeTimers();
    try {
      await act(async () => {
        const p = result.current.handleSave({ type: "doc", content: [] });
        await vi.advanceTimersByTimeAsync(2000);
        return p;
      });

      expect(result.current.saveStatus).toBe("saved");
      expect(api.chapters.update).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("selects a different chapter", async () => {
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1) // initial load
      .mockResolvedValueOnce(mockChapter2); // select

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSelectChapter("ch2");
    });

    expect(result.current.activeChapter?.id).toBe("ch2");
  });

  it("does not switch when selecting the already-active chapter", async () => {
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSelectChapter("ch1");
    });

    // get should only have been called once (initial load)
    expect(api.chapters.get).toHaveBeenCalledTimes(1);
  });

  it("deletes a non-active chapter", async () => {
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleDeleteChapter(mockChapter2);
    });

    expect(result.current.project?.chapters).toHaveLength(1);
    expect(result.current.activeChapter?.id).toBe("ch1"); // unchanged
  });

  it("deletes the active chapter and switches to the first remaining", async () => {
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1) // initial load
      .mockResolvedValueOnce(mockChapter2); // switch after delete

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleDeleteChapter(mockChapter1);
    });

    await waitFor(() => {
      expect(result.current.activeChapter?.id).toBe("ch2");
    });
  });

  it("reorders chapters", async () => {
    vi.mocked(api.projects.reorderChapters).mockResolvedValue({ message: "ok" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    expect(result.current.project?.chapters[0]!.id).toBe("ch2");
    expect(result.current.project?.chapters[1]!.id).toBe("ch1");
  });

  // C5 (review 2026-04-24): rapid drag-drop reorders used to issue
  // overlapping PUTs with no client-side ordering guard. SQLite writer-
  // lock ordering at the server determined the persisted order rather
  // than the user's last drop. Mirror statusChangeAbortRef: each call
  // aborts the prior controller and passes its signal into the
  // transport, so the newer reorder severs the older one.
  it("handleReorderChapters threads AbortSignal into reorderChapters (C5)", async () => {
    vi.mocked(api.projects.reorderChapters).mockResolvedValue({ message: "ok" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    const callArgs = vi.mocked(api.projects.reorderChapters).mock.calls[0];
    expect(callArgs?.[2]).toBeInstanceOf(AbortSignal);
  });

  it("handleReorderChapters aborts prior in-flight reorder on supersede (C5)", async () => {
    // Hold the first reorder PUT open; fire a second reorder; the first
    // call's signal must be aborted by the second call's entry.
    let firstResolve!: () => void;
    let firstSignal: AbortSignal | undefined;
    let secondSignal: AbortSignal | undefined;

    vi.mocked(api.projects.reorderChapters)
      .mockImplementationOnce((_slug, _ids, signal) => {
        firstSignal = signal;
        return new Promise<{ message: string }>((resolve) => {
          firstResolve = () => resolve({ message: "ok" });
        });
      })
      .mockImplementationOnce((_slug, _ids, signal) => {
        secondSignal = signal;
        return Promise.resolve({ message: "ok" });
      });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    // First reorder — kept pending.
    await act(async () => {
      void result.current.handleReorderChapters(["ch2", "ch1"]);
    });
    // Second reorder — must abort the first signal before issuing its own.
    await act(async () => {
      await result.current.handleReorderChapters(["ch1", "ch2"]);
    });

    expect(firstSignal?.aborted).toBe(true);
    expect(secondSignal?.aborted).toBe(false);

    // Resolve the stranded first request so the hook unmounts cleanly.
    firstResolve();
  });

  it("updates the project title", async () => {
    const { chapters: _, ...projectWithoutChapters } = mockProject;
    vi.mocked(api.projects.update).mockResolvedValue({
      ...projectWithoutChapters,
      title: "New Title",
      slug: "new-title",
    });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleUpdateProjectTitle("New Title");
    });

    expect(result.current.project?.title).toBe("New Title");
  });

  it("updates the active chapter title", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({
      ...mockChapter1,
      title: "Renamed",
    });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      const chapterId = result.current.activeChapter?.id ?? "";
      await result.current.handleRenameChapter(chapterId, "Renamed");
    });

    expect(result.current.activeChapter?.title).toBe("Renamed");
    expect(result.current.project?.chapters[0]!.title).toBe("Renamed");
  });

  it("renames a chapter via handleRenameChapter", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({
      ...mockChapter2,
      title: "Better Name",
    });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleRenameChapter("ch2", "Better Name");
    });

    expect(result.current.project?.chapters[1]!.title).toBe("Better Name");
  });

  it("renames the active chapter and updates activeChapter state", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({
      ...mockChapter1,
      title: "Active Renamed",
    });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleRenameChapter("ch1", "Active Renamed");
    });

    expect(result.current.activeChapter?.title).toBe("Active Renamed");
  });

  it("sets error state when project fetch returns 404", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.get).mockRejectedValue(new Error("Project not found."));

    const { result } = renderHook(() => useProjectEditor("nonexistent-id"));

    await waitFor(() => {
      expect(result.current.error).toBe(STRINGS.error.loadProjectFailed);
    });

    expect(result.current.project).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load project:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("does not console.warn when loadProject rejects after unmount", async () => {
    // Copilot review 2026-04-24 (wider occurrence of the HomePage
    // race): previously console.warn fired BEFORE the cancelled guard,
    // producing test-output noise on navigation/unmount races.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let rejectFn: (err: Error) => void = () => {};
    vi.mocked(api.projects.get).mockReturnValue(
      new Promise((_, reject) => {
        rejectFn = reject;
      }),
    );

    const { unmount } = renderHook(() => useProjectEditor("some-slug"));
    unmount();
    rejectFn(new Error("Network error"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("C-6: unmount mid-api.projects.get does NOT call setProject (preserves cancelled-flag guarantee)", async () => {
    // C-6 (Phase 4b.3b): the loadProject useEffect replaced its
    // `let cancelled = false` flag with `loadProjectOp.run(...)`. The
    // pre-migration guarantee was: a late-resolving api.projects.get
    // landing after unmount must not call setProject. The hook's
    // auto-abort-on-unmount + `if (s.aborted) return;` gate must
    // preserve that guarantee.
    let resolveGet: (data: typeof mockProject) => void = () => {};
    vi.mocked(api.projects.get).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveGet = resolve as (data: typeof mockProject) => void;
        }),
    );

    const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
    // Sanity: nothing has resolved yet, so project should still be null.
    expect(result.current.project).toBeNull();
    unmount();
    // Resolve AFTER unmount — the post-await `if (s.aborted) return;`
    // gate must short-circuit before any setState fires.
    resolveGet(mockProject);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The hook is unmounted, so result.current is frozen at its last
    // pre-unmount value (project: null). If the guard regressed and
    // setProject fired after unmount, React would log a "state update
    // on unmounted component" warning — assert no console.error either.
    expect(result.current.project).toBeNull();
  });

  it("updates word count on content change", async () => {
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    act(() => {
      result.current.handleContentChange({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
      });
    });

    expect(result.current.chapterWordCount).toBe(2);
  });

  it("sets error when handleCreateChapter fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.create).mockRejectedValue(new Error("create boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    expect(result.current.error).toBe(STRINGS.error.createChapterFailed);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to create chapter:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("sets error when handleSelectChapter fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1) // initial load
      .mockRejectedValueOnce(new Error("select boom")); // select fails

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSelectChapter("ch2");
    });

    expect(result.current.error).toBe(STRINGS.error.loadChapterFailed);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load chapter:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("calls onError callback when handleDeleteChapter fails (does not set full-page error)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.delete).mockRejectedValue(new Error("delete boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleDeleteChapter(mockChapter2, onError);
    });

    expect(onError).toHaveBeenCalledWith(STRINGS.error.deleteChapterFailed);
    expect(result.current.error).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to delete chapter:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("sets activeChapter to null when deleting the last chapter", async () => {
    const singleChapterProject = {
      ...mockProject,
      chapters: [mockChapter1],
    };
    vi.mocked(api.projects.get).mockResolvedValue(singleChapterProject);
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleDeleteChapter(mockChapter1);
    });

    expect(result.current.activeChapter).toBeNull();
    expect(result.current.chapterWordCount).toBe(0);
    expect(result.current.project?.chapters).toHaveLength(0);
  });

  it("sets error when handleReorderChapters fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.reorderChapters).mockRejectedValue(new Error("reorder boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    expect(result.current.error).toBe(STRINGS.error.reorderFailed);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to reorder chapters:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("returns undefined when handleUpdateProjectTitle fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.update).mockRejectedValue(new Error("update boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    let returnValue: string | undefined;
    await act(async () => {
      returnValue = await result.current.handleUpdateProjectTitle("New Title");
    });

    expect(returnValue).toBeUndefined();
    // Should NOT set page-level error (keeps title edit mode open instead)
    expect(result.current.error).toBeNull();
    // Should set inline project title error
    expect(result.current.projectTitleError).toBe(STRINGS.error.updateTitleFailed);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to update project title:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  // I2 (review 2026-05-25): with Phase 4b.3b threading signals into
  // chapter.create / chapter.get / chapter.delete, supersede and unmount
  // now reject the in-flight call with ApiRequestError{ABORTED}. The
  // pre-fix catches fired console.warn(...) BEFORE the abort/stale
  // gate, violating CLAUDE.md §Testing Philosophy zero-warnings rule.
  // These tests pin the silent-on-abort contract.
  describe("I2: console.warn gated on abort", () => {
    it("handleCreateChapter does not warn when superseded by unmount", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(api.chapters.create).mockImplementation((_slug, signal) =>
        pendingUntilAbort(signal),
      );

      const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
      await waitFor(() => expect(result.current.project).toBeTruthy());

      void result.current.handleCreateChapter();
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("handleSelectChapter does not warn when superseded by unmount", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Initial load resolves; subsequent select hangs until abort.
      let callIndex = 0;
      vi.mocked(api.chapters.get).mockImplementation((id, signal) => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve(mockChapter1);
        return pendingUntilAbort(signal);
      });

      const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
      await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

      void result.current.handleSelectChapter("ch2");
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("reloadActiveChapter does not warn when superseded by unmount", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      let callIndex = 0;
      vi.mocked(api.chapters.get).mockImplementation((_id, signal) => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve(mockChapter1);
        return pendingUntilAbort(signal);
      });

      const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
      await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

      void result.current.reloadActiveChapter();
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it("handleDeleteChapter inner secondary-GET does not warn on abort", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      // Active chapter (ch1) is the deletion target so the deletion path
      // enters the secondary-GET branch (lines around 956). The DELETE
      // resolves; the post-delete GET hangs until the unmount-driven abort
      // rejects it with ABORTED.
      vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });
      let callIndex = 0;
      vi.mocked(api.chapters.get).mockImplementation((_id, signal) => {
        callIndex++;
        if (callIndex === 1) return Promise.resolve(mockChapter1);
        return pendingUntilAbort(signal);
      });

      const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
      await waitFor(() => expect(result.current.activeChapter?.id).toBe("ch1"));

      void result.current.handleDeleteChapter(mockChapter1);
      // Allow the DELETE to resolve and the secondary GET to start.
      await new Promise((resolve) => setTimeout(resolve, 0));
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Pre-fix, the secondary-GET catch warned BEFORE checking s.aborted.
      const failedAfterDelete = warnSpy.mock.calls.filter(
        (call) =>
          typeof call[0] === "string" && call[0].includes("Failed to load chapter after delete"),
      );
      expect(failedAfterDelete).toEqual([]);
      warnSpy.mockRestore();
    });
  });

  it("calls onError callback when handleRenameChapter fails (does not set full-page error)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("rename boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleRenameChapter("ch1", "New Name", onError);
    });

    expect(onError).toHaveBeenCalledWith(STRINGS.error.renameChapterFailed);
    expect(result.current.error).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to rename chapter:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("handleStatusChange updates chapter status optimistically", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({ ...mockChapter1, status: "revised" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised");
    });

    expect(result.current.project?.chapters[0]!.status).toBe("revised");
  });

  it("handleStatusChange reverts on API failure and calls onError", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("status boom"));
    // When the status change fails, it reloads the project from server
    const reloadedProject = {
      ...mockProject,
      chapters: [{ ...mockChapter1, status: "outline" }, mockChapter2],
    };
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockResolvedValueOnce(reloadedProject); // reload after failure

    const onError = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised", onError);
    });

    // Should call onError callback instead of returning the error
    expect(onError).toHaveBeenCalledWith(STRINGS.error.statusChangeFailed);
    // After revert, project should be reloaded from server
    expect(result.current.project?.chapters[0]!.status).toBe("outline");
  });

  it("handleStatusChange falls back to local revert when chapter absent from reloaded project", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("status boom"));
    // Reload succeeds but chapter is absent (e.g., concurrently deleted)
    const reloadedProject = {
      ...mockProject,
      chapters: [mockChapter2], // ch1 is missing
    };
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockResolvedValueOnce(reloadedProject); // reload after failure — ch1 absent

    const onError = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised", onError);
    });

    expect(onError).toHaveBeenCalledWith(STRINGS.error.statusChangeFailed);
    // Local fallback should fire since ch1 was not in the reloaded data
    expect(result.current.project?.chapters[0]!.status).toBe("outline");
  });

  it("handleStatusChange falls back to setError when onError is omitted (S4 4b.3c.2)", async () => {
    // Pre-S4: an omitted onError silently swallowed the mapped message —
    // keyboard-shortcut callers had no way to surface a status-change
    // failure. The fallback mirrors handleReorderChapters: prefer onError
    // when provided, otherwise route through setError so the failure
    // surfaces via the full-page error overlay rather than vanishing.
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("status boom"));
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockResolvedValueOnce(mockProject); // reload after failure

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      // No onError argument — the fallback path.
      await result.current.handleStatusChange("ch1", "revised");
    });

    expect(result.current.error).toBe(STRINGS.error.statusChangeFailed);
  });

  it("handleStatusChange routes to onError (not setError) when one is provided (S4 4b.3c.2)", async () => {
    // Regression guard: the onError path still wins over the new setError
    // fallback when the caller supplies a callback.
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("status boom"));
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject)
      .mockResolvedValueOnce(mockProject);

    const onError = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised", onError);
    });

    expect(onError).toHaveBeenCalledWith(STRINGS.error.statusChangeFailed);
    expect(result.current.error).toBeNull();
  });

  it("handleStatusChange recovery GET failure warns via devWarn (S10 4b.3c.2)", async () => {
    // The recovery catch around api.projects.get now routes through
    // devWarn so a failed recovery is observable in dev. The bare
    // `} catch {}` shape pre-S10 silently swallowed the failure.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("status boom"));
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockRejectedValueOnce(new Error("recovery GET boom")); // recovery GET fails

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised");
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "handleStatusChange recovery GET failed:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("when the handleStatusChange recovery GET is aborted, no console.warn fires (stable across S10 4b.3c.2 fix)", async () => {
    // Abort-silence invariant: even after S10 introduces devWarn at
    // the recovery catch, an aborted signal must stay silent so unmount
    // and rapid-supersede races don't pollute test output. Driven via
    // unmount, which fires the cleanup at useProjectEditor.ts:273-280
    // (statusRecoveryAbortRef.current?.abort()).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("status boom"));
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockImplementationOnce((_slug, signal) => pendingUntilAbort(signal)); // recovery hangs until abort

    const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    // Start the status change; do NOT await — the recovery GET is hanging.
    let statusPromise: Promise<unknown>;
    await act(async () => {
      statusPromise = result.current.handleStatusChange("ch1", "revised");
    });

    // Let the chapters.update rejection settle and the recovery GET issue.
    await waitFor(() => expect(api.projects.get).toHaveBeenCalledTimes(2));

    // Unmount triggers statusRecoveryAbortRef.abort() → recovery rejects
    // with ABORTED → catch fires.
    unmount();
    await act(async () => {
      await statusPromise!.catch(() => undefined);
    });

    expect(warnSpy).not.toHaveBeenCalledWith(
      "handleStatusChange recovery GET failed:",
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("handleCreateChapter recovery GET failure warns via devWarn (S10 4b.3c.2)", async () => {
    // Mirror of Task 31's S10 fix for handleCreateChapter's
    // possiblyCommitted recovery branch (api.projects.get under
    // createRecoveryAbortRef). The pre-fix bare catch silently
    // swallowed the failure.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // 200 BAD_JSON → mapper sets possiblyCommitted=true (chapter.create scope
    // declares committed: copy), routing handleCreateChapter into the recovery
    // branch which then awaits api.projects.get under createRecoveryAbortRef.
    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("body parse error", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockRejectedValueOnce(new Error("recovery GET boom")); // recovery GET fails

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    expect(warnSpy).toHaveBeenCalledWith(
      "handleCreateChapter recovery GET failed:",
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("when the handleCreateChapter recovery GET is aborted, no console.warn fires (stable across S10 4b.3c.2 fix)", async () => {
    // Abort-silence invariant mirror — unmount cleanup at
    // useProjectEditor.ts:273-280 fires createRecoveryAbortRef.abort()
    // mid-flight; devWarn (post-fix) must still bail on signal.aborted.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("body parse error", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockImplementationOnce((_slug, signal) => pendingUntilAbort(signal)); // recovery hangs

    const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    let createPromise: Promise<unknown>;
    await act(async () => {
      createPromise = result.current.handleCreateChapter();
    });
    await waitFor(() => expect(api.projects.get).toHaveBeenCalledTimes(2));

    unmount();
    await act(async () => {
      await createPromise!.catch(() => undefined);
    });

    expect(warnSpy).not.toHaveBeenCalledWith(
      "handleCreateChapter recovery GET failed:",
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("handleReorderChapters does not corrupt project B when reorder PATCH for project A resolves mid-switch (S20 4b.3c.2)", async () => {
    // S20 adds an inside-updater `prev.id !== projectId` guard to both
    // setProject calls in handleReorderChapters as defense-in-depth for
    // the React-scheduling window between the line 1125 outer check and
    // the updater running. The narrow race itself is hard to engineer
    // in renderHook tests (projectRef updates commit atomically with the
    // React state); this integration test drives the broader project-
    // switch-mid-PATCH scenario and asserts project B's chapters are
    // unchanged after project A's deferred PATCH resolves. The inside-
    // updater guard's structural presence is enforced by code review.
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [
        { ...mockChapter1, id: "ch3", project_id: "p2" },
        { ...mockChapter2, id: "ch4", project_id: "p2" },
      ],
    };

    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get).mockImplementation(async (slug) =>
      slug === "other-project" ? otherProject : mockProject,
    );

    let resolveReorder!: () => void;
    vi.mocked(api.projects.reorderChapters).mockImplementationOnce(
      () =>
        new Promise<{ message: string }>((resolve) => {
          resolveReorder = () => resolve({ message: "ok" });
        }),
    );

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.id).toBe("p1"));

    // Issue reorder against project A — captures projectId="p1", PATCH pending.
    await act(async () => {
      void result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    // Switch to project B; hook loads project B and sets it.
    rerender({ slug: "other-project" });
    await waitFor(() => expect(result.current.project?.id).toBe("p2"));

    // Now resolve project A's PATCH. Without the project-switch guards
    // (both outer and inside-updater), the updater would walk project B's
    // chapters with project A's orderedIds — every id miss filtered out,
    // leaving project B with an empty chapter list.
    await act(async () => {
      resolveReorder();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    // Project B's chapters survive intact.
    expect(result.current.project?.id).toBe("p2");
    expect(result.current.project?.chapters.map((c) => c.id)).toEqual(["ch3", "ch4"]);
  });

  // I7 (review 2026-04-24): rapid renames used to race at the server;
  // the newer PATCH now severs the older one by installing a signal on
  // renameChapterAbortRef before issuing the new call.
  it("handleRenameChapter threads AbortSignal into api.chapters.update (I7)", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({ ...mockChapter1, title: "Renamed" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleRenameChapter("ch1", "Renamed");
    });

    const callArgs = vi.mocked(api.chapters.update).mock.calls[0];
    expect(callArgs?.[2]).toBeInstanceOf(AbortSignal);
  });

  it("handleDeleteChapter threads AbortSignal into api.chapters.delete (I7)", async () => {
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter2);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleDeleteChapter(mockChapter1);
    });

    const callArgs = vi.mocked(api.chapters.delete).mock.calls[0];
    expect(callArgs?.[1]).toBeInstanceOf(AbortSignal);
  });

  it("S-7: the same signal threads into delete and the post-delete api.chapters.get; both abort together on unmount", async () => {
    // Phase 4b.3b row S-7: the deleteChapterOp.run() callback wraps
    // BOTH api.chapters.delete AND the post-delete api.chapters.get,
    // so a single per-call signal `s` threads through both calls.
    // One unmount aborts both. The hook-level cross-await stability
    // contract in useAbortableAsyncOperation.test.ts pins the
    // "same signal across awaits" property; this consumer test pins
    // that useProjectEditor actually uses it that way.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let deleteSignal: AbortSignal | undefined;
    let getSignal: AbortSignal | undefined;
    vi.mocked(api.chapters.delete).mockImplementationOnce((_id, signal) => {
      deleteSignal = signal;
      return Promise.resolve({ message: "deleted" });
    });
    // The post-delete GET stays pending until the signal aborts. Using
    // pendingUntilAbort (rather than `new Promise(() => {})`) mirrors the
    // real api-client shape: a real fetch aborts with ApiRequestError(0,
    // "ABORTED"), routing the consumer through the same catch arms it
    // would hit in production. mockImplementationOnce so the once-queue
    // is fully consumed by this test and doesn't leak to siblings.
    vi.mocked(api.chapters.get).mockReset();
    vi.mocked(api.chapters.get).mockResolvedValueOnce(mockChapter1); // initial load
    vi.mocked(api.chapters.get).mockImplementationOnce((_id, signal) => {
      getSignal = signal;
      return pendingUntilAbort(signal);
    });

    const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Fire the delete of the active chapter. After the delete resolves,
    // the followup GET for the next active chapter will await.
    let deletePromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      deletePromise = result.current.handleDeleteChapter(mockChapter1);
      // Yield so the awaited DELETE settles and the followup GET starts.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The post-delete GET should now be in flight with its signal captured.
    expect(deleteSignal).toBeInstanceOf(AbortSignal);
    expect(getSignal).toBeInstanceOf(AbortSignal);
    // Load-bearing invariant: the SAME controller flows into BOTH calls.
    expect(deleteSignal).toBe(getSignal);
    expect(deleteSignal!.aborted).toBe(false);

    // Unmount severs both calls together via the single hook's auto-abort.
    // The followup GET's pendingUntilAbort rejects, the run() callback's
    // catch arm sees s.aborted and returns true, and the deletePromise
    // resolves under the aborted branch.
    unmount();
    expect(deleteSignal!.aborted).toBe(true);
    expect(getSignal!.aborted).toBe(true);

    await act(async () => {
      await deletePromise;
    });
    warnSpy.mockRestore();
  });

  it("handleStatusChange threads AbortSignal into api.chapters.update (I11)", async () => {
    // Rapid status clicks used to issue overlapping PATCHes with no
    // ordering guarantee at the server. The signal lets the newer
    // click sever the older one's fetch.
    vi.mocked(api.chapters.update).mockResolvedValue({ ...mockChapter1, status: "revised" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised");
    });

    const callArgs = vi.mocked(api.chapters.update).mock.calls[0];
    expect(callArgs?.[2]).toBeInstanceOf(AbortSignal);
  });

  // I21 (review 2026-04-24): rapid X→A→B click sequence must NOT
  // revert B's failure to A. Before the confirmed-status ref,
  // `previousStatus` read projectRef, which held the optimistic A
  // already. If the fallback reload also failed, B's revert would
  // restore A — a status the server never persisted. Now the revert
  // reads from confirmedStatusRef, which only advances after a
  // server-confirmed PATCH.
  it("handleStatusChange reverts to the last confirmed status, not the last optimistic (I21)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // X = "outline" (from mockChapter1); A success; B fail.
    vi.mocked(api.chapters.update)
      .mockResolvedValueOnce({ ...mockChapter1, status: "drafting" }) // A succeeds
      .mockRejectedValueOnce(new Error("B boom")); // B fails
    // Fallback GET after B's failure also fails, forcing the local revert.
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockRejectedValueOnce(new Error("reload boom")); // revert-reload fails

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    // A: X → drafting (succeeds)
    await act(async () => {
      await result.current.handleStatusChange("ch1", "drafting");
    });
    expect(result.current.project?.chapters.find((c) => c.id === "ch1")?.status).toBe("drafting");

    // B: drafting → revised (fails; fallback reload also fails)
    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised");
    });

    // Local revert restores the LAST CONFIRMED status ("drafting" from
    // A's success), NOT the optimistic value that was on screen when B
    // entered. Before the fix this would have restored "outline" or
    // failed differently depending on the closure read.
    expect(result.current.project?.chapters.find((c) => c.id === "ch1")?.status).toBe("drafting");
    warnSpy.mockRestore();
  });

  it("handleStatusChange does not revert on ABORTED (I11 follow-on)", async () => {
    // Rapid A→B→C: B's PATCH gets aborted when C's click fires. B's
    // catch must not revert (that would stomp C's optimistic state).
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("aborted", 0, "ABORTED"));
    // Guard: the revert path would call projects.get; assert it does not.
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    const onError = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised", onError);
    });

    expect(onError).not.toHaveBeenCalled();
    // projects.get is called exactly once for the initial load, never
    // for a revert. If the revert fired we would see 2 calls.
    expect(api.projects.get).toHaveBeenCalledTimes(1);
  });

  it("handleStatusChange updates activeChapter status when it's the active chapter", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({ ...mockChapter1, status: "edited" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "edited");
    });

    expect(result.current.activeChapter?.status).toBe("edited");
  });

  it("handleContentChange sets cacheWarning when setCachedContent returns false", async () => {
    const { setCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(setCachedContent).mockReturnValue(false);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    expect(result.current.cacheWarning).toBe(false);

    act(() => {
      result.current.handleContentChange({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
      });
    });

    expect(result.current.cacheWarning).toBe(true);

    // Clears when cache write succeeds again
    vi.mocked(setCachedContent).mockReturnValue(true);
    act(() => {
      result.current.handleContentChange({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello again" }] }],
      });
    });

    expect(result.current.cacheWarning).toBe(false);
  });

  it("handleSave clears cacheWarning on successful save", async () => {
    const { setCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(setCachedContent).mockReturnValue(false);
    vi.mocked(api.chapters.update).mockResolvedValue({ ...mockChapter1, word_count: 2 });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Trigger cache failure
    act(() => {
      result.current.handleContentChange({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
      });
    });
    expect(result.current.cacheWarning).toBe(true);

    // Successful save should clear the warning
    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [{ type: "paragraph" }] });
    });
    expect(result.current.cacheWarning).toBe(false);

    // Restore default mock
    vi.mocked(setCachedContent).mockReturnValue(true);
  });

  it("handleContentChange preserves error save status instead of overwriting", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("Bad Request", 400));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Trigger a save failure to set status to "error"
    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });
    expect(result.current.saveStatus).toBe("error");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed with 4xx:"),
      expect.any(ApiRequestError),
    );

    // Typing new content should NOT overwrite the error status
    act(() => {
      result.current.handleContentChange({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "more typing" }] }],
      });
    });

    expect(result.current.saveStatus).toBe("error");
    warnSpy.mockRestore();
  });

  it("handleSelectChapter unblocks a backoff sleep without waiting for the timer (S3)", async () => {
    // Before S3, selecting a new chapter only bumped the seq and aborted
    // the in-flight PATCH — it did NOT unblock the retry backoff. A loop
    // already asleep in setTimeout would sit for up to 8s before the next
    // iteration's seq check ran. Not a correctness bug (the abort/seq
    // stops the network call) but wasteful and kept a timer pinned to a
    // stale chapter id. Assert the handleSave promise resolves promptly
    // after handleSelectChapter, without advancing timers.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("network error"));
    const mockChapter2 = {
      id: "ch2",
      project_id: "p1",
      title: "Two",
      content: { type: "doc", content: [] },
      sort_order: 1,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1)
      .mockResolvedValueOnce(mockChapter2);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Capture the real setTimeout BEFORE vi.useFakeTimers() replaces it, so
    // the Promise.race timeout watchdog below still fires under fake timers.
    // Without this, a regression that leaves savePromise pending would hang
    // the test indefinitely (the fake-timer setTimeout never fires unless
    // advanced) instead of failing fast with "timed out".
    const realSetTimeout = globalThis.setTimeout;
    // Use fake timers so we can prove the wait DIDN'T depend on timers.
    vi.useFakeTimers();
    try {
      let savePromise!: Promise<boolean>;
      act(() => {
        savePromise = result.current.handleSave({ type: "doc", content: [] });
      });
      // Let the first PATCH reject and the retry loop enter the backoff sleep.
      await vi.advanceTimersByTimeAsync(0);
      expect(api.chapters.update).toHaveBeenCalledTimes(1);

      // Select a new chapter. The backoff must be unblocked so the loop
      // reaches its seq check and returns false — without advancing
      // timers to SAVE_BACKOFF_MS[0]=2000ms.
      await act(async () => {
        await result.current.handleSelectChapter("ch2");
      });

      // Resolve the save promise WITHOUT advancing timers further. If S3
      // were unfixed, savePromise would still be pending.
      await expect(
        Promise.race([
          savePromise,
          new Promise((_, reject) => realSetTimeout(() => reject(new Error("timed out")), 50)),
        ]),
      ).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it("cancelPendingSaves resets saving status and error message", async () => {
    // A long-running update simulates the "Saving…" window; cancelPendingSaves
    // should flip the UI out of that stuck state.
    let resolveUpdate: (v: typeof mockChapter1) => void = () => {};
    vi.mocked(api.chapters.update).mockImplementationOnce(
      () =>
        new Promise<typeof mockChapter1>((resolve) => {
          resolveUpdate = resolve;
        }),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    act(() => {
      void result.current.handleSave({ type: "doc", content: [] });
    });
    await waitFor(() => expect(result.current.saveStatus).toBe("saving"));

    act(() => {
      result.current.cancelPendingSaves();
    });
    expect(result.current.saveStatus).toBe("idle");
    expect(result.current.saveErrorMessage).toBeNull();

    // Resolve the pending promise so the abort path completes cleanly.
    await act(async () => {
      resolveUpdate({ ...mockChapter1, word_count: 0 });
      await new Promise((r) => setTimeout(r, 0));
    });
  });

  it("handleSave breaks immediately on 4xx ApiRequestError without retrying", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("Bad Request", 400));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // No need for fake timers — 4xx should not trigger any retry delays
    let returnValue = true;
    await act(async () => {
      returnValue = await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(returnValue).toBe(false);
    expect(result.current.saveStatus).toBe("error");
    // Should only be called once — no retries on client errors
    expect(api.chapters.update).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed with 4xx:"),
      expect.any(ApiRequestError),
    );
    warnSpy.mockRestore();
  });

  it("handleSave logs 4xx errors with console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("Bad Request", 400));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed"),
      expect.any(ApiRequestError),
    );

    warnSpy.mockRestore();
  });

  it("handleSave maps 4xx VALIDATION_ERROR to externalized strings copy (I3)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Raw server-authored English must NOT reach the UI — the mapper in
    // useProjectEditor routes err.code to strings.ts the same way
    // errors/scopes.ts does. Regression guard for I3.
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("Invalid status: xyz", 400, "VALIDATION_ERROR"),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveFailedInvalid);
    expect(result.current.saveErrorMessage).not.toContain("Invalid status: xyz");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed with 4xx:"),
      expect.any(ApiRequestError),
    );
    warnSpy.mockRestore();
  });

  it("handleSave maps 413 PAYLOAD_TOO_LARGE to externalized strings copy (I3)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("Request body too large.", 413, "PAYLOAD_TOO_LARGE"),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveFailedTooLarge);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed with 4xx:"),
      expect.any(ApiRequestError),
    );
    warnSpy.mockRestore();
  });

  it("handleSave breaks immediately on 2xx BAD_JSON and shows committed copy (I5)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    let returnValue = true;
    await act(async () => {
      returnValue = await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(returnValue).toBe(false);
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveCommittedUnreadable);
    // No retry — server may have committed; retrying risks stomp
    expect(api.chapters.update).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  // I2 (review 2026-04-24): CLAUDE.md save-pipeline invariant #2 requires
  // setEditable(false) around any mutation that can leave the server
  // committed while the user cannot see the state. handleSave's terminal
  // BAD_JSON / UPDATE_READ_FAILURE / CORRUPT_CONTENT branches set
  // saveStatus="error" + the committed banner but did NOT request the
  // editor lock. The hook now invokes onRequestEditorLock so
  // EditorPage can pair applyReloadFailedLock with the banner.
  it.each([
    ["BAD_JSON", 200, STRINGS.editor.saveCommittedUnreadable],
    ["UPDATE_READ_FAILURE", 500, STRINGS.editor.saveCommittedUnreadable],
    ["CORRUPT_CONTENT", 500, STRINGS.editor.saveFailedCorrupt],
  ])("handleSave fires onRequestEditorLock on terminal %s (I2)", async (code, status, msg) => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("terminal", status, code));
    const onRequestEditorLock = vi.fn();

    const { result } = renderHook(() => useProjectEditor("test-project", { onRequestEditorLock }));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(onRequestEditorLock).toHaveBeenCalledWith(msg);
    warnSpy.mockRestore();
  });

  // I2 (review 2026-04-26): the chapter.save 404 NOT_FOUND mapping (added
  // earlier in this branch) sets the "This chapter no longer exists"
  // banner via byStatus[404]. Without locking the editor too, the user
  // could keep typing into a chapter the server has already deleted —
  // the next debounced auto-save deterministically 404s, the banner
  // blinks, and the loop continues until reload. CLAUDE.md save-pipeline
  // invariant #2 pairs setEditable(false) with editorLockedMessage; this
  // test pins that pairing for NOT_FOUND.
  it("handleSave fires onRequestEditorLock on 404 NOT_FOUND (I2)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("chapter gone", 404, "NOT_FOUND"),
    );
    const onRequestEditorLock = vi.fn();

    const { result } = renderHook(() => useProjectEditor("test-project", { onRequestEditorLock }));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(onRequestEditorLock).toHaveBeenCalledWith(STRINGS.editor.saveFailedChapterGone);
    expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveFailedChapterGone);
    // No retry — chapter is gone; retrying would deterministically 404 again.
    expect(api.chapters.update).toHaveBeenCalledTimes(1);
    // S1 (agentic-review 2026-05-26): 404 is now in
    // chapter.save.terminalStatuses, so the in-loop break takes the
    // `mapped.terminal` branch (logs "Save failed terminally:") instead
    // of the `isClientError` branch (which logged "Save failed with
    // 4xx:"). Same lock + banner outcome — only the diagnostic warn
    // path changed.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed terminally:"),
      expect.any(ApiRequestError),
    );
    warnSpy.mockRestore();
  });

  // S3 (review 2026-04-26): a 404 that arrives WITHOUT a parseable JSON
  // envelope — e.g. a reverse-proxy HTML 404 page, an upstream that
  // bypassed the express error handler — has no `code` field on the
  // ApiRequestError. The chapter.save scope's byStatus[404] still
  // surfaces saveFailedChapterGone, but the editor-lock branch only
  // checked code === "NOT_FOUND". Pre-fix, the user saw the banner
  // but kept typing into a chapter the server rejects, every
  // debounced auto-save 404'd in a loop, and the banner re-fired on
  // each 404. The fix locks on status === 404 too — same UX as the
  // coded NOT_FOUND case but resilient to envelopes the proxy chain
  // strips. S1 (2026-05-26): the status === 404 hand-coding is gone
  // — chapter.save.terminalStatuses owns the 404 lock now.
  it("handleSave fires onRequestEditorLock on bare 404 (no envelope code) (S3)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      // No third argument: simulates a 404 from a reverse proxy that
      // didn't return the { error: { code, message } } envelope.
      new ApiRequestError("Not Found", 404),
    );
    const onRequestEditorLock = vi.fn();

    const { result } = renderHook(() => useProjectEditor("test-project", { onRequestEditorLock }));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(onRequestEditorLock).toHaveBeenCalledWith(STRINGS.editor.saveFailedChapterGone);
    expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveFailedChapterGone);
    expect(api.chapters.update).toHaveBeenCalledTimes(1);
    // S1 (agentic-review 2026-05-26): see neighbour test above —
    // bare 404 also routes through the terminal branch.
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed terminally:"),
      expect.any(ApiRequestError),
    );
    warnSpy.mockRestore();
  });

  it("handleSave breaks immediately on 500 UPDATE_READ_FAILURE (I5)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError(
        "Chapter was updated but could not be re-read.",
        500,
        "UPDATE_READ_FAILURE",
      ),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    let returnValue = true;
    await act(async () => {
      returnValue = await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(returnValue).toBe(false);
    expect(result.current.saveStatus).toBe("error");
    // Same committed UX as 2xx BAD_JSON — server updated the row, just failed re-read
    expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveCommittedUnreadable);
    expect(api.chapters.update).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("handleSave breaks immediately on 500 CORRUPT_CONTENT (I5)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError(
        "Chapter content is corrupted and cannot be loaded.",
        500,
        "CORRUPT_CONTENT",
      ),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    let returnValue = true;
    await act(async () => {
      returnValue = await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(returnValue).toBe(false);
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveFailedCorrupt);
    expect(api.chapters.update).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("handleSave 4xx error state does not bleed across an A→B→A chapter switch (S5)", async () => {
    // Code review S5: on an A→B→A round-trip while an A save is in-flight,
    // the 4xx response's terminal setSaveStatus("error") was gated only by
    // `activeChapterRef.current?.id === savingChapterId` — which is TRUE
    // after the round-trip because the user is back on A. The stale save's
    // error then bled into A's newly-active session. S5 adds the
    // `!token.isStale()` gate (paralleling the cache-clear guard two lines
    // above) so the old save's failure cannot surface in A's fresh state.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    // Initial load: first chapters.get call returns mockChapter1 for
    // activeChapter; subsequent calls will be made by the chapter switches.
    vi.mocked(api.chapters.get).mockReset();
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1)
      .mockResolvedValueOnce(mockChapter2)
      .mockResolvedValueOnce(mockChapter1);

    // Deferred 4xx rejection so we can switch chapters mid-save, then
    // reject after the round-trip. We mock at api.chapters.update level,
    // so cancelInFlightSave's AbortController.abort() does not propagate
    // into the mock — the promise stays pending until we reject it.
    let rejectSave: (err: Error) => void = () => {};
    vi.mocked(api.chapters.update).mockImplementationOnce(
      () =>
        new Promise<typeof mockChapter1>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter?.id).toBe("ch1"));

    // Kick off save of A; do NOT await (it's pending on our deferred mock).
    let savePromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      savePromise = result.current.handleSave({ type: "doc", content: [] }, "ch1");
    });

    // A→B→A: each switch calls cancelInFlightSave → saveSeq.abort(), which
    // invalidates the save's token. After two switches the token is
    // doubly stale.
    await act(async () => {
      await result.current.handleSelectChapter("ch2");
    });
    await act(async () => {
      await result.current.handleSelectChapter("ch1");
    });
    expect(result.current.activeChapter?.id).toBe("ch1");

    // Now reject the original save with a 4xx. Without S5 the error branch
    // reads activeChapter==="ch1" && savingChapterId==="ch1" → fires
    // setSaveStatus("error") on A's fresh session.
    await act(async () => {
      rejectSave(new ApiRequestError("Bad Request", 400));
      await savePromise;
    });

    // Contract: the stale save's 4xx must not surface on the fresh A session.
    expect(result.current.saveStatus).not.toBe("error");
    expect(result.current.saveErrorMessage).toBeNull();
    warnSpy.mockRestore();
  });

  it("handleSave preserves cached draft on 413 so the user can trim and retry (C1)", async () => {
    // 413 is emitted by the Express body-size guard BEFORE the chapter
    // handler runs — the server never sees the content, let alone stores
    // it. Wiping the local draft here would be the only place the typed
    // content was destroyed, leaving nothing to recover from after the
    // user trims the chapter and retries. Invariant #3: cache-clear only
    // after server success.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { clearCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("Request body too large.", 413, "PAYLOAD_TOO_LARGE"),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());
    vi.mocked(clearCachedContent).mockClear();

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(result.current.saveStatus).toBe("error");
    expect(vi.mocked(clearCachedContent)).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("handleSave clears cached draft on VALIDATION_ERROR so retries don't loop forever", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { clearCachedContent } = await import("../hooks/useContentCache");
    // Server rejected the payload as malformed — it truly cannot store
    // this content, so the client-side draft would feed a retry loop.
    // Only VALIDATION_ERROR earns the cache-wipe (narrowed from "any 4xx"
    // to fix C1: 413 et al. preserve the draft).
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("Invalid content", 400, "VALIDATION_ERROR"),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());
    vi.mocked(clearCachedContent).mockClear();

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(result.current.saveStatus).toBe("error");
    expect(vi.mocked(clearCachedContent)).toHaveBeenCalledWith("ch1");
    warnSpy.mockRestore();
  });

  it("handleSave preserves cached draft on generic 4xx without a known code", async () => {
    // Unknown 4xx codes (e.g. a future server-side condition we haven't
    // taught the client about) are treated conservatively: the server's
    // intent is ambiguous, so preserving the draft is the safer default.
    // Only VALIDATION_ERROR is an explicit "this content can never be
    // stored" signal that warrants wiping.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { clearCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("Bad Request", 400));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());
    vi.mocked(clearCachedContent).mockClear();

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(result.current.saveStatus).toBe("error");
    expect(vi.mocked(clearCachedContent)).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("handleSave clears saveErrorMessage on next save attempt", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update)
      .mockRejectedValueOnce(new ApiRequestError("Bad Request", 400))
      .mockResolvedValueOnce({ ...mockChapter1, word_count: 3 });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });
    // Generic 400 without a known code falls back to the default
    // STRINGS.editor.saveFailed copy rather than surfacing the raw
    // server message (I3).
    expect(result.current.saveErrorMessage).toBe(STRINGS.editor.saveFailed);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed with 4xx:"),
      expect.any(ApiRequestError),
    );

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.saveErrorMessage).toBeNull();
    warnSpy.mockRestore();
  });

  it("handleCreateChapter resets saveStatus and saveErrorMessage from a previous failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("Bad Request", 400));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Trigger a save failure to set status to "error"
    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveErrorMessage).not.toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Save failed with 4xx:"),
      expect.any(ApiRequestError),
    );

    // Create a new chapter — save state should reset
    const newChapter = {
      id: "ch3",
      project_id: "p1",
      title: "Untitled",
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    vi.mocked(api.chapters.create).mockResolvedValue(newChapter);

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    expect(result.current.saveStatus).toBe("idle");
    expect(result.current.saveErrorMessage).toBeNull();
    warnSpy.mockRestore();
  });

  it("handleDeleteChapter surfaces secondary chapter fetch failure via onError (I3)", async () => {
    // Before I3 the post-delete `api.chapters.get(first.id)` failure was
    // swallowed with catch {} and the hook silently fell through to the
    // empty-state UI — the user saw "Add chapter" as if the project had no
    // chapters, even though `remaining` still held other chapters. Surface
    // the failure via the onError callback so the page can show a banner,
    // and warn to the console so the dev signal isn't lost.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1) // initial load
      .mockRejectedValueOnce(new Error("fetch failed")); // secondary fetch after delete
    const onError = vi.fn();

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleDeleteChapter(mockChapter1, onError);
    });

    // Fall-through to the empty state remains: the list-level chapter row
    // has content=null, so setting activeChapter to it would give the
    // editor nothing to render. What changed is that the failure is no
    // longer invisible.
    expect(result.current.activeChapter).toBeNull();
    expect(result.current.chapterWordCount).toBe(0);
    expect(onError).toHaveBeenCalledWith(STRINGS.error.loadChapterFailed);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load chapter after delete:"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("handleStatusChange discards stale revert when superseded by a newer call", async () => {
    // Race: Call A (outline -> rough_draft) fails slowly, Call B (outline -> revised) succeeds fast.
    // Call A's revert should be discarded because Call B already updated to "revised".
    let rejectCallA: (reason: Error) => void = () => {};
    const callAPromise = new Promise<typeof mockChapter1>((_resolve, reject) => {
      rejectCallA = reject;
    });

    vi.mocked(api.chapters.update)
      .mockImplementationOnce(() => callAPromise) // Call A: slow, will fail
      .mockResolvedValueOnce({ ...mockChapter1, status: "revised" }); // Call B: fast, succeeds

    // When Call A fails, the revert path reloads the project — return "outline" (the original)
    const reloadedProject = {
      ...mockProject,
      chapters: [{ ...mockChapter1, status: "outline" }, mockChapter2],
    };
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockResolvedValueOnce(reloadedProject); // reload after Call A failure

    const onErrorA = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Fire Call A (slow) — don't await
    act(() => {
      result.current.handleStatusChange("ch1", "rough_draft", onErrorA);
    });

    // Fire Call B (fast) — it resolves immediately
    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised");
    });

    // Call B should have set status to "revised"
    expect(result.current.project?.chapters[0]!.status).toBe("revised");

    // Now Call A fails — its revert should be discarded
    await act(async () => {
      rejectCallA(new Error("slow failure"));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Status should still be "revised" from Call B, NOT reverted to "outline"
    expect(result.current.project?.chapters[0]!.status).toBe("revised");
    expect(result.current.activeChapter?.status).toBe("revised");
  });

  it("handleStatusChange discards stale revert when newer call lands mid api.projects.get await (I2)", async () => {
    // Narrower race than the existing supersede test: Call A's
    // api.chapters.update fails quickly, but its api.projects.get revert
    // path hangs. While that hangs, Call B lands, succeeds, and writes
    // "revised" optimistically. When A's projects.get finally resolves
    // with the pre-B server state ("outline"), the revert would without
    // the I2 guard stomp B's optimistic "revised" back to "outline" —
    // silent loss of user intent until another click.
    vi.mocked(api.chapters.update)
      .mockRejectedValueOnce(new Error("call A fails")) // Call A rejects immediately
      .mockResolvedValueOnce({ ...mockChapter1, status: "revised" }); // Call B succeeds

    let resolveReload: (project: typeof mockProject) => void = () => {};
    const reloadPromise = new Promise<typeof mockProject>((resolve) => {
      resolveReload = resolve;
    });

    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockImplementationOnce(() => reloadPromise); // Call A's revert reload — hangs

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Fire Call A — rejection enters the revert path, await api.projects.get hangs.
    act(() => {
      result.current.handleStatusChange("ch1", "rough_draft");
    });

    // Let A's rejection settle and reach the projects.get await.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // Fire Call B — lands while A is suspended on projects.get.
    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised");
    });

    expect(result.current.project?.chapters[0]!.status).toBe("revised");

    // Now resolve A's projects.get with pre-B server state. Without the
    // I2 guard this would stomp "revised" back to "outline".
    await act(async () => {
      resolveReload({
        ...mockProject,
        chapters: [{ ...mockChapter1, status: "outline" }, mockChapter2],
      });
      await new Promise((r) => setTimeout(r, 0));
    });

    // Guard fired — B's optimistic update stands.
    expect(result.current.project?.chapters[0]!.status).toBe("revised");
    expect(result.current.activeChapter?.status).toBe("revised");
  });

  it("handleStatusChange falls back to local revert when both API update and server reload fail", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("status update failed"));
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockRejectedValueOnce(new Error("reload failed")); // reload after status change failure

    const onError = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Confirm initial status
    expect(result.current.project?.chapters[0]!.status).toBe("outline");

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised", onError);
    });

    // Should call onError callback instead of returning the error
    expect(onError).toHaveBeenCalledWith(STRINGS.error.statusChangeFailed);
    // After both API update and reload fail, local revert should restore previous status
    expect(result.current.project?.chapters[0]!.status).toBe("outline");
    expect(result.current.activeChapter?.status).toBe("outline");
  });

  it("reloadActiveChapter routes errors to onError callback without setting full-page error (I1)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Defensive reset: Vitest's clearAllMocks() in beforeEach does not
    // drain mockResolvedValueOnce/mockRejectedValueOnce queues, so a
    // prior test's leftover queued rejection can poison this load.
    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Only the follow-up reload fails. The initial load uses the baseline
    // resolved value set in beforeEach.
    vi.mocked(api.chapters.get).mockRejectedValueOnce(new Error("reload boom"));

    const onError = vi.fn();
    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.reloadActiveChapter(onError);
    });

    expect(outcome).toBe("failed");
    expect(onError).toHaveBeenCalledWith(STRINGS.error.loadChapterFailed);
    // Must NOT have set the full-page error — the replace already succeeded
    // on the server, callers must stay in the editor to retry.
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  it("reloadActiveChapter no-ops when expectedChapterId differs from current active (I2)", async () => {
    // When the caller passes an expected chapter id that no longer matches
    // the active chapter (e.g. user switched chapters between the directive
    // and the reload call), the reload must not clear the now-active
    // chapter's cache or fire api.chapters.get. Returning true advertises
    // the skip as intentional, not a failure.
    const { clearCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(clearCachedContent).mockClear();
    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Active is ch1. Caller asks the hook to reload ch2 — mismatch.
    vi.mocked(api.chapters.get).mockClear();

    let outcome: string | undefined;
    await act(async () => {
      outcome = await result.current.reloadActiveChapter(undefined, "ch2");
    });

    // The reload short-circuited: no fetch, no cache clear on the
    // now-active chapter. Outcome is "superseded" — the skip is
    // intentional and useEditorMutation treats it as not-failed but
    // does NOT unlock the editor (I5).
    expect(outcome).toBe("superseded");
    expect(api.chapters.get).not.toHaveBeenCalled();
    expect(vi.mocked(clearCachedContent)).not.toHaveBeenCalled();
  });

  it("reloadActiveChapter in flight during unmount does not setState on a gone component (I5)", async () => {
    // The save path had unmount protection via cancelInFlightSave bumping
    // saveSeq, but reloadActiveChapter was guarded only by
    // selectChapterSeq — and the unmount effect used to need an explicit
    // cancelInFlightSelect() bump. Under useAbortableSequence, each hook
    // instance auto-aborts on unmount, so a post-unmount GET resolution
    // is discarded by selectChapterSeq's isStale() check without any
    // explicit unmount-effect line. This test pins that behavior.
    vi.mocked(api.chapters.get).mockReset().mockResolvedValueOnce(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);
    const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Stall the reload GET. It must resolve AFTER unmount to prove the
    // seq guard fired before setActiveChapter ran.
    let resolveReload: (ch: typeof mockChapter1) => void = () => {};
    vi.mocked(api.chapters.get).mockImplementationOnce(
      () =>
        new Promise<typeof mockChapter1>((resolve) => {
          resolveReload = resolve;
        }),
    );

    let reloadPromise: Promise<"reloaded" | "superseded" | "failed"> = Promise.resolve("failed");
    act(() => {
      reloadPromise = result.current.reloadActiveChapter();
    });

    // Suppress React's noisy setState-on-unmounted warning so the
    // regression condition (did setActiveChapter actually get called?)
    // can be asserted directly rather than inferred from console output.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    unmount();
    await act(async () => {
      resolveReload(mockChapter1);
      await reloadPromise;
    });

    // React would have logged the act/unmounted warning only if the
    // hook tried to setState post-unmount. The guard is the actual
    // contract being tested; the spy is just insurance.
    const setStateWarnings = errorSpy.mock.calls.filter((call) =>
      String(call[0] ?? "").includes("state update on an unmounted"),
    );
    expect(setStateWarnings).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it("handleDeleteChapter unmounting during delete await does not fire post-unmount setState (S3/S4)", async () => {
    // Code review S4: handleDeleteChapter calls selectChapterSeq.start() AFTER
    // `await api.chapters.delete(...)`. If the component unmounts during that
    // await, the post-await start() runs on an unmounted component. Before S3
    // the returned token was fresh (isStale() === false), so setActiveChapter
    // / setChapterWordCount / onError fired post-unmount — React 18 silently
    // swallows setState, but onError is an external callback the caller owns.
    // With S3's mountedRef, post-unmount start() returns a stale token and
    // the `if (token.isStale()) return true` guard short-circuits the branch.
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockReset().mockResolvedValueOnce(mockChapter1);

    let resolveDelete: () => void = () => {};
    vi.mocked(api.chapters.delete).mockImplementationOnce(
      () =>
        new Promise<{ message: string }>((resolve) => {
          resolveDelete = () => resolve({ message: "ok" });
        }),
    );

    const onError = vi.fn();
    const { result, unmount } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Fire the delete of the active chapter. The flow would, after the delete
    // resolves, call selectChapterSeq.start() and then api.chapters.get() for
    // the next chapter — but we unmount first, so start() runs post-unmount.
    let deletePromise: Promise<boolean> = Promise.resolve(false);
    act(() => {
      deletePromise = result.current.handleDeleteChapter(mockChapter1, onError);
    });

    // Unmount BEFORE the delete resolves, so selectChapterSeq.start() will be
    // called on an unmounted component.
    unmount();

    // Now resolve the delete. The hook's catch clause has no chapter to load
    // (we didn't queue a second get mock), but the isStale() guard should
    // short-circuit before that matters.
    await act(async () => {
      resolveDelete();
      await deletePromise;
    });

    // The structural contract: onError is an external callback, and calling
    // it after unmount would surface a spurious error banner on a freshly
    // mounted successor component owned by the same caller.
    expect(onError).not.toHaveBeenCalled();
  });

  it("reloadActiveChapter without onError falls back to setError (legacy callers)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    vi.mocked(api.chapters.get).mockRejectedValueOnce(new Error("reload boom"));

    await act(async () => {
      await result.current.reloadActiveChapter();
    });

    expect(result.current.error).toBe(STRINGS.error.loadChapterFailed);
    warnSpy.mockRestore();
  });

  it("handleCreateChapter targets the new project's slug immediately after a URL-driven slug change (I1)", async () => {
    // Before I1 the slug-ref was only written from project.slug after the
    // new project loaded — a click landing in the inter-project loading
    // window would POST /projects/<old-slug>/chapters, creating a chapter
    // on the project the user had just navigated away from.
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);
    vi.mocked(api.chapters.create)
      .mockReset()
      .mockResolvedValue({
        ...mockChapter1,
        id: "new-ch",
        project_id: "p2",
        title: UNTITLED_CHAPTER,
      });

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    // Stall the next project GET so we exercise the inter-project loading
    // window — click fires while slug has advanced but project state still
    // holds the old project.
    let resolveOther!: (p: typeof otherProject) => void;
    vi.mocked(api.projects.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOther = resolve;
        }),
    );

    rerender({ slug: "other-project" });

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    expect(api.chapters.create).toHaveBeenCalledWith("other-project", expect.any(AbortSignal));
    resolveOther(otherProject);
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));
  });

  it("handleCreateChapter discards response and skips state merge when slug drifts mid-POST (C2)", async () => {
    // Before C2 the response was merged unconditionally. A click-then-
    // navigate race would POST Project A, resolve during Project B's load,
    // and setActiveChapter + setProject would attach Project A's new
    // chapter to Project B — a phantom chapter in the sidebar whose
    // subsequent edits would PATCH the wrong project's row.
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let resolveCreate!: (c: typeof mockChapter1) => void;
    vi.mocked(api.chapters.create)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    // Kick off the create against Project A.
    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.handleCreateChapter();
    });

    // Navigate to Project B while the POST is in flight. The URL slug
    // prop change rewrites projectSlugRef.current synchronously.
    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });

    // Resolve the stale POST with Project A's new chapter.
    await act(async () => {
      resolveCreate({ ...mockChapter1, id: "phantom", project_id: "p1" });
      await createPromise;
    });

    // Wait for Project B to finish loading.
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    // The phantom chapter must NOT have been merged into Project B's state.
    expect(result.current.project?.chapters.find((c) => c.id === "phantom")).toBeUndefined();
  });

  it("handleReorderChapters discards response when slug drifts mid-PUT (C2)", async () => {
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [{ ...mockChapter1, id: "b1" }],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let resolveReorder!: () => void;
    vi.mocked(api.projects.reorderChapters)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<{ message: string }>((resolve) => {
            resolveReorder = () => resolve({ message: "ok" });
          }),
      );

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    let reorderPromise!: Promise<void>;
    act(() => {
      // Pass Project A's chapter ids.
      reorderPromise = result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });

    await act(async () => {
      resolveReorder();
      await reorderPromise;
    });

    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    // Project B's chapter list must still contain its own chapter id.
    // Without the guard the reorder would have filter-dropped Project A's
    // ids against Project B's chapters and left B with an empty list.
    expect(result.current.project?.chapters.map((c) => c.id)).toEqual(["b1"]);
  });

  it("handleCreateChapter discards response after the new project finished loading (C1 2026-04-24)", async () => {
    // The two-part AND drift guard returned early only when BOTH refs
    // drifted. After a cross-project navigation fully completes the URL
    // slug ref and the loaded project's slug have both advanced to B, so
    // ref-against-ref equality is true and the AND short-circuits to
    // false — a stale Project A POST response is then merged into
    // Project B's state. Project id is stable across rename and changes
    // on cross-project navigation; capturing it at POST time and
    // checking against projectRef at response time distinguishes the
    // two and discards only the cross-project leak.
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let resolveCreate!: (c: typeof mockChapter1) => void;
    vi.mocked(api.chapters.create)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.handleCreateChapter();
    });

    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });

    // CRITICAL: wait for Project B to finish loading BEFORE resolving
    // Project A's stale POST. This is the window the AND guard fails:
    // once projectRef.slug === "other-project" and projectSlugRef ===
    // "other-project", ref-against-ref equality holds and the guard
    // decides the response is fresh.
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    await act(async () => {
      resolveCreate({ ...mockChapter1, id: "phantom", project_id: "p1" });
      await createPromise;
    });

    // Project B's state must NOT contain Project A's new chapter.
    expect(result.current.project?.chapters.find((c) => c.id === "phantom")).toBeUndefined();
    expect(result.current.project?.chapters).toEqual([]);
  });

  it("handleReorderChapters discards response after the new project finished loading (C1 2026-04-24)", async () => {
    // Same AND-guard hole: a stale reorder PUT for Project A landing
    // after Project B fully loaded filter-drops Project A's ids against
    // Project B's chapters and leaves B's sidebar empty until refresh.
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [{ ...mockChapter1, id: "b1" }],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let resolveReorder!: () => void;
    vi.mocked(api.projects.reorderChapters)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<{ message: string }>((resolve) => {
            resolveReorder = () => resolve({ message: "ok" });
          }),
      );

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    let reorderPromise!: Promise<void>;
    act(() => {
      reorderPromise = result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });

    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    await act(async () => {
      resolveReorder();
      await reorderPromise;
    });

    // Project B's own chapter must still be present — the stale reorder
    // must not have filter-dropped it.
    expect(result.current.project?.chapters.map((c) => c.id)).toEqual(["b1"]);
  });

  it("handleReorderChapters possiblyCommitted setProject is gated by project drift (C3 2026-04-25)", async () => {
    // C3 in the 2026-04-25 review claimed the possiblyCommitted branch
    // (review line numbers: 839-850) lacked a project-drift guard and
    // would apply Project A's orderedIds to Project B's chapters on
    // 2xx BAD_JSON after a cross-project nav. Verification showed the
    // catch block's earlier drift guard (the same projectRef.id and
    // slug compare that gates the success path) runs BEFORE the
    // possiblyCommitted branch, covering it. The review missed the
    // earlier guard. This test stays as a regression guard so a future
    // refactor that splits the catch's guard into per-branch checks
    // can't silently regress the invariant.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [{ ...mockChapter1, id: "b1" }],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let rejectReorder!: (err: ApiRequestError) => void;
    vi.mocked(api.projects.reorderChapters)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise<{ message: string }>((_resolve, reject) => {
            rejectReorder = reject;
          }),
      );

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    let reorderPromise!: Promise<void>;
    act(() => {
      reorderPromise = result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    await act(async () => {
      rejectReorder(new ApiRequestError("bad json", 200, "BAD_JSON"));
      await reorderPromise;
    });

    // Project B's chapter must still be present — the stale reorder's
    // possiblyCommitted branch must not have filter-dropped it.
    expect(result.current.project?.chapters.map((c) => c.id)).toEqual(["b1"]);
    warnSpy.mockRestore();
  });

  it("S11 (4b.3c.3): a 404 on chapter-create fires onProjectNotFound and does NOT surface the gone-banner", async () => {
    // Post-fix: a 404 on POST /projects/:slug/chapters fires the
    // onProjectNotFound option (EditorPage wires this to navigate("/")
    // so the project list rehydrates), bypasses the createChapterProjectGone
    // banner, and silences the "Failed to create chapter:" warn — a
    // gone-project 404 is the explicit happy-recovery, not a programming
    // bug that needs dev visibility.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("project deleted", 404, "NOT_FOUND"),
    );

    const onProjectNotFound = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project", { onProjectNotFound }));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleCreateChapter(onError);
    });

    expect(onProjectNotFound).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("Failed to create chapter:"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("S17 (4b.3c.3): createRecoveryAbortRef is nulled on successful recovery merge — subsequent committed paths don't re-abort the prior signal", async () => {
    // Indirect assertion: after a successful committed-recovery merge,
    // the recovery ref is nulled. A second committed handleCreateChapter
    // calls `createRecoveryAbortRef.current?.abort()` at the top of its
    // recovery branch; if the prior ref is null, that's a no-op and the
    // first recovery controller's signal stays unaborted. Without the
    // S17 fix the prior ref still points to the completed controller,
    // and the second call's preamble .abort() would flip the prior
    // signal to aborted.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ch3 = {
      id: "ch3",
      project_id: "p1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    const ch4 = { ...ch3, id: "ch4", sort_order: 3 };
    const refreshed1 = { ...mockProject, chapters: [mockChapter1, mockChapter2, ch3] };
    const refreshed2 = { ...mockProject, chapters: [mockChapter1, mockChapter2, ch3, ch4] };

    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("bad json", 200, "BAD_JSON"),
    );

    const recoverySignals: AbortSignal[] = [];
    let getCallCount = 0;
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get).mockImplementation((_slug, signal) => {
      getCallCount++;
      // First call is the initial loadProject; second+ are recovery GETs.
      if (getCallCount > 1 && signal) recoverySignals.push(signal);
      if (getCallCount === 1) return Promise.resolve(mockProject);
      if (getCallCount === 2) return Promise.resolve(refreshed1);
      return Promise.resolve(refreshed2);
    });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project?.chapters).toHaveLength(2));

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleCreateChapter(onError);
    });

    // First recovery succeeded.
    expect(recoverySignals).toHaveLength(1);
    const firstSignal = recoverySignals[0];
    expect(firstSignal?.aborted).toBe(false);

    // Fire a second committed handleCreateChapter.
    await act(async () => {
      await result.current.handleCreateChapter(onError);
    });

    // S17: the first recovery's signal must stay unaborted; the ref was
    // nulled on success so the second recovery's preamble .abort() is
    // a no-op on null.
    expect(firstSignal?.aborted).toBe(false);
    expect(recoverySignals).toHaveLength(2);
    // The second recovery's own signal is also unaborted (its own
    // operation succeeded).
    expect(recoverySignals[1]?.aborted).toBe(false);
    warnSpy.mockRestore();
  });

  it("I3 (review 2026-05-27): a 404 on a stale cross-project POST does NOT fire onProjectNotFound after A→B nav", async () => {
    // Pre-fix: the S11 isNotFound short-circuit at lines 767-774 fired
    // BEFORE the cross-project drift guards at 776-778. If the user
    // navigated A → B while A's create-POST was in flight and A
    // returned 404, onProjectNotFound (wired to navigate("/") in
    // EditorPage) ran and yanked the user back to the project list
    // even though they were actively viewing B. Post-fix: the drift
    // guards run first, so a stale-A 404 after the user is on B is
    // silently dropped — the user keeps editing B.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let rejectCreate!: (err: unknown) => void;
    vi.mocked(api.chapters.create)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectCreate = reject;
          }),
      );

    const onProjectNotFound = vi.fn();
    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug, { onProjectNotFound }),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    // Kick off the create against Project A.
    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.handleCreateChapter();
    });

    // Navigate to Project B before the POST settles.
    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    // Reject the stale A POST with a 404 (A was just deleted server-side).
    await act(async () => {
      rejectCreate(new ApiRequestError("project deleted", 404, "NOT_FOUND"));
      await createPromise;
    });

    // The user is on B — onProjectNotFound must NOT fire; the stale-A
    // 404 is irrelevant to B and is silently dropped.
    expect(onProjectNotFound).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("cross-project nav guard (sweep): handleDeleteChapter does NOT fire onError on the wrong project after A→B nav", async () => {
    // Sibling of I2 (handleRestore) and I1/I3 (handleCreateChapter):
    // handleDeleteChapter's catch routed straight through onError with no
    // project-identity drift guard. If the user clicked Delete on
    // project A and navigated A → B before the POST settled,
    // useTrashManager's confirmDeleteChapter (which passes setActionError
    // as onError) surfaced A's "failed to delete" banner on B.
    // Post-fix: capture projectId at entry; the catch bails before
    // applyMappedError when projectRef has drifted away from the
    // captured id.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let rejectDelete!: (err: unknown) => void;
    vi.mocked(api.chapters.delete)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectDelete = reject;
          }),
      );

    const onError = vi.fn();
    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    // Fire delete against project A — POST is pending.
    let deletePromise!: Promise<unknown>;
    act(() => {
      deletePromise = result.current.handleDeleteChapter(mockChapter2, onError);
    });
    await waitFor(() => expect(api.chapters.delete).toHaveBeenCalled());

    // Navigate to project B before the delete settles.
    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    // Reject the stale-A delete POST.
    await act(async () => {
      rejectDelete(new ApiRequestError("server gone", 500, "INTERNAL_ERROR"));
      await deletePromise;
    });

    // Drift guard: onError must NOT fire on B for an event that happened on A.
    expect(onError).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("cross-project nav guard (sweep): handleStatusChange does NOT setError or fire onError on the wrong project after A→B nav", async () => {
    // handleStatusChange's catch tail routed through applyMappedError
    // with an `if (onError) onError else setError` fallback — both
    // surfaces leak on cross-project nav. setError is the worst case
    // (full-page error overlay).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let rejectPatch!: (err: unknown) => void;
    vi.mocked(api.chapters.update)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectPatch = reject;
          }),
      );

    const onError = vi.fn();
    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    // Fire status change against A — PATCH is pending.
    let statusPromise!: Promise<unknown>;
    act(() => {
      statusPromise = result.current.handleStatusChange("ch1", "revised", onError);
    });
    await waitFor(() => expect(api.chapters.update).toHaveBeenCalled());

    // Navigate to project B.
    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    // Reject the stale-A PATCH.
    await act(async () => {
      rejectPatch(new ApiRequestError("server gone", 500, "INTERNAL_ERROR"));
      await statusPromise;
    });

    expect(onError).not.toHaveBeenCalled();
    // setError fallback also must not have fired.
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  it("I2 (review 2026-05-27 round 3): handleStatusChange possiblyCommitted branch does NOT fire onError on the wrong project after A→B nav", async () => {
    // Pre-fix: the round-2 sweep added an isStaleProject() helper and
    // gated the catch tail's applyMappedError at line ~1545 — but the
    // mapped.possiblyCommitted branch returns BEFORE reaching that
    // guard. On A→B nav mid-PATCH followed by a 200 BAD_JSON
    // (committedCodes routes through the possiblyCommitted branch),
    // both side effects in that branch ran unconditionally:
    //   - confirmedStatusRef.current[chapterId] = status  (writes A's
    //     chapter id into B's confirmed-status cache; corruption bounded
    //     by next loadProject, but still wrong)
    //   - onError?.(mapped.message)                       (surfaces A's
    //     "Status updated but couldn't be read back" banner on B)
    // Post-fix: hoist `if (isStaleProject()) return;` immediately after
    // the `mapped.message === null` ABORTED short-circuit so it gates
    // BOTH the possiblyCommitted branch and the trailing
    // applyMappedError.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    // 200 BAD_JSON — routes through possiblyCommitted (chapter.updateStatus
    // declares `committed:` copy, so the mapper marks 200 BAD_JSON as
    // possiblyCommitted: true).
    let rejectPatch!: (err: unknown) => void;
    vi.mocked(api.chapters.update)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectPatch = reject;
          }),
      );

    const onError = vi.fn();
    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    let statusPromise!: Promise<unknown>;
    act(() => {
      statusPromise = result.current.handleStatusChange("ch1", "revised", onError);
    });
    await waitFor(() => expect(api.chapters.update).toHaveBeenCalled());

    // Navigate to project B before the PATCH settles.
    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    // Reject with 200 BAD_JSON — possiblyCommitted branch fires.
    await act(async () => {
      rejectPatch(new ApiRequestError("bad body", 200, "BAD_JSON"));
      await statusPromise;
    });

    expect(onError).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  it("cross-project nav guard (sweep): handleRenameChapter does NOT fire onError on the wrong project after A→B nav", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    let rejectRename!: (err: unknown) => void;
    vi.mocked(api.chapters.update)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRename = reject;
          }),
      );

    const onError = vi.fn();
    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    let renamePromise!: Promise<unknown>;
    act(() => {
      renamePromise = result.current.handleRenameChapter("ch2", "New Title", onError);
    });
    await waitFor(() => expect(api.chapters.update).toHaveBeenCalled());

    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    rerender({ slug: "other-project" });
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));

    await act(async () => {
      rejectRename(new ApiRequestError("server gone", 500, "INTERNAL_ERROR"));
      await renamePromise;
    });

    expect(onError).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("S11 (4b.3c.3): a 404 falls back to the createChapterProjectGone banner when onProjectNotFound is omitted", async () => {
    // Defensive fallback for hook consumers that can't navigate (tests,
    // storybook, or a future caller that wants the dismissible banner).
    // The scope's byStatus[404] string stays in scopes.ts for this path.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("project deleted", 404, "NOT_FOUND"),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleCreateChapter(onError);
    });

    expect(onError).toHaveBeenCalledWith(STRINGS.error.createChapterProjectGone);
    warnSpy.mockRestore();
  });

  it("handleCreateChapter routes failures through onError callback (I4)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.create).mockRejectedValue(new Error("create boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleCreateChapter(onError);
    });

    // onError receives the failure; full-page error state stays null so
    // the editor session survives a recoverable POST failure.
    expect(onError).toHaveBeenCalledWith(STRINGS.error.createChapterFailed);
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  it("handleCreateChapter refreshes project on 2xx BAD_JSON to avoid duplicate POST (C1)", async () => {
    // Server created the chapter but the response body was unreadable.
    // Without the committed-branch fix, the UI surfaces a generic error
    // and the user's retry click POSTs again → duplicate chapter.
    // Expected: fetch project fresh so the new chapter appears in state,
    // and surface the committed-specific copy via onError.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const newChapter = {
      id: "ch3",
      project_id: "p1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    const refreshedProject = { ...mockProject, chapters: [mockChapter1, mockChapter2, newChapter] };

    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("bad json", 200, "BAD_JSON"),
    );
    // First get = initial load; second get = refresh after committed POST.
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject)
      .mockResolvedValueOnce(refreshedProject);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project?.chapters).toHaveLength(2));

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleCreateChapter(onError);
    });

    // The refresh GET was fired (avoiding the need for another POST).
    expect(api.projects.get).toHaveBeenCalledTimes(2);
    // Banner surfaces the committed-specific copy rather than the generic
    // "Failed to create chapter." that invites retry.
    expect(onError).toHaveBeenCalledWith(STRINGS.error.createChapterResponseUnreadable);
    // New chapter shows up in state from the refresh so the user does not
    // need to click "Add chapter" again.
    expect(result.current.project?.chapters.find((c) => c.id === "ch3")).toBeDefined();
    // I7: the happy path sets the new chapter active. The committed
    // recovery path must match that intent — the user should not see
    // the chapter appear in the sidebar but stay on the previously-
    // active one.
    expect(result.current.activeChapter?.id).toBe("ch3");
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  // I4 (review 2026-04-24): on 2xx BAD_JSON of the title PATCH, the
  // server may have committed a slug change. The recovery GET under
  // the OLD slug then 404s because that slug is dead. Previously the
  // recovery catch swallowed this silently; projectSlugRef stayed
  // pointing at the dead slug and every subsequent save/create/reorder
  // POSTed against it and 404d in a cascade. Fix: on recovery 404
  // fire onRequestEditorLock so EditorPage applies the lock banner,
  // disabling auto-save until the user refreshes.
  it("handleUpdateProjectTitle requests editor lock when recovery GET 404s (I4)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.update).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockRejectedValueOnce(new ApiRequestError("not found", 404)); // recovery 404 under dead slug

    const onRequestEditorLock = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project", { onRequestEditorLock }));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleUpdateProjectTitle("Renamed");
    });

    expect(onRequestEditorLock).toHaveBeenCalledWith(STRINGS.error.updateTitleProjectSlugLost);
    warnSpy.mockRestore();
  });

  it("handleUpdateProjectTitle surfaces committed copy + refreshes on 2xx BAD_JSON (I3)", async () => {
    // Without a committed: branch, a 2xx BAD_JSON response to the rename
    // PATCH left projectSlugRef pointing at the old slug while the server
    // may have moved the project to a new slug — every subsequent save/
    // create/reorder POSTs against the dead slug and 404s, cascading
    // failures until the user refreshes. Expected: surface the committed
    // copy and attempt a project refresh so the case where the slug did
    // not change (e.g. cosmetic rename) recovers in place.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.update).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );
    // Refresh GET returns the same project (rename did not alter slug).
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject)
      .mockResolvedValueOnce({ ...mockProject, title: "Renamed" });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    let returned: string | undefined;
    await act(async () => {
      returned = await result.current.handleUpdateProjectTitle("Renamed");
    });

    // Refresh GET was fired to resync state.
    expect(api.projects.get).toHaveBeenCalledTimes(2);
    // Committed copy surfaced via projectTitleError (keeps edit mode open).
    expect(result.current.projectTitleError).toBe(STRINGS.error.updateTitleResponseUnreadable);
    // Title picked up from refresh so the UI is not stuck on the old one.
    expect(result.current.project?.title).toBe("Renamed");
    // Returns undefined so useProjectTitleEditing keeps edit mode open.
    expect(returned).toBeUndefined();
    warnSpy.mockRestore();
  });

  it("handleCreateChapter refreshes project on READ_AFTER_CREATE_FAILURE (C1)", async () => {
    // Server inserted the chapter but could not re-read it — emits a
    // 500 with READ_AFTER_CREATE_FAILURE. The server message literally
    // says "Do not retry." Same recovery path as the BAD_JSON case.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const newChapter = {
      id: "ch3",
      project_id: "p1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    const refreshedProject = { ...mockProject, chapters: [mockChapter1, mockChapter2, newChapter] };

    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError(
        "Chapter was created but could not be retrieved.",
        500,
        "READ_AFTER_CREATE_FAILURE",
      ),
    );
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject)
      .mockResolvedValueOnce(refreshedProject);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project?.chapters).toHaveLength(2));

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleCreateChapter(onError);
    });

    expect(api.projects.get).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(STRINGS.error.createChapterReadAfterFailure);
    expect(result.current.project?.chapters.find((c) => c.id === "ch3")).toBeDefined();
    // I7: recovery path sets the newly-created chapter active to match
    // the happy path's setActiveChapter(newChapter).
    expect(result.current.activeChapter?.id).toBe("ch3");
    warnSpy.mockRestore();
  });

  it("seeds confirmedStatusRef for newly-created chapters so a later revert can find a baseline (C2 2026-04-25)", async () => {
    // confirmedStatusRef is consulted by handleStatusChange's local-revert
    // fallback when both the PATCH and the recovery GET fail. Before the
    // fix, the ref was only seeded inside loadProject's success path —
    // newly-created chapters never seeded a baseline, so the fallback at
    //   if (!reverted && previousStatus !== undefined) { ... }
    // silently skipped, leaving the optimistic status on screen even
    // though the server never accepted it.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const newChapter = {
      id: "ch3",
      project_id: "p1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    vi.mocked(api.chapters.create).mockResolvedValue(newChapter);
    // PATCH rejects with bare 5xx → walks the local-revert fallback
    // (non-committed code, no possiblyCommitted shortcut).
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("server error", 500));
    // Recovery GET rejects so the surgical-revert branch falls through
    // to the local-revert branch that reads previousStatus from the
    // confirmed-status cache.
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject)
      .mockRejectedValueOnce(new Error("get boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleCreateChapter();
    });
    expect(result.current.project?.chapters.find((c) => c.id === "ch3")).toBeDefined();

    await act(async () => {
      await result.current.handleStatusChange("ch3", "drafting");
    });

    // After the double-failure, the optimistic "drafting" must be
    // reverted to the seeded baseline ("outline") rather than left
    // on screen — the server never accepted "drafting".
    const ch3 = result.current.project?.chapters.find((c) => c.id === "ch3");
    expect(ch3?.status).toBe("outline");
    warnSpy.mockRestore();
  });

  it("resets confirmedStatusRef when loadProject fires (I7 2026-04-25)", async () => {
    // I7: the hook persists across slug changes (refs survive). On a
    // failed loadProject, the prior project's confirmed-status cache
    // would otherwise persist, and a later status revert against the
    // partially-rendered new project would read the wrong baseline.
    // Reset the cache up-front so it only ever holds the current
    // project's state. This test covers the invariant by chaining:
    // (1) seed via initial load, (2) overwrite via successful PATCH,
    // (3) switch to a slug whose load fails, (4) trigger a revert path
    // and verify the local-revert fallback skips (cache empty →
    // previousStatus undefined → optimistic value remains).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load: p1 with ch1=outline
      .mockRejectedValueOnce(new Error("p2 load boom")) // p2 load fails
      .mockRejectedValueOnce(new Error("revert recovery boom")); // status revert recovery

    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("server error", 500));

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.project).toBeTruthy());
    // Cache seeded: ch1=outline.

    // Switch to other-project; its load fails. project state stays at p1.
    rerender({ slug: "other-project" });
    await waitFor(() => expect(api.projects.get).toHaveBeenCalledTimes(2));

    // Trigger a status PATCH on ch1 (still rendered from p1's state).
    // PATCH fails, recovery GET fails, falls through to local-revert.
    // Without I7: cache returns "outline", revert lands on "outline".
    // With I7: cache was wiped at the second loadProject's start, so
    // previousStatus is undefined, the local-revert fallback skips,
    // and the optimistic "revised" remains on screen.
    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised");
    });

    const ch1 = result.current.project?.chapters.find((c) => c.id === "ch1");
    expect(ch1?.status).toBe("revised");
    warnSpy.mockRestore();
  });

  it("seeds confirmedStatusRef for chapters created via the BAD_JSON recovery path (C2 2026-04-25)", async () => {
    // Same invariant as above, but the chapter arrives via
    // handleCreateChapter's possiblyCommitted recovery branch (the
    // setActiveChapter(newest) path). Before the fix, the recovery
    // branch only setProject(refreshed) — confirmedStatusRef was
    // never seeded, so a later status revert would read undefined.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const newChapter = {
      id: "ch3",
      project_id: "p1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "revised" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    const refreshedProject = { ...mockProject, chapters: [mockChapter1, mockChapter2, newChapter] };
    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("bad json", 200, "BAD_JSON"),
    );
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("server error", 500));
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject)
      .mockResolvedValueOnce(refreshedProject)
      .mockRejectedValueOnce(new Error("get boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleCreateChapter();
    });
    expect(result.current.project?.chapters.find((c) => c.id === "ch3")).toBeDefined();

    await act(async () => {
      await result.current.handleStatusChange("ch3", "drafting");
    });

    // The recovery-path-seeded baseline ("revised") restores after
    // the double-failure revert.
    const ch3 = result.current.project?.chapters.find((c) => c.id === "ch3");
    expect(ch3?.status).toBe("revised");
    warnSpy.mockRestore();
  });

  it("create-recovery is not aborted by a sibling status-revert recovery (C1 2026-04-25)", async () => {
    // Before the fix, handleCreateChapter, handleStatusChange and
    // handleUpdateProjectTitle all wrote their recovery AbortController
    // to a single shared `recoveryGetAbortRef`. If a status-revert
    // recovery fired while a create-recovery GET was in flight, the
    // status path's `recoveryGetAbortRef.current?.abort()` aborted the
    // create's controller. The create's recovery body wraps everything
    // in `try { ... } catch {}`, so the abort was silently swallowed,
    // the new chapter never landed in the sidebar, and the user saw
    // the committed banner with no actionable state change.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const newChapter = {
      ...mockChapter2,
      id: "ch3",
      sort_order: 2,
    };
    const refreshedProject = {
      ...mockProject,
      chapters: [mockChapter1, mockChapter2, newChapter],
    };

    // Create POST → 2xx BAD_JSON ⇒ recovery GET path.
    vi.mocked(api.chapters.create).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );
    // Status PATCH → bare 5xx ⇒ status-revert recovery GET path
    // (non-committed, so it walks the revert branch).
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("server error", 500));

    // Capture each api.projects.get call's signal so we can assert
    // the create's recovery controller was NOT aborted by the status
    // recovery.
    let resolveCreateRecovery!: (val: typeof refreshedProject) => void;
    const createRecoveryPromise = new Promise<typeof refreshedProject>((res) => {
      resolveCreateRecovery = res;
    });
    const capturedSignals: Array<AbortSignal | undefined> = [];
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get).mockImplementation(async (_slug, signal) => {
      capturedSignals.push(signal);
      // Calls in order: 1=initial load, 2=create recovery (deferred),
      // 3=status revert recovery (resolves immediately).
      if (capturedSignals.length === 1) return mockProject;
      if (capturedSignals.length === 2) return createRecoveryPromise;
      return mockProject;
    });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    // Kick off create. Its recovery GET will be parked on createRecoveryPromise.
    let createPromise!: Promise<unknown>;
    act(() => {
      createPromise = result.current.handleCreateChapter();
    });
    // Wait until the recovery GET has been dispatched (capturedSignals.length === 2).
    await waitFor(() => expect(capturedSignals.length).toBe(2));

    // Now fire a status change — its catch path will start its own
    // recovery GET. With per-handler refs, the create's signal must
    // remain un-aborted.
    await act(async () => {
      await result.current.handleStatusChange("ch1", "drafting");
    });

    // Status recovery dispatched.
    expect(capturedSignals.length).toBeGreaterThanOrEqual(3);
    // Create's recovery signal must NOT be aborted by the status path.
    expect(capturedSignals[1]?.aborted).toBe(false);

    // Resolve the create recovery so the post-await branch can run.
    await act(async () => {
      resolveCreateRecovery(refreshedProject);
      await createPromise;
    });

    // The create's recovery setProject must have run — chapter ch3 lands.
    expect(result.current.project?.chapters.find((c) => c.id === "ch3")).toBeDefined();
    expect(result.current.activeChapter?.id).toBe("ch3");
    warnSpy.mockRestore();
  });

  it("I1 (review 2026-05-27 round 2): rapid Add Chapter — a stale recovery GET-A does NOT clobber Create-B's successful merge", async () => {
    // Pre-fix: handleCreateChapter's recovery branch had no
    // sequence-token guard around its post-await setProject /
    // reseedConfirmedStatusesFromProject / setActiveChapter writes.
    // Reachable sequence:
    //   1. POST-A returns 200 BAD_JSON → catch dispatches recovery GET-A
    //      (pending).
    //   2. Before GET-A resolves, user clicks Add Chapter again →
    //      POST-B succeeds → happy-path setProject merges ch-b.
    //   3. GET-A resolves with a snapshot captured BEFORE ch-b landed.
    //      Pre-fix: setProject(refreshed-A) replaced the whole project,
    //      silently dropping ch-b from the sidebar; the post-S17
    //      ref-nulling made the race more likely because the second
    //      create no longer aborted A's still-pending recovery.
    // Post-fix: useAbortableSequence's createToken captured at
    // handleCreateChapter-A entry goes stale when Create-B's start()
    // bumps the epoch; GET-A's .then bails before touching state.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chB = {
      id: "ch-b",
      project_id: "p1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    // Stale snapshot captured BEFORE B landed — no ch-b in chapters.
    const staleSnapshotA = {
      ...mockProject,
      chapters: [mockChapter1, mockChapter2],
    };

    // Create A rejects 200 BAD_JSON; Create B resolves with ch-b.
    vi.mocked(api.chapters.create)
      .mockReset()
      .mockImplementationOnce(() =>
        Promise.reject(new ApiRequestError("bad json", 200, "BAD_JSON")),
      )
      .mockImplementationOnce(() => Promise.resolve(chB));

    // Defer recovery GET-A so Create-B can run before it resolves.
    let resolveGetA!: (p: typeof staleSnapshotA) => void;
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockImplementationOnce(
        () =>
          new Promise<typeof staleSnapshotA>((resolve) => {
            resolveGetA = resolve;
          }),
      );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project?.chapters).toHaveLength(2));

    // Fire Create-A — POST rejects synchronously → catch enters the
    // recovery branch and `await api.projects.get(...)` pins the
    // handleCreateChapter promise on GET-A (recovery is awaited by the
    // handler, not fire-and-forget). Do NOT await it here.
    let createAPromise!: Promise<void>;
    act(() => {
      createAPromise = result.current.handleCreateChapter();
    });
    // Let microtasks run so the POST-A rejection and the GET-A dispatch
    // both settle into their pending state.
    await act(async () => {
      await Promise.resolve();
    });
    expect(api.projects.get).toHaveBeenCalledTimes(2);

    // Fire Create-B → POST-B resolves with ch-b → happy-path setProject
    // merges ch-b into project state. createSeq.start() at Create-B
    // entry also invalidates Create-A's token.
    await act(async () => {
      await result.current.handleCreateChapter();
    });
    const chapterIdsAfterB = result.current.project?.chapters.map((c) => c.id);
    expect(chapterIdsAfterB).toContain("ch-b");

    // Resolve GET-A with the stale snapshot (no ch-b). Create-A's
    // recovery branch now runs its post-await checks — with the
    // sequence guard, it must bail before setProject / reseed /
    // setActiveChapter.
    await act(async () => {
      resolveGetA(staleSnapshotA);
      await createAPromise;
    });

    // Sequence guard: GET-A's .then must bail before touching state, so
    // ch-b stays in the sidebar.
    expect(result.current.project?.chapters.map((c) => c.id)).toContain("ch-b");
    // And the active chapter stays on ch-b (Create-B's setActiveChapter),
    // not silently pulled back to one of A's snapshot's chapters.
    expect(result.current.activeChapter?.id).toBe("ch-b");
    warnSpy.mockRestore();
  });

  it("S1 (review 2026-05-27 round 2): handleCreateChapter recovery GET uses the current slug, not the captured one (survives mid-flight rename)", async () => {
    // Pre-fix: handleCreateChapter captured `slug` at handler entry
    // and reused it for the recovery GET in the possiblyCommitted
    // branch. If handleUpdateProjectTitle landed between create POST
    // dispatch and the catch firing, projectSlugRef.current had
    // already advanced to the new slug — but the captured `slug` was
    // stale. The recovery GET then fetched /projects/old-slug, 404'd,
    // and the user saw the committed banner with no sidebar refresh.
    // Post-fix: read projectSlugRef.current at the GET call site so
    // the freshest slug is used. Mirrors S2 in useTrashManager.ts.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const renamedProject = {
      ...mockProject,
      slug: "renamed-project",
      title: "Renamed",
    };

    // Defer the create POST so the rename can land first.
    let rejectCreate!: (err: unknown) => void;
    vi.mocked(api.chapters.create)
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectCreate = reject;
          }),
      );

    // Rename PATCH resolves with the new slug; this updates
    // projectSlugRef.current to "renamed-project".
    vi.mocked(api.projects.update).mockReset().mockResolvedValue(renamedProject);

    // Capture the slug the recovery GET is called with.
    let recoveryGetSlug: string | undefined;
    vi.mocked(api.projects.get).mockReset();
    vi.mocked(api.projects.get)
      .mockResolvedValueOnce(mockProject) // initial load
      .mockImplementationOnce((slug, _signal) => {
        recoveryGetSlug = slug;
        return Promise.resolve({ ...renamedProject, chapters: [mockChapter1, mockChapter2] });
      });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project?.chapters).toHaveLength(2));

    // Fire create — POST is pending.
    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.handleCreateChapter();
    });
    // Wait for the POST to be dispatched.
    await waitFor(() => expect(api.chapters.create).toHaveBeenCalled());

    // Rename the project while the create POST is still in flight.
    // This writes projectSlugRef.current = "renamed-project".
    await act(async () => {
      await result.current.handleUpdateProjectTitle("Renamed");
    });
    expect(result.current.project?.slug).toBe("renamed-project");

    // Reject the create POST with 200 BAD_JSON → catch enters the
    // recovery branch. Pre-fix: GET uses captured "test-project" →
    // 404. Post-fix: GET uses projectSlugRef.current === "renamed-project".
    await act(async () => {
      rejectCreate(new ApiRequestError("bad json", 200, "BAD_JSON"));
      await createPromise;
    });

    expect(recoveryGetSlug).toBe("renamed-project");
    warnSpy.mockRestore();
  });

  it("handleStatusChange preserves optimistic status on 2xx BAD_JSON + surfaces committed copy (I6)", async () => {
    // 2xx BAD_JSON means the server committed the new status but the
    // response body was unreadable. Reverting (locally or from the
    // server) either silently no-ops (reload returns the new status) or
    // fights the server's committed state. Conservative behavior: keep
    // the optimistic update and surface the committed copy so the user
    // knows the response was ambiguous. Skipping the revert also avoids
    // the unnecessary project GET.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );
    // Guard: projects.get must NOT be called for the revert on committed.
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    const onError = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleStatusChange("ch1", "revised", onError);
    });

    // Only the initial project load — no revert GET.
    expect(api.projects.get).toHaveBeenCalledTimes(1);
    // Optimistic status stands because the server committed it.
    expect(result.current.project?.chapters[0]!.status).toBe("revised");
    expect(result.current.activeChapter?.status).toBe("revised");
    // Committed copy surfaced, not the generic fallback.
    expect(onError).toHaveBeenCalledWith(STRINGS.error.statusChangeResponseUnreadable);
    warnSpy.mockRestore();
  });

  it("handleReorderChapters applies order on 2xx BAD_JSON + surfaces committed copy (I6)", async () => {
    // Server committed the reorder but the body was unreadable. The
    // previous behavior left setProject untouched, so the chapter list
    // visually snapped back to the pre-drag order even though the
    // server had the new order. Apply the requested order to state on
    // possiblyCommitted so the UI matches the committed server state,
    // and surface the committed copy so the user knows to refresh.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.reorderChapters).mockRejectedValue(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    const onError = vi.fn();
    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleReorderChapters(["ch2", "ch1"], onError);
    });

    // Reorder applied to state despite the unreadable body.
    expect(result.current.project?.chapters.map((c) => c.id)).toEqual(["ch2", "ch1"]);
    expect(onError).toHaveBeenCalledWith(STRINGS.error.reorderResponseUnreadable);
    warnSpy.mockRestore();
  });

  it("handleReorderChapters routes failures through onError callback (I4)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.reorderChapters).mockRejectedValue(new Error("reorder boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleReorderChapters(["ch2", "ch1"], onError);
    });

    expect(onError).toHaveBeenCalledWith(STRINGS.error.reorderFailed);
    expect(result.current.error).toBeNull();
    warnSpy.mockRestore();
  });

  it("handleUpdateProjectTitle aborts in-flight PATCH when a newer rename fires (I1 2026-04-24)", async () => {
    // Rapid title edits used to fire overlapping PATCHes. The S7 drift
    // guard discarded the stale response but the older PATCH had
    // already reached the server — SQLite's writer-lock ordering (not
    // client dispatch order) decided which title won. Clip the wire
    // by passing an AbortSignal to api.projects.update and aborting
    // it before issuing the next rename.
    const renamed2 = { ...mockProject, title: "Second", slug: "test-project" };

    vi.mocked(api.projects.update).mockReset();
    const signals: (AbortSignal | undefined)[] = [];
    vi.mocked(api.projects.update)
      .mockImplementationOnce(async (_slug, _data, signal) => {
        signals.push(signal);
        // Stay in flight until aborted; the second call will abort us.
        return pendingUntilAbort<typeof renamed2>(signal);
      })
      .mockImplementationOnce(async (_slug, _data, signal) => {
        signals.push(signal);
        return renamed2;
      });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    // Kick off the first rename (stays in flight).
    act(() => {
      void result.current.handleUpdateProjectTitle("First");
    });

    // Wait for the first PATCH to be dispatched and its signal captured.
    await waitFor(() => expect(signals.length).toBeGreaterThanOrEqual(1));

    // Fire the second rename — should abort the first.
    await act(async () => {
      await result.current.handleUpdateProjectTitle("Second");
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(result.current.project?.title).toBe("Second");
  });

  it("handleCreateChapter response survives a concurrent rename (S6)", async () => {
    // handleCreateChapter captured the slug at entry and compared it
    // against projectSlugRef after the POST. handleUpdateProjectTitle
    // rewrites that ref on rename success, so a rename between the
    // create POST's dispatch and its response tripped the slug-drift
    // guard and silently discarded a valid chapter. Project id is
    // stable across rename — compare ids so the response lands.
    const renamedProject = {
      ...mockProject,
      slug: "renamed-project",
      title: "Renamed",
    };
    const newChapter = {
      id: "ch3",
      project_id: "p1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };

    vi.mocked(api.chapters.create).mockReset();
    let resolveCreate!: (c: typeof newChapter) => void;
    vi.mocked(api.chapters.create).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );
    vi.mocked(api.projects.update).mockResolvedValue(renamedProject);

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    // Kick off the create. The POST stays in flight.
    let createPromise!: Promise<void>;
    act(() => {
      createPromise = result.current.handleCreateChapter();
    });

    // User renames the project while the POST is in flight —
    // handleUpdateProjectTitle rewrites projectSlugRef to the new slug.
    await act(async () => {
      await result.current.handleUpdateProjectTitle("Renamed");
    });

    // Resolve the create. The response belongs to the same project
    // (by id), so it must land in state despite the slug drift.
    await act(async () => {
      resolveCreate(newChapter);
      await createPromise;
    });

    expect(result.current.project?.chapters.find((c) => c.id === "ch3")).toBeDefined();
  });

  it("transitions slug to undefined without leaving a stale projectSlugRef (S3)", async () => {
    // The prev-slug sentinel used to rewrite projectSlugRef only when
    // the new slug was defined, leaving the ref pointing at the prior
    // project after a defined→undefined transition. Any handler firing
    // in that window (e.g. a late-user click racing navigation) would
    // POST against the old project. Clearing the ref to undefined in
    // lock-step with prevSlugArgRef closes that window.
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.chapters.create).mockReset();

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string | undefined }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" as string | undefined } },
    );
    await waitFor(() => expect(result.current.project?.slug).toBe("test-project"));

    rerender({ slug: undefined });

    // After the transition, handleCreateChapter must refuse rather than
    // POST to /projects/test-project/chapters.
    await act(async () => {
      await result.current.handleCreateChapter();
    });
    expect(api.chapters.create).not.toHaveBeenCalled();
  });

  it("cross-project slug change resets activeChapter when cached id is absent from new project (I4)", async () => {
    const otherChapter = { ...mockChapter1, id: "other-1", project_id: "p2" };
    const otherProject = {
      ...mockProject,
      id: "p2",
      slug: "other-project",
      chapters: [otherChapter],
    };

    vi.mocked(api.chapters.get).mockReset().mockResolvedValue(mockChapter1);
    vi.mocked(api.projects.get).mockReset().mockResolvedValue(mockProject);

    const { rerender, result } = renderHook(
      ({ slug }: { slug: string }) => useProjectEditor(slug),
      { initialProps: { slug: "test-project" } },
    );
    await waitFor(() => expect(result.current.activeChapter?.id).toBe("ch1"));

    // Now swap the mocks so that the second project load returns a
    // different project and chapters.get returns the other project's
    // first chapter.
    vi.mocked(api.projects.get).mockResolvedValueOnce(otherProject);
    vi.mocked(api.chapters.get).mockResolvedValueOnce(otherChapter);

    rerender({ slug: "other-project" });
    await waitFor(() => expect(result.current.project?.slug).toBe("other-project"));
    // After the slug change, the effect should have observed that "ch1"
    // is no longer in the newly-loaded project's chapter set and loaded
    // project B's first chapter instead.
    await waitFor(() => expect(result.current.activeChapter?.id).toBe("other-1"));
  });
});

// (Migration structural check moved to migrationStructuralCheck.test.ts —
// S2, 2026-04-22 review. Four near-identical per-file greps collapsed into
// one tree-wide assertion.)
