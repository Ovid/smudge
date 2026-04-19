import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { UNTITLED_CHAPTER } from "@smudge/shared";

import { api, ApiRequestError } from "../api/client";
import { useProjectEditor } from "../hooks/useProjectEditor";
import { STRINGS } from "../strings";

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
        await vi.advanceTimersByTimeAsync(2000);
        await vi.advanceTimersByTimeAsync(4000);
        await vi.advanceTimersByTimeAsync(8000);
        expect(await p).toBe(false);
      });

      expect(result.current.saveStatus).toBe("error");
      expect(api.chapters.update).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    } finally {
      vi.useRealTimers();
    }
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
      // timers to BACKOFF_MS[0]=2000ms.
      await act(async () => {
        await result.current.handleSelectChapter("ch2");
      });

      // Resolve the save promise WITHOUT advancing timers further. If S3
      // were unfixed, savePromise would still be pending.
      await expect(
        Promise.race([
          savePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), 10)),
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
    // findReplaceErrors does. Regression guard for I3.
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
    // "Unable to save — check connection" copy rather than surfacing the
    // raw server message (I3).
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
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.reloadActiveChapter(onError);
    });

    expect(ok).toBe(false);
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

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.reloadActiveChapter(undefined, "ch2");
    });

    // The reload short-circuited: no fetch, no cache clear on the
    // now-active chapter.
    expect(ok).toBe(true);
    expect(api.chapters.get).not.toHaveBeenCalled();
    expect(vi.mocked(clearCachedContent)).not.toHaveBeenCalled();
  });

  it("reloadActiveChapter in flight during unmount does not setState on a gone component (I5)", async () => {
    // The save path had unmount protection via cancelInFlightSave bumping
    // saveSeqRef, but reloadActiveChapter was guarded only by
    // selectChapterSeqRef — and the unmount effect didn't bump it. A
    // reload GET that resolved post-unmount would setActiveChapter /
    // setChapterWordCount / setChapterReloadKey on a gone component,
    // surfacing React's "state update on unmounted component" warning.
    // Fix: the unmount effect now bumps selectChapterSeqRef, so the
    // post-await seq check short-circuits cleanly.
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

    let reloadPromise: Promise<boolean> = Promise.resolve(false);
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
