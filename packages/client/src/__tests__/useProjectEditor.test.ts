import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

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
    },
    chapters: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      restore: vi.fn(),
    },
  },
}));

vi.mock("../hooks/useContentCache", () => ({
  getCachedContent: vi.fn().mockReturnValue(null),
  setCachedContent: vi.fn(),
  clearCachedContent: vi.fn(),
}));

import { api } from "../api/client";
import { useProjectEditor } from "../hooks/useProjectEditor";

const mockChapter1 = {
  id: "ch1",
  project_id: "p1",
  title: "Chapter 1",
  content: { type: "doc", content: [{ type: "paragraph" }] },
  sort_order: 0,
  word_count: 0,
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
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
};

const mockProject = {
  id: "p1",
  title: "Test Project",
  mode: "fiction" as const,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
  chapters: [mockChapter1, mockChapter2],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.projects.get).mockResolvedValue(mockProject);
  vi.mocked(api.chapters.get).mockResolvedValue(mockChapter1);
});

describe("useProjectEditor", () => {
  it("loads project and first chapter on mount", async () => {
    const { result } = renderHook(() => useProjectEditor("p1"));

    await waitFor(() => {
      expect(result.current.project).toEqual(mockProject);
      expect(result.current.activeChapter).toEqual(mockChapter1);
    });
  });

  it("creates a new chapter", async () => {
    const newChapter = {
      id: "ch3",
      project_id: "p1",
      title: "Untitled Chapter",
      content: null,
      sort_order: 2,
      word_count: 0,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    };
    vi.mocked(api.chapters.create).mockResolvedValue(newChapter);

    const { result } = renderHook(() => useProjectEditor("p1"));
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

    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    expect(result.current.saveStatus).toBe("saved");
    expect(api.chapters.update).toHaveBeenCalledWith("ch1", {
      content: { type: "doc", content: [] },
    });
  });

  it("does not overwrite activeChapter content on save response", async () => {
    const updatedChapter = { ...mockChapter1, word_count: 5 };
    vi.mocked(api.chapters.update).mockResolvedValue(updatedChapter);

    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    const originalContent = result.current.activeChapter?.content;

    await act(async () => {
      await result.current.handleSave({ type: "doc", content: [] });
    });

    // activeChapter.content should NOT be replaced by the save response
    expect(result.current.activeChapter?.content).toEqual(originalContent);
    // But word_count should be synced into project.chapters
    expect(result.current.project?.chapters[0].word_count).toBe(5);
  });

  it("sets save status to error after exhausting retries", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("fail"));

    const { result } = renderHook(() => useProjectEditor("p1"));
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

    const { result } = renderHook(() => useProjectEditor("p1"));
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

    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSelectChapter("ch2");
    });

    expect(result.current.activeChapter?.id).toBe("ch2");
  });

  it("does not switch when selecting the already-active chapter", async () => {
    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      await result.current.handleSelectChapter("ch1");
    });

    // get should only have been called once (initial load)
    expect(api.chapters.get).toHaveBeenCalledTimes(1);
  });

  it("deletes a non-active chapter", async () => {
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });

    const { result } = renderHook(() => useProjectEditor("p1"));
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

    const { result } = renderHook(() => useProjectEditor("p1"));
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

    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleReorderChapters(["ch2", "ch1"]);
    });

    expect(result.current.project?.chapters[0].id).toBe("ch2");
    expect(result.current.project?.chapters[1].id).toBe("ch1");
  });

  it("updates the project title", async () => {
    vi.mocked(api.projects.update).mockResolvedValue({
      ...mockProject,
      title: "New Title",
      chapters: undefined as never,
    });

    const { result } = renderHook(() => useProjectEditor("p1"));
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

    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.activeChapter).toBeTruthy());

    await act(async () => {
      const chapterId = result.current.activeChapter?.id ?? "";
      await result.current.handleRenameChapter(chapterId, "Renamed");
    });

    expect(result.current.activeChapter?.title).toBe("Renamed");
    expect(result.current.project?.chapters[0].title).toBe("Renamed");
  });

  it("renames a chapter via handleRenameChapter", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({
      ...mockChapter2,
      title: "Better Name",
    });

    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    await act(async () => {
      await result.current.handleRenameChapter("ch2", "Better Name");
    });

    expect(result.current.project?.chapters[1].title).toBe("Better Name");
  });

  it("renames the active chapter and updates activeChapter state", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({
      ...mockChapter1,
      title: "Active Renamed",
    });

    const { result } = renderHook(() => useProjectEditor("p1"));
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
      expect(result.current.error).toBe("Project not found.");
    });

    expect(result.current.project).toBeNull();
  });

  it("updates word count on content change", async () => {
    const { result } = renderHook(() => useProjectEditor("p1"));
    await waitFor(() => expect(result.current.project).toBeTruthy());

    act(() => {
      result.current.handleContentChange({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello world" }] }],
      });
    });

    expect(result.current.chapterWordCount).toBe(2);
  });
});
