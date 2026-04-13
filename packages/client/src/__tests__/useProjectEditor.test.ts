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
    expect(api.chapters.update).toHaveBeenCalledWith("ch1", {
      content: { type: "doc", content: [] },
    });
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
    vi.mocked(api.projects.get).mockRejectedValue(new Error("Project not found."));

    const { result } = renderHook(() => useProjectEditor("nonexistent-id"));

    await waitFor(() => {
      expect(result.current.error).toBe(STRINGS.error.loadProjectFailed);
    });

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
    vi.mocked(api.chapters.create).mockRejectedValue(new Error("create boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleCreateChapter();
    });

    expect(result.current.error).toBe(STRINGS.error.createChapterFailed);
  });

  it("sets error when handleSelectChapter fails", async () => {
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1) // initial load
      .mockRejectedValueOnce(new Error("select boom")); // select fails

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSelectChapter("ch2");
    });

    expect(result.current.error).toBe(STRINGS.error.loadChapterFailed);
  });

  it("calls onError callback when handleDeleteChapter fails (does not set full-page error)", async () => {
    vi.mocked(api.chapters.delete).mockRejectedValue(new Error("delete boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleDeleteChapter(mockChapter2, onError);
    });

    expect(onError).toHaveBeenCalledWith(STRINGS.error.deleteChapterFailed);
    expect(result.current.error).toBeNull();
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
    vi.mocked(api.projects.reorderChapters).mockRejectedValue(new Error("reorder boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    expect(result.current.error).toBe(STRINGS.error.reorderFailed);
  });

  it("returns undefined when handleUpdateProjectTitle fails", async () => {
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
  });

  it("calls onError callback when handleRenameChapter fails (does not set full-page error)", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("rename boom"));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    const onError = vi.fn();
    await act(async () => {
      await result.current.handleRenameChapter("ch1", "New Name", onError);
    });

    expect(onError).toHaveBeenCalledWith(STRINGS.error.renameChapterFailed);
    expect(result.current.error).toBeNull();
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
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("Bad Request", 400));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Trigger a save failure to set status to "error"
    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });
    expect(result.current.saveStatus).toBe("error");

    // Typing new content should NOT overwrite the error status
    act(() => {
      result.current.handleContentChange({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "more typing" }] }],
      });
    });

    expect(result.current.saveStatus).toBe("error");
  });

  it("handleSave breaks immediately on 4xx ApiRequestError without retrying", async () => {
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

  it("handleSave exposes server error message on 4xx failure", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(
      new ApiRequestError("Invalid status: xyz", 400),
    );

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveErrorMessage).toBe("Unable to save \u2014 check connection");
  });

  it("handleSave clears saveErrorMessage on next save attempt", async () => {
    vi.mocked(api.chapters.update)
      .mockRejectedValueOnce(new ApiRequestError("Bad Request", 400))
      .mockResolvedValueOnce({ ...mockChapter1, word_count: 3 });

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });
    expect(result.current.saveErrorMessage).toBe("Unable to save \u2014 check connection");

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });
    expect(result.current.saveStatus).toBe("saved");
    expect(result.current.saveErrorMessage).toBeNull();
  });

  it("handleCreateChapter resets saveStatus and saveErrorMessage from a previous failure", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new ApiRequestError("Bad Request", 400));

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    // Trigger a save failure to set status to "error"
    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });
    expect(result.current.saveStatus).toBe("error");
    expect(result.current.saveErrorMessage).not.toBeNull();

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
  });

  it("handleDeleteChapter falls through to empty state when secondary chapter fetch fails", async () => {
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter1) // initial load
      .mockRejectedValueOnce(new Error("fetch failed")); // secondary fetch after delete

    const { result } = renderHook(() => useProjectEditor("test-project"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleDeleteChapter(mockChapter1);
    });

    // Secondary fetch for ch2 failed, so should fall through to null/0
    expect(result.current.activeChapter).toBeNull();
    expect(result.current.chapterWordCount).toBe(0);
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
});
