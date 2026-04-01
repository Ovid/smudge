import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { UNTITLED_CHAPTER } from "@smudge/shared";
import { EditorPage } from "../pages/EditorPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api/client";

vi.mock("../hooks/useContentCache", () => ({
  getCachedContent: vi.fn().mockReturnValue(null),
  setCachedContent: vi.fn().mockReturnValue(true),
  clearCachedContent: vi.fn(),
}));

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
      update: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      restore: vi.fn(),
    },
    chapterStatuses: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}));

const mockProject = {
  id: "proj-1",
  slug: "test-project",
  title: "Test Project",
  mode: "fiction" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  chapters: [
    {
      id: "ch-1",
      project_id: "proj-1",
      title: "Chapter One",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 0,
      word_count: 0,
      status: "outline",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
  ],
};

const mockMultiChapterProject = {
  ...mockProject,
  chapters: [
    {
      id: "ch-1",
      project_id: "proj-1",
      title: "Chapter One",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 0,
      word_count: 0,
      status: "outline",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
    {
      id: "ch-2",
      project_id: "proj-1",
      title: "Chapter Two",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 1,
      word_count: 0,
      status: "outline",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
    {
      id: "ch-3",
      project_id: "proj-1",
      title: "Chapter Three",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 2,
      word_count: 0,
      status: "outline",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
  ],
};

const mockChapter = mockProject.chapters[0]!;

function renderEditorPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/test-project"]}>
      <Routes>
        <Route path="/projects/:slug" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

// jsdom doesn't implement HTMLDialogElement.showModal/close
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

describe("Keyboard shortcut help dialog", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("opens help dialog on Ctrl+/", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "/", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });
  });

  it("closes help dialog on Escape", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "/", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /keyboard shortcuts/i })).toBeNull();
    });
  });

  it("lists all Smudge-specific shortcuts", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "/", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText(/toggle preview/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/new chapter/i)).toBeInTheDocument();
    expect(screen.getByText(/toggle sidebar/i)).toBeInTheDocument();
    // "Keyboard shortcuts" appears as both dialog title and shortcut label — at least 2
    expect(screen.getAllByText(/keyboard shortcuts/i).length).toBeGreaterThanOrEqual(2);
  });

  it("closes help dialog when clicking the backdrop", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "/", ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /keyboard shortcuts/i })).toBeInTheDocument();
    });

    // Click the dialog backdrop (the dialog element itself, not its inner content)
    const dialog = screen.getByRole("dialog", { name: /keyboard shortcuts/i });
    fireEvent.click(dialog);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /keyboard shortcuts/i })).toBeNull();
    });
  });
});

describe("Ctrl+Shift+N creates a new chapter", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    vi.mocked(api.chapters.create).mockResolvedValue({
      id: "ch-2",
      project_id: "proj-1",
      title: UNTITLED_CHAPTER,
      content: null,
      sort_order: 1,
      word_count: 0,
      status: "outline",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    });
  });

  it("calls api.chapters.create on Ctrl+Shift+N", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "N", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(api.chapters.create).toHaveBeenCalledWith("test-project");
    });
  });
});

describe("Ctrl+Shift+Arrow chapter navigation", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockMultiChapterProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockMultiChapterProject.chapters[0]!);
    vi.mocked(api.chapters.update).mockResolvedValue(mockMultiChapterProject.chapters[0]!);
  });

  it("Ctrl+Shift+ArrowDown navigates to next chapter", async () => {
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockMultiChapterProject.chapters[0]!)
      .mockResolvedValueOnce(mockMultiChapterProject.chapters[1]!);

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "ArrowDown", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(api.chapters.get).toHaveBeenCalledWith("ch-2");
    });
  });

  it("Ctrl+Shift+ArrowUp navigates to previous chapter", async () => {
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockMultiChapterProject.chapters[0]!) // initial load
      .mockResolvedValueOnce(mockMultiChapterProject.chapters[1]!) // navigate down
      .mockResolvedValueOnce(mockMultiChapterProject.chapters[0]!); // navigate back up

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    // First navigate down to Chapter Two
    fireEvent.keyDown(document, { key: "ArrowDown", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter Two" })).toBeInTheDocument();
    });

    // Then navigate back up to Chapter One
    fireEvent.keyDown(document, { key: "ArrowUp", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });
  });

  it("Ctrl+Shift+ArrowDown does nothing on last chapter", async () => {
    // Start on last chapter
    vi.mocked(api.chapters.get).mockResolvedValue(mockMultiChapterProject.chapters[2]!);

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter Three" })).toBeInTheDocument();
    });

    const getCallCount = vi.mocked(api.chapters.get).mock.calls.length;

    fireEvent.keyDown(document, { key: "ArrowDown", ctrlKey: true, shiftKey: true });

    // Should not have made any additional chapter.get calls
    expect(vi.mocked(api.chapters.get).mock.calls.length).toBe(getCallCount);
  });

  it("Ctrl+Shift+ArrowUp does nothing on first chapter", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    const getCallCount = vi.mocked(api.chapters.get).mock.calls.length;

    fireEvent.keyDown(document, { key: "ArrowUp", ctrlKey: true, shiftKey: true });

    // Should not have made any additional chapter.get calls
    expect(vi.mocked(api.chapters.get).mock.calls.length).toBe(getCallCount);
  });
});
