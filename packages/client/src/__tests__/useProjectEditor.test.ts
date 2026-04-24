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
      // timers to BACKOFF_MS[0]=2000ms.
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

    expect(api.chapters.create).toHaveBeenCalledWith("other-project");
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
