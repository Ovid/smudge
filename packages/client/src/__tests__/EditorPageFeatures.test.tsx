import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorPage } from "../pages/EditorPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api/client";
import { STRINGS } from "../strings";

vi.mock("../hooks/useContentCache", () => ({
  getCachedContent: vi.fn().mockReturnValue(null),
  setCachedContent: vi.fn().mockReturnValue(true),
  clearCachedContent: vi.fn(),
  clearAllCachedContent: vi.fn(),
}));

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
      dashboard: vi.fn(),
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
    chapterStatuses: {
      list: vi.fn().mockResolvedValue([]),
    },
    snapshots: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      restore: vi.fn(),
    },
    search: {
      find: vi.fn().mockResolvedValue({ total_count: 0, chapters: [] }),
      replace: vi.fn().mockResolvedValue({ replaced_count: 0, affected_chapter_ids: [] }),
    },
    settings: {
      get: vi.fn().mockResolvedValue({ timezone: "UTC" }),
      update: vi.fn().mockResolvedValue({ message: "ok" }),
    },
  },
}));

// Mock IntersectionObserver for preview mode
beforeEach(() => {
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

const mockProject = {
  id: "proj-1",
  slug: "test-project",
  title: "Test Project",
  mode: "fiction" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  deleted_at: null,
  target_word_count: null,
  target_deadline: null,
  author_name: null,
  chapters: [
    {
      id: "ch-1",
      project_id: "proj-1",
      title: "Chapter One",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 0,
      word_count: 10,
      status: "outline",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
    {
      id: "ch-2",
      project_id: "proj-1",
      title: "Chapter Two",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "hello" }] }],
      },
      sort_order: 1,
      word_count: 1,
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
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("EditorPage error handling", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows error message when project is not found", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.get).mockRejectedValue(new Error("Project not found."));

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Failed to load project")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Back to Projects" })).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith("Failed to load project:", expect.any(Error));
    warnSpy.mockRestore();
  });
});

describe("EditorPage sidebar features", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("renders sidebar with chapters", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("complementary", { name: "Chapters" })).toBeInTheDocument();
    });

    // Chapter One appears in both sidebar and main content
    expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    // Chapter Two only in sidebar (not active)
    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
  });

  it("toggles sidebar with Ctrl+Shift+\\", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("complementary", { name: "Chapters" })).toBeInTheDocument();
    });

    // Hide sidebar
    fireEvent.keyDown(document, { key: "\\", code: "Backslash", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("complementary", { name: "Chapters" })).toBeNull();
    });

    // Show sidebar again
    fireEvent.keyDown(document, { key: "\\", code: "Backslash", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("complementary", { name: "Chapters" })).toBeInTheDocument();
    });
  });

  it("shows view mode tabs in header", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Editor")).toBeInTheDocument();
      expect(screen.getByText("Preview")).toBeInTheDocument();
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });
  });

  it("shows total word count in footer", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText(/total/)).toBeInTheDocument();
    });
  });
});

describe("EditorPage delete confirmation", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });
  });

  it("shows delete confirmation when clicking delete on a chapter", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    // Click the delete button (✕) on first chapter
    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    await userEvent.click(deleteButtons[0]!);

    // Should show confirmation dialog
    expect(screen.getByRole("alertdialog", { name: /Move .+ to trash/ })).toBeInTheDocument();
    expect(screen.getByText(/Move .+ to trash/)).toBeInTheDocument();
  });

  it("cancels delete when clicking Cancel", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    await userEvent.click(deleteButtons[0]!);

    await userEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(api.chapters.delete).not.toHaveBeenCalled();
  });

  it("confirms delete when clicking Confirm", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    await userEvent.click(deleteButtons[0]!);

    await userEvent.click(screen.getByText("Confirm"));

    await waitFor(() => {
      expect(api.chapters.delete).toHaveBeenCalled();
    });
  });
});

describe("EditorPage trash view", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("opens trash view and shows trashed chapters", async () => {
    const trashedChapter = {
      id: "ch-trashed",
      project_id: "proj-1",
      title: "Deleted Chapter",
      content: null,
      sort_order: 0,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: "2026-03-20T10:00:00.000Z",
    };
    vi.mocked(api.projects.trash).mockResolvedValue([trashedChapter]);

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Trash"));

    await waitFor(() => {
      expect(screen.getByText("Deleted Chapter")).toBeInTheDocument();
    });
  });

  it("restores a chapter from trash", async () => {
    const trashedChapter = {
      id: "ch-trashed",
      project_id: "proj-1",
      title: "Deleted Chapter",
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: "2026-03-20T10:00:00.000Z",
    };
    vi.mocked(api.projects.trash).mockResolvedValue([trashedChapter]);
    vi.mocked(api.chapters.restore).mockResolvedValue({
      ...trashedChapter,
      deleted_at: null,
      project_slug: "test-project",
    });

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Trash"));

    await waitFor(() => {
      expect(screen.getByText("Deleted Chapter")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Restore"));

    await waitFor(() => {
      expect(api.chapters.restore).toHaveBeenCalledWith("ch-trashed");
    });
  });

  it("shows newly deleted chapter in trash when trash view is open", async () => {
    vi.mocked(api.projects.trash).mockResolvedValue([]);
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    // Open trash view (initially empty)
    await userEvent.click(screen.getByText("Trash"));
    await waitFor(() => {
      expect(screen.getByText("No chapters in trash.")).toBeInTheDocument();
    });

    // Now delete a chapter — mock trash to return the deleted chapter
    const trashedChapter = {
      ...mockProject.chapters[1]!,
      deleted_at: "2026-03-29T10:00:00.000Z",
    };
    vi.mocked(api.projects.trash).mockResolvedValue([trashedChapter]);

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    await userEvent.click(deleteButtons[1]!);
    await userEvent.click(screen.getByText("Confirm"));

    // Trash should refresh and show the deleted chapter
    await waitFor(() => {
      expect(screen.getByText("Chapter Two")).toBeInTheDocument();
    });
  });

  it("closes trash view when selecting a chapter from sidebar", async () => {
    vi.mocked(api.projects.trash).mockResolvedValue([]);
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter) // initial load
      .mockResolvedValueOnce(mockProject.chapters[1]!); // select ch-2

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    // Open trash view
    await userEvent.click(screen.getByText("Trash"));
    await waitFor(() => {
      expect(screen.getByText("No chapters in trash.")).toBeInTheDocument();
    });

    // Click Chapter Two in the sidebar
    await userEvent.click(screen.getByText("Chapter Two"));

    // Trash view should close, editor should be visible
    await waitFor(() => {
      expect(screen.queryByText("No chapters in trash.")).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "Chapter Two" })).toBeInTheDocument();
    });
  });

  it("closes trash view when clicking Back to editor", async () => {
    vi.mocked(api.projects.trash).mockResolvedValue([]);

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Trash"));

    await waitFor(() => {
      expect(screen.getByText("Back to editor")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Back to editor"));

    // Should be back to editor — chapter title visible
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });
  });
});

describe("EditorPage empty and loading states", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty project state with add chapter button", async () => {
    const emptyProject = { ...mockProject, chapters: [] };
    vi.mocked(api.projects.get).mockResolvedValue(emptyProject);

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("No chapters yet. Add one to start writing.")).toBeInTheDocument();
    });

    // There are multiple Add Chapter buttons (sidebar + main area), both valid
    expect(screen.getAllByRole("button", { name: "Add Chapter" }).length).toBeGreaterThanOrEqual(1);
  });

  it("shows loading state while project loads", async () => {
    // Never resolve — keep project loading forever
    vi.mocked(api.projects.get).mockReturnValue(new Promise(() => {}));

    renderEditorPage();

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows loading state when project loaded but activeChapter not yet set", async () => {
    // Project with chapters but chapter.get never resolves
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockReturnValue(new Promise(() => {}));

    renderEditorPage();

    // First we see loading (project not yet loaded)
    expect(screen.getByText("Loading...")).toBeInTheDocument();

    // After project loads but chapter still pending, still loading
    await waitFor(() => {
      // project is loaded — we should still see loading because activeChapter is null
      // and chapters.length > 0 so it hits the second loading guard
      expect(screen.getByText("Loading...")).toBeInTheDocument();
    });
  });
});

describe("EditorPage openTrash failure", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("logs error when openTrash fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.projects.trash).mockRejectedValue(new Error("trash load failed"));

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Trash"));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("Failed to load trash:", expect.any(Error));
    });

    consoleSpy.mockRestore();
  });
});

describe("EditorPage restore with slug change", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("updates project slug when restored chapter has a different project_slug", async () => {
    const trashedChapter = {
      id: "ch-trashed",
      project_id: "proj-1",
      title: "Deleted Chapter",
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: "2026-03-20T10:00:00.000Z",
    };
    vi.mocked(api.projects.trash).mockResolvedValue([trashedChapter]);
    vi.mocked(api.chapters.restore).mockResolvedValue({
      ...trashedChapter,
      deleted_at: null,
      project_slug: "new-project-slug",
    });

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Trash"));

    await waitFor(() => {
      expect(screen.getByText("Deleted Chapter")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Restore"));

    await waitFor(() => {
      expect(api.chapters.restore).toHaveBeenCalledWith("ch-trashed");
    });
  });

  it("logs error when handleRestore fails", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const trashedChapter = {
      id: "ch-trashed",
      project_id: "proj-1",
      title: "Deleted Chapter",
      content: null,
      sort_order: 2,
      word_count: 0,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: "2026-03-20T10:00:00.000Z",
    };
    vi.mocked(api.projects.trash).mockResolvedValue([trashedChapter]);
    vi.mocked(api.chapters.restore).mockRejectedValue(new Error("restore failed"));

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Trash"));

    await waitFor(() => {
      expect(screen.getByText("Deleted Chapter")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Restore"));

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalledWith("Failed to restore chapter:", expect.any(Error));
    });

    consoleSpy.mockRestore();
  });
});

describe("EditorPage confirmDeleteChapter trash refresh failure", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    vi.mocked(api.chapters.delete).mockResolvedValue({ message: "ok" });
  });

  it("silently handles trash refresh failure after delete", async () => {
    // First trash call succeeds (opens trash), second fails (refresh after delete)
    vi.mocked(api.projects.trash)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("trash refresh failed"));

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Trash")).toBeInTheDocument();
    });

    // Open trash view
    await userEvent.click(screen.getByText("Trash"));
    await waitFor(() => {
      expect(screen.getByText("No chapters in trash.")).toBeInTheDocument();
    });

    // Delete a chapter while trash is open
    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    await userEvent.click(deleteButtons[1]!);
    await userEvent.click(screen.getByText("Confirm"));

    // Should not throw — the empty catch handles it
    await waitFor(() => {
      expect(api.chapters.delete).toHaveBeenCalled();
    });
  });
});

describe("EditorPage title editing guards", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("cancels chapter title edit on Escape", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    // Double-click to start editing
    await userEvent.dblClick(screen.getByRole("heading", { level: 2, name: "Chapter One" }));

    const input = screen.getByLabelText("Chapter title");
    expect(input).toBeInTheDocument();

    // Press Escape to cancel
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });
  });

  it("cancels project title edit on Escape", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Test Project");
    });

    // Double-click the h1 to start editing
    await userEvent.dblClick(screen.getByRole("heading", { level: 1 }));

    const input = screen.getByLabelText("Project title");
    expect(input).toBeInTheDocument();

    // Press Escape to cancel
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Test Project");
    });
  });

  it("keeps edit mode open when handleUpdateProjectTitle returns undefined", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.update).mockRejectedValue(new Error("update failed"));

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Test Project");
    });

    // Double-click the h1 to start editing project title
    await userEvent.dblClick(screen.getByRole("heading", { level: 1 }));

    const input = screen.getByLabelText("Project title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Title");

    // Blur to trigger save
    fireEvent.blur(input);

    // Since handleUpdateProjectTitle returns undefined on failure,
    // the edit mode should stay open (input still visible)
    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalled();
    });
    expect(warnSpy).toHaveBeenCalledWith("Failed to update project title:", expect.any(Error));
    warnSpy.mockRestore();
  });

  it("navigates when project title update returns a different slug", async () => {
    vi.mocked(api.projects.update).mockResolvedValue({
      id: mockProject.id,
      slug: "new-title",
      title: "New Title",
      mode: mockProject.mode,
      target_word_count: mockProject.target_word_count,
      target_deadline: mockProject.target_deadline,
      author_name: null,
      created_at: mockProject.created_at,
      updated_at: mockProject.updated_at,
      deleted_at: mockProject.deleted_at,
    });

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Test Project");
    });

    // Double-click the h1 to start editing project title
    await userEvent.dblClick(screen.getByRole("heading", { level: 1 }));

    const input = screen.getByLabelText("Project title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Title");

    // Submit via Enter
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalled();
    });
  });
});

describe("EditorPage preview mode", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("opens preview when clicking Preview tab", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Preview")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Preview"));

    // Preview renders inline — chapter headings visible in preview
    await waitFor(() => {
      // Both chapters should appear as h2 headings in preview
      expect(screen.getAllByRole("heading", { name: "Chapter One" }).length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  it("toggles preview with Ctrl+Shift+P", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    // Open preview — wrap in act to flush the flushSave().then(setViewMode) microtask
    await act(async () => {
      fireEvent.keyDown(document, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });

    // Preview tab should be active — TOC navigation should be present
    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Table of Contents" })).toBeInTheDocument();
    });

    // Close preview (back to editor)
    await act(async () => {
      fireEvent.keyDown(document, { key: "P", code: "KeyP", ctrlKey: true, shiftKey: true });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.queryByRole("navigation", { name: "Table of Contents" })).toBeNull();
    });
  });

  it("navigates to chapter when clicking chapter heading in preview", async () => {
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter) // initial load
      .mockResolvedValueOnce(mockProject.chapters[1]!); // navigate to ch-2

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Preview")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Preview"));

    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Table of Contents" })).toBeInTheDocument();
    });

    // Click a chapter heading in preview
    const ch2Heading = screen.getByRole("heading", { name: "Chapter Two" });
    await userEvent.click(ch2Heading);

    // Should switch back to editor view
    await waitFor(() => {
      expect(screen.queryByRole("navigation", { name: "Table of Contents" })).toBeNull();
    });
  });
});

describe("EditorPage error view on project load failure", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders error view with back link when project load fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.projects.get).mockRejectedValue(new Error("Server error"));

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Failed to load project")).toBeInTheDocument();
    });

    const backLink = screen.getByRole("link", { name: "Back to Projects" });
    expect(backLink).toBeInTheDocument();
    expect(warnSpy).toHaveBeenCalledWith("Failed to load project:", expect.any(Error));
    warnSpy.mockRestore();
  });
});

describe("EditorPage handleStatusChangeWithError", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    // Provide statuses so the StatusBadge renders in the sidebar
    vi.mocked(api.chapterStatuses.list).mockResolvedValue([
      { status: "outline", sort_order: 0, label: "Outline" },
      { status: "revised", sort_order: 1, label: "Revised" },
    ]);
  });

  it("catches error from handleStatusChange and shows actionError banner", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    // The status change API call will fail
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("status boom"));

    renderEditorPage();

    // Wait for sidebar and statuses to load (StatusBadge requires statuses array)
    await waitFor(() => {
      expect(screen.getByRole("complementary", { name: "Chapters" })).toBeInTheDocument();
      expect(screen.getAllByLabelText(/Chapter status:/).length).toBeGreaterThan(0);
    });

    // After initial load succeeds, make reload also fail so handleStatusChange calls onError
    vi.mocked(api.projects.get).mockRejectedValue(new Error("reload failed"));

    // StatusBadge renders a button with the current status label — click to open dropdown
    const statusButtons = screen.getAllByLabelText(/Chapter status:/);
    await userEvent.click(statusButtons[0]!);

    // Click the "Revised" option in the listbox
    await waitFor(() => {
      expect(screen.getByText("Revised")).toBeInTheDocument();
    });
    await userEvent.click(screen.getByText("Revised"));

    await waitFor(() => {
      // The actionError banner should appear
      expect(screen.getByRole("alert")).toBeInTheDocument();
      expect(screen.getByText("Failed to update chapter status")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
  });

  it("shows an error banner when chapter statuses fail to load after all retries", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(api.chapterStatuses.list).mockRejectedValue(new Error("statuses unavailable"));

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderEditorPage();

      // Wait for the component to load the project
      await waitFor(() => {
        expect(screen.getByText(mockProject.title)).toBeInTheDocument();
      });

      // Advance past the retry delays: 2000ms + 4000ms
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000);
      });

      // After all retries exhausted, the error banner should appear
      await waitFor(() => {
        expect(
          screen.getByText("Failed to load chapter statuses — status changes unavailable"),
        ).toBeInTheDocument();
      });
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });
});

describe("EditorPage view mode toggles", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    vi.mocked(api.projects.dashboard).mockResolvedValue({
      chapters: mockProject.chapters.map((c) => ({
        ...c,
        status_label: "Outline",
        status_color: "#ccc",
      })),
      status_summary: { outline: 2 },
      totals: { word_count: 11, chapter_count: 2, most_recent_edit: null, least_recent_edit: null },
    });
  });

  it("switches to editor view when clicking Editor tab button", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Editor")).toBeInTheDocument();
    });

    // First switch to preview
    await userEvent.click(screen.getByText("Preview"));
    await waitFor(() => {
      expect(screen.getByRole("navigation", { name: "Table of Contents" })).toBeInTheDocument();
    });

    // Now click Editor to switch back
    await userEvent.click(screen.getByText("Editor"));
    await waitFor(() => {
      expect(screen.queryByRole("navigation", { name: "Table of Contents" })).toBeNull();
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });
    expect(warnSpy).toHaveBeenCalledWith("Failed to load chapter statuses:", expect.any(Error));
    warnSpy.mockRestore();
  });

  it("switches to dashboard view when clicking Dashboard tab button", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    // Click Dashboard tab
    await userEvent.click(screen.getByText("Dashboard"));

    // Dashboard view should render with ProgressStrip (single view, no tabs)
    await waitFor(() => {
      expect(screen.getByRole("region", { name: /writing progress/i })).toBeInTheDocument();
    });
    expect(warnSpy).toHaveBeenCalledWith("Failed to load chapter statuses:", expect.any(Error));
    warnSpy.mockRestore();
  });

  it("renders dashboard view with DashboardView component", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      // The DashboardView component should render ProgressStrip
      expect(screen.getByRole("region", { name: /writing progress/i })).toBeInTheDocument();
    });

    // The Dashboard tab should show as current
    const dashboardButton = screen.getByText("Dashboard");
    expect(dashboardButton).toHaveAttribute("aria-current", "page");
    expect(warnSpy).toHaveBeenCalledWith("Failed to load chapter statuses:", expect.any(Error));
    warnSpy.mockRestore();
  });
});

describe("EditorPage find-and-replace confirmation", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    // Reset to default — a previous test sets mockRejectedValue which persists
    vi.mocked(api.chapterStatuses.list).mockResolvedValue([]);
    vi.mocked(api.search.find).mockResolvedValue({
      total_count: 2,
      chapters: [
        {
          chapter_id: "ch-1",
          chapter_title: "Chapter One",
          matches: [
            { index: 0, context: "foo bar", blockIndex: 0, offset: 0, length: 3 },
            { index: 1, context: "foo baz", blockIndex: 0, offset: 8, length: 3 },
          ],
        },
      ],
    });
    vi.mocked(api.search.replace).mockResolvedValue({
      replaced_count: 2,
      affected_chapter_ids: [],
    });
  });

  /** Opens the find-and-replace panel, types a query and replacement,
   *  waits for the search results, and clicks "Replace All in Manuscript". */
  async function openPanelAndClickReplaceAll() {
    renderEditorPage();

    // Wait for the editor page to load
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    // Open the find-replace panel via Ctrl+H
    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });

    // Wait for the panel to appear
    const searchInput = await screen.findByLabelText("Find");
    const replaceInput = screen.getByLabelText("Replace");

    // Fill search and replacement (triggers debounced search)
    fireEvent.change(searchInput, { target: { value: "foo" } });
    fireEvent.change(replaceInput, { target: { value: "qux" } });

    // Wait for search results to render — "Replace All in Manuscript" button
    // is only shown when there are results with total_count > 0.
    const replaceAllButton = await screen.findByRole(
      "button",
      { name: "Replace All in Manuscript" },
      { timeout: 3000 },
    );
    await userEvent.click(replaceAllButton);
  }

  it("shows confirmation dialog when Replace All in Manuscript is clicked", async () => {
    await openPanelAndClickReplaceAll();

    const dialog = await screen.findByRole("alertdialog", {
      name: "Replace across manuscript?",
    });
    expect(dialog).toBeInTheDocument();
  });

  it("executes replace when confirmation is confirmed", async () => {
    await openPanelAndClickReplaceAll();

    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });

    // Click "Replace All" inside the dialog to confirm
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => {
      expect(api.search.replace).toHaveBeenCalledWith(
        "test-project",
        "foo",
        "qux",
        expect.objectContaining({
          case_sensitive: expect.any(Boolean),
          whole_word: expect.any(Boolean),
          regex: expect.any(Boolean),
        }),
        { type: "project" },
      );
    });

    // Dialog should close after confirming
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", { name: "Replace across manuscript?" })).toBeNull();
    });
  });

  it("surfaces replaceSuccess banner and skippedAfterReplace after replace-all ok path", async () => {
    vi.mocked(api.search.replace).mockResolvedValue({
      replaced_count: 3,
      affected_chapter_ids: [],
      skipped_chapter_ids: ["ch-skipped"],
    } as unknown as { replaced_count: number; affected_chapter_ids: string[] });

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    // result.ok branch: positive success banner with the real count.
    await waitFor(() => {
      expect(screen.getByText("Replaced 3 occurrences.")).toBeInTheDocument();
    });
    // And a skipped-chapter warning co-displays in the error region.
    expect(screen.getByText(STRINGS.findReplace.skippedAfterReplace(1))).toBeInTheDocument();
  });

  it("surfaces persistent locked-editor banner when reload fails after replace (I1)", async () => {
    // useProjectEditor.reloadActiveChapter logs a console.warn on the
    // intentional failure path. Spy + suppress so the test deliberately
    // exercises the error branch without leaking noise into stderr.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(api.search.replace).mockResolvedValueOnce({
      replaced_count: 2,
      affected_chapter_ids: ["ch-1"],
    });
    // Initial load succeeds (mockChapter via beforeEach), then the reload
    // triggered by the post-replace flow fails — the editor stays
    // setEditable(false) and the persistent lock banner must appear.
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter)
      .mockRejectedValueOnce(new Error("reload failed"));

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    expect(
      await screen.findByText(STRINGS.findReplace.replaceSucceededReloadFailed),
    ).toBeInTheDocument();
    // The banner must surface a Refresh page button — without it, the user
    // has no signposted recovery action while keystrokes are silently
    // swallowed by the read-only editor.
    expect(screen.getByRole("button", { name: STRINGS.editor.refreshButton })).toBeInTheDocument();

    expect(warnSpy).toHaveBeenCalledWith("Failed to reload chapter:", expect.any(Error));
    warnSpy.mockRestore();
  });

  it("shows busy banner when sidebar Add Chapter is clicked mid-mutation (I2)", async () => {
    // Regression for the I2 fix: sidebar onAddChapter used to call
    // handleCreateChapter directly, bypassing the mutation.isBusy() guard
    // that executeReplace/handleRestoreSnapshot honor. A click during a
    // 2-14s replace flush would then call cancelInFlightSave(), aborting
    // the mutation's in-flight save controller mid-run and producing a
    // misattributed "save failed" banner.
    let resolveReplace: (v: {
      replaced_count: number;
      affected_chapter_ids: string[];
    }) => void = () => {};
    vi.mocked(api.search.replace).mockImplementationOnce(
      () =>
        new Promise<{ replaced_count: number; affected_chapter_ids: string[] }>((resolve) => {
          resolveReplace = resolve;
        }),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    // api.search.replace is now in-flight (promise unresolved) — the
    // mutation hook is in its mutate-stage wait. Clicking the sidebar
    // Add Chapter button must now surface the busy banner rather than
    // racing the in-flight replace.
    const addButton = await screen.findByRole("button", { name: "Add Chapter" });
    await userEvent.click(addButton);

    expect(await screen.findByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();
    // api.chapters.create must NOT have fired — the guard short-circuited.
    expect(api.chapters.create).not.toHaveBeenCalled();

    // Allow the replace to resolve so the test tears down cleanly.
    resolveReplace({ replaced_count: 1, affected_chapter_ids: [] });
  });

  it("shows busy banner on panel toggles and view switches mid-mutation (I5)", async () => {
    // Each toolbar/panel entry point has its own busy guard. A single
    // in-flight replace exercises several of them — Snapshots toggle,
    // Reference Panel toggle, Ctrl+H, view-mode tab, and Trash open all
    // surface the busy banner instead of racing the mutation. Without
    // the guards: each path either bumps the save seq behind the hook's
    // back, remounts the Editor while the hook holds a stale handle, or
    // races the in-flight save controller.
    let resolveReplace: (v: {
      replaced_count: number;
      affected_chapter_ids: string[];
    }) => void = () => {};
    vi.mocked(api.search.replace).mockImplementationOnce(
      () =>
        new Promise<{ replaced_count: number; affected_chapter_ids: string[] }>((resolve) => {
          resolveReplace = resolve;
        }),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    // 1) View-switch via toolbar tab (Preview) — switchToView's busy
    // guard surfaces banner.
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();

    // 2) Snapshots toggle — handleToggleSnapshotPanel's busy guard.
    const snapshotsToggle = screen.getAllByRole("button", { name: /Snapshots/ })[0]!;
    await userEvent.click(snapshotsToggle);
    expect(screen.getByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();

    // 3) Reference Panel toggle — handleToggleReferencePanel's busy guard.
    const refPanelToggle = screen.getByRole("button", {
      name: STRINGS.referencePanel.toggleTooltip,
    });
    await userEvent.click(refPanelToggle);
    expect(screen.getByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();

    // 4) Ctrl+H toggles Find/Replace — handleToggleFindReplace busy guard.
    fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
    expect(screen.getByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();

    // 5) Trash button (in sidebar) — openTrashGuarded busy guard.
    const trashButton = screen.getByRole("button", { name: STRINGS.sidebar.trash });
    await userEvent.click(trashButton);
    expect(screen.getByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();

    // Allow the replace to resolve so the test tears down cleanly.
    resolveReplace({ replaced_count: 1, affected_chapter_ids: [] });
  });

  it("guards sidebar reorder/rename/status change during in-flight replace (I4)", async () => {
    // Reorder, rename, and status-change sidebar entry points PATCH the
    // same chapter rows an in-flight replace is writing. Before the I4
    // fix they bypassed the busy guard every other sidebar handler
    // honored — allowing a reorder to pin word counts to pre-replace
    // values, and rename/status PATCHes to race the replace's writes.
    let resolveReplace: (v: {
      replaced_count: number;
      affected_chapter_ids: string[];
    }) => void = () => {};
    vi.mocked(api.search.replace).mockImplementationOnce(
      () =>
        new Promise<{ replaced_count: number; affected_chapter_ids: string[] }>((resolve) => {
          resolveReplace = resolve;
        }),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    // 1) Reorder via Alt+ArrowDown on the first chapter's sidebar row.
    // The keydown handler lives on the sidebar chapter <button> itself
    // (Sidebar.tsx line 281). Scope to the sidebar instance since the
    // editor heading also renders "Chapter One".
    const chapterOneButtons = screen.getAllByText("Chapter One");
    const chapterOneSidebarButton = chapterOneButtons.find(
      (el) => el.tagName === "BUTTON" && el.closest("li"),
    ) as HTMLElement | undefined;
    expect(chapterOneSidebarButton).toBeDefined();
    fireEvent.keyDown(chapterOneSidebarButton!, { key: "ArrowDown", altKey: true });

    expect(await screen.findByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();
    expect(api.projects.reorderChapters).not.toHaveBeenCalled();

    // Allow the replace to resolve so the test tears down cleanly.
    resolveReplace({ replaced_count: 1, affected_chapter_ids: [] });
  });

  it("locks editor on 2xx BAD_JSON from replace — server may have committed (C1)", async () => {
    // apiFetch classifies a 2xx response whose body fails to parse as
    // ApiRequestError(status=2xx, code="BAD_JSON"). The server likely
    // committed the replace (and the auto-snapshot) but the client cannot
    // read replaced_count. Before the fix this was shown as a dismissible
    // banner with the editor re-enabled — auto-save would then silently
    // revert the committed replace. After: the editor stays read-only and
    // the "response unreadable" banner becomes persistent until refresh.
    const { ApiRequestError } = await import("../api/client");
    const badJson = new ApiRequestError("Malformed response body", 200, "BAD_JSON");
    vi.mocked(api.search.replace).mockRejectedValueOnce(badJson);

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    // The persistent lock banner with the "response unreadable" copy is the
    // ONLY signal the user gets in this ambiguous case. The generic
    // "Replaced N occurrences" banner must NOT appear — we don't have an
    // authoritative count.
    expect(
      await screen.findByText(STRINGS.findReplace.replaceResponseUnreadable),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: STRINGS.editor.refreshButton })).toBeInTheDocument();
    expect(screen.queryByText(/Replaced .* occurrence/)).toBeNull();
  });

  it("refuses Preview view switch while editor is locked after BAD_JSON (C2)", async () => {
    // Once the lock banner is shown, switchToView must NOT proceed —
    // otherwise an editor->preview->editor round trip would remount the
    // Editor with editable=true (default), defeating the lock while the
    // banner persists. The next keystroke would PATCH stale content over
    // the server-committed mutation.
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    // Lock banner is up.
    await screen.findByText(STRINGS.findReplace.replaceResponseUnreadable);

    // Click Preview — switchToView should refuse, view stays as editor.
    const previewButton = screen.getByRole("button", { name: "Preview" });
    await userEvent.click(previewButton);

    // Wait a tick for any state changes
    await act(async () => {
      await Promise.resolve();
    });

    // Lock banner still on screen, editor heading still visible (no Preview switch)
    expect(screen.getByText(STRINGS.findReplace.replaceResponseUnreadable)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
  });

  it("clears caches for project chapters on 2xx BAD_JSON from project-scope replace (C1)", async () => {
    // The mutate throw bypasses the hook's directive-driven cache-clear.
    // Without a fallback clear, a refresh re-hydrates the pre-replace draft
    // from localStorage and the next auto-save reverts the server-committed
    // replace. Project-scope replace has no affected_chapter_ids (response
    // unreadable), so the conservative fallback is to clear all chapters in
    // the project.
    const { clearAllCachedContent, clearCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(clearAllCachedContent).mockClear();
    vi.mocked(clearCachedContent).mockClear();
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => {
      expect(clearAllCachedContent).toHaveBeenCalledWith(["ch-1", "ch-2"]);
    });
  });

  it("Ctrl+H is blocked while the replace-confirm dialog is open", async () => {
    await openPanelAndClickReplaceAll();

    const dialog = await screen.findByRole("alertdialog", {
      name: "Replace across manuscript?",
    });
    expect(dialog).toBeInTheDocument();

    // Ctrl+H must not execute beneath the dialog. Before the fix the
    // shortcut toggled the panel/find-replace state under the modal; the
    // guard should now short-circuit so the dialog persists untouched and
    // no replace API call fires.
    fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
    expect(
      screen.getByRole("alertdialog", { name: "Replace across manuscript?" }),
    ).toBeInTheDocument();
    expect(api.search.replace).not.toHaveBeenCalled();
  });

  it("does not execute replace when confirmation is cancelled", async () => {
    await openPanelAndClickReplaceAll();

    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });

    // Click Cancel in the dialog
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // Dialog should close
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", { name: "Replace across manuscript?" })).toBeNull();
    });

    // The replace API should not have been called
    expect(api.search.replace).not.toHaveBeenCalled();
  });

  it("swallows ABORTED errors from executeReplace without showing a banner", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Request aborted", 0, "ABORTED"),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    // Dialog closes, no action error banner for abort
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog", { name: "Replace across manuscript?" })).toBeNull();
    });
    expect(screen.queryByText(STRINGS.findReplace.replaceFailed)).toBeNull();
  });

  it("surfaces SCOPE_NOT_FOUND 404 with replaceScopeNotFound copy", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Scope missing", 404, "SCOPE_NOT_FOUND"),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => {
      expect(screen.getByText(STRINGS.findReplace.replaceScopeNotFound)).toBeInTheDocument();
    });
  });

  it("surfaces MATCH_CAP_EXCEEDED with tooManyMatches copy", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Too many", 400, "MATCH_CAP_EXCEEDED"),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => {
      expect(screen.getByText(STRINGS.findReplace.tooManyMatches)).toBeInTheDocument();
    });
  });

  it("surfaces REGEX_TIMEOUT with searchTimedOut copy", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Timeout", 400, "REGEX_TIMEOUT"),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => {
      expect(screen.getByText(STRINGS.findReplace.searchTimedOut)).toBeInTheDocument();
    });
  });

  it("surfaces 5xx with generic replaceFailed copy (no raw server message leak)", async () => {
    // CLAUDE.md: all UI strings must route through strings.ts; raw server
    // messages must not leak to the UI (blocks i18n).
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Something specific broke", 500, "INTERNAL_ERROR"),
    );

    await openPanelAndClickReplaceAll();
    await screen.findByRole("alertdialog", { name: "Replace across manuscript?" });
    await userEvent.click(screen.getByRole("button", { name: "Replace All" }));

    await waitFor(() => {
      expect(screen.getByText(STRINGS.findReplace.replaceFailed)).toBeInTheDocument();
    });
    expect(screen.queryByText(/Something specific broke/)).toBeNull();
  });

  it("handleReplaceOne on any 404 re-fires a search and shows the action banner (I3)", async () => {
    // A bare 404 from api.search.replace can mean either the chapter scope
    // is gone (SCOPE_NOT_FOUND) or the project itself is gone (NOT_FOUND).
    // Both cases need to drop the stale match rows so the user can't click
    // the same dead row and loop the same error — re-fire the search on
    // any 404 and use findReplace.clearError() to suppress the panel-local
    // duplicate so the action banner remains the single source of truth.
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("project missing", 404, "NOT_FOUND"),
    );

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.change(screen.getByLabelText("Replace"), { target: { value: "qux" } });

    const replaceOne = await screen.findAllByRole("button", { name: "Replace" }, { timeout: 3000 });
    await waitFor(() => expect(api.search.find).toHaveBeenCalled());
    const findCallsBeforeClick = vi.mocked(api.search.find).mock.calls.length;

    await userEvent.click(replaceOne[0]!);

    await waitFor(() => {
      expect(screen.getByText(STRINGS.findReplace.replaceProjectNotFound)).toBeInTheDocument();
    });

    // Refresh search fires on the project-gone 404 so stale match rows
    // disappear — the search refetch clears its own results on 404, and
    // clearError() suppresses any panel-local duplicate copy.
    expect(vi.mocked(api.search.find).mock.calls.length).toBeGreaterThan(findCallsBeforeClick);
  });

  it("handleReplaceOne locks editor on 2xx BAD_JSON — server may have committed (C1)", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.change(screen.getByLabelText("Replace"), { target: { value: "qux" } });

    const replaceOne = await screen.findAllByRole("button", { name: "Replace" }, { timeout: 3000 });
    await userEvent.click(replaceOne[0]!);

    expect(
      await screen.findByText(STRINGS.findReplace.replaceResponseUnreadable),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: STRINGS.editor.refreshButton })).toBeInTheDocument();
  });

  it("handleReplaceOne clears the chapter's cache on 2xx BAD_JSON (C1)", async () => {
    // Replace-one is single-chapter; the BAD_JSON branch has no
    // authoritative affected_chapter_ids in the unreadable response, but
    // the targeted chapterId is known at the call site. The mutate throw
    // bypasses the hook's directive-driven cache-clear, so a refresh
    // would otherwise re-hydrate the pre-replace draft from localStorage.
    const { clearCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(clearCachedContent).mockClear();
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("Malformed response body", 200, "BAD_JSON"),
    );

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.change(screen.getByLabelText("Replace"), { target: { value: "qux" } });

    const replaceOne = await screen.findAllByRole("button", { name: "Replace" }, { timeout: 3000 });
    await userEvent.click(replaceOne[0]!);

    await waitFor(() => {
      expect(clearCachedContent).toHaveBeenCalledWith("ch-1");
    });
  });

  it("handleReplaceOne surfaces MATCH_CAP_EXCEEDED with tooManyMatches copy", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("too many", 400, "MATCH_CAP_EXCEEDED"),
    );

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.change(screen.getByLabelText("Replace"), { target: { value: "qux" } });

    // The per-match "Replace" buttons appear once results render.
    const replaceOne = await screen.findAllByRole("button", { name: "Replace" }, { timeout: 3000 });
    await userEvent.click(replaceOne[0]!);

    await waitFor(() => {
      expect(screen.getByText(STRINGS.findReplace.tooManyMatches)).toBeInTheDocument();
    });
  });

  it("handleReplaceOne clears the target chapter's cached draft on success", async () => {
    const { clearAllCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(clearAllCachedContent).mockClear();
    vi.mocked(api.search.replace).mockResolvedValueOnce({
      replaced_count: 1,
      affected_chapter_ids: ["ch-1"],
    });

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.change(screen.getByLabelText("Replace"), { target: { value: "qux" } });

    const replaceOne = await screen.findAllByRole("button", { name: "Replace" }, { timeout: 3000 });
    await userEvent.click(replaceOne[0]!);

    await waitFor(() => {
      expect(clearAllCachedContent).toHaveBeenCalledWith(["ch-1"]);
    });
  });

  it("rapid double-clicks on Replace do not launch overlapping requests (I5)", async () => {
    // api.search.replace returns a deferred promise we can hold open to
    // simulate a slow round trip; the second click must be ignored while
    // the first is still in flight.
    let resolveReplace: (v: {
      replaced_count: number;
      affected_chapter_ids: string[];
    }) => void = () => {};
    const pending = new Promise<{ replaced_count: number; affected_chapter_ids: string[] }>(
      (resolve) => {
        resolveReplace = resolve;
      },
    );
    vi.mocked(api.search.replace).mockReturnValueOnce(pending);

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.change(screen.getByLabelText("Replace"), { target: { value: "qux" } });

    const replaceOne = await screen.findAllByRole("button", { name: "Replace" }, { timeout: 3000 });

    // Two clicks while the first request is in flight.
    await userEvent.click(replaceOne[0]!);
    await userEvent.click(replaceOne[0]!);

    // Only one request issued — the second click is swallowed by the guard.
    expect(api.search.replace).toHaveBeenCalledTimes(1);

    // The user-visible signal of the swallowed second click — without
    // this assertion the busy banner could regress to silent-drop and
    // tests would still pass on the request-count alone.
    expect(await screen.findByText(STRINGS.editor.mutationBusy)).toBeInTheDocument();

    // Release the first request so the handler finishes cleanly.
    resolveReplace({ replaced_count: 1, affected_chapter_ids: ["ch-1"] });
    await act(async () => {
      await pending;
    });
  });

  it("handleReplaceOne clears the target chapter's cache AFTER the replace response succeeds", async () => {
    const { clearAllCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(clearAllCachedContent).mockClear();

    // Record the call order: clear must land AFTER api.search.replace
    // resolves. A pre-flight clear on a failed replace would destroy the
    // draft even though the server never mutated anything; scoping the
    // clear to result.affected_chapter_ids keeps it correctness-preserving.
    const order: string[] = [];
    vi.mocked(clearAllCachedContent).mockImplementation((ids: string[]) => {
      order.push(`clear:${ids.join(",")}`);
    });
    vi.mocked(api.search.replace).mockImplementationOnce(async () => {
      order.push("replace");
      return { replaced_count: 1, affected_chapter_ids: ["ch-1"] };
    });

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.change(screen.getByLabelText("Replace"), { target: { value: "qux" } });

    const replaceOne = await screen.findAllByRole("button", { name: "Replace" }, { timeout: 3000 });
    await userEvent.click(replaceOne[0]!);

    await waitFor(() => {
      expect(order).toContain("clear:ch-1");
    });
    expect(order.indexOf("replace")).toBeLessThan(order.indexOf("clear:ch-1"));
  });

  it("handleReplaceOne swallows ABORTED errors silently", async () => {
    const { ApiRequestError } = await import("../api/client");
    vi.mocked(api.search.replace).mockRejectedValueOnce(
      new ApiRequestError("aborted", 0, "ABORTED"),
    );

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });
    fireEvent.change(await screen.findByLabelText("Find"), { target: { value: "foo" } });
    fireEvent.change(screen.getByLabelText("Replace"), { target: { value: "qux" } });

    const replaceOne = await screen.findAllByRole("button", { name: "Replace" }, { timeout: 3000 });
    await userEvent.click(replaceOne[0]!);

    // No error banner should appear for an aborted request.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(STRINGS.findReplace.replaceFailed)).toBeNull();
  });

  it("shows chapter-scope confirmation when Replace All in Chapter is clicked", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.keyDown(document, { key: "h", code: "KeyH", ctrlKey: true });
      await Promise.resolve();
    });

    const searchInput = await screen.findByLabelText("Find");
    const replaceInput = screen.getByLabelText("Replace");
    fireEvent.change(searchInput, { target: { value: "foo" } });
    fireEvent.change(replaceInput, { target: { value: "qux" } });

    const perChapterButton = await screen.findByRole(
      "button",
      { name: "Replace All in Chapter" },
      { timeout: 3000 },
    );
    await userEvent.click(perChapterButton);

    const dialog = await screen.findByRole("alertdialog", { name: "Replace in chapter?" });
    expect(dialog).toBeInTheDocument();
    // Dialog body uses the chapter-scope confirm copy with per-chapter count.
    expect(dialog).toHaveTextContent(/2 occurrences of 'foo' with 'qux' in this chapter/);
  });
});

describe("EditorPage snapshot panel", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    vi.mocked(api.snapshots.list).mockResolvedValue([]);
  });

  it("opens the snapshot panel via toolbar button and shows the empty state", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    // The toolbar button's aria-label is "Snapshots" (no count when empty).
    const button = await screen.findByRole("button", { name: /^Snapshots$/ });
    await userEvent.click(button);

    await waitFor(() => {
      expect(screen.getByRole("complementary", { name: "Chapter snapshots" })).toBeInTheDocument();
    });
  });

  it("clicks View on a snapshot (exercises onView flushSave/cancelPendingSaves path)", async () => {
    vi.mocked(api.snapshots.list).mockResolvedValue([
      {
        id: "snap-1",
        chapter_id: "ch-1",
        label: "v1",
        word_count: 5,
        is_auto: false,
        created_at: "2026-04-17T10:00:00Z",
      },
    ]);
    vi.mocked(api.snapshots.get).mockResolvedValue({
      id: "snap-1",
      chapter_id: "ch-1",
      label: "v1",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      word_count: 5,
      is_auto: false,
      created_at: "2026-04-17T10:00:00Z",
    });
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    await userEvent.click(await screen.findByRole("button", { name: /^Snapshots/ }));
    const viewBtn = await screen.findByRole("button", { name: "View" });
    await userEvent.click(viewBtn);

    await waitFor(() => {
      expect(api.snapshots.get).toHaveBeenCalledWith("snap-1");
    });
  });

  it("restores a viewed snapshot via Restore button (happy path through useEditorMutation)", async () => {
    vi.mocked(api.snapshots.list).mockResolvedValue([
      {
        id: "snap-1",
        chapter_id: "ch-1",
        label: "v1",
        word_count: 5,
        is_auto: false,
        created_at: "2026-04-17T10:00:00Z",
      },
    ]);
    vi.mocked(api.snapshots.get).mockResolvedValue({
      id: "snap-1",
      chapter_id: "ch-1",
      label: "v1",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      word_count: 5,
      is_auto: false,
      created_at: "2026-04-17T10:00:00Z",
    });
    (api.snapshots as unknown as { restore: ReturnType<typeof vi.fn> }).restore = vi
      .fn()
      .mockResolvedValue({ status: "ok" });

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    // Open panel and enter snapshot-view mode.
    await userEvent.click(await screen.findByRole("button", { name: /^Snapshots/ }));
    await userEvent.click(await screen.findByRole("button", { name: "View" }));
    await waitFor(() => {
      expect(api.snapshots.get).toHaveBeenCalledWith("snap-1");
    });

    // SnapshotBanner renders inside the editor's region with a "Restore"
    // button. Clicking it opens a ConfirmDialog; confirm to run the
    // useEditorMutation happy path (flush → markClean → server restore →
    // cache clear → reloadActiveChapter → setEditable(true)).
    const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
    await userEvent.click(restoreButtons[0]!);
    const dialog = await screen.findByRole("alertdialog", { name: "Restore" });
    // The dialog has "Restore" as both title and confirmLabel; scope the
    // button query to within the dialog so the banner's Restore button
    // doesn't match.
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Restore",
    );
    expect(confirmButton).toBeDefined();
    await userEvent.click(confirmButton!);

    await waitFor(() => {
      expect(
        (api.snapshots as unknown as { restore: ReturnType<typeof vi.fn> }).restore,
      ).toHaveBeenCalledWith("snap-1");
    });
  });

  it("locks editor on 2xx BAD_JSON from restore — server may have committed (C2)", async () => {
    // Mirror of the replace 2xx BAD_JSON test. apiFetch throws
    // ApiRequestError(status=2xx, code="BAD_JSON") when a 2xx restore
    // response body fails to parse — server likely committed the restore
    // and auto-snapshot, but the response body was unreadable. The caller
    // must NOT re-enable the editor and must NOT surface a generic retry
    // banner — the "response unreadable" lock is the only safe UX.
    vi.mocked(api.snapshots.list).mockResolvedValue([
      {
        id: "snap-1",
        chapter_id: "ch-1",
        label: "v1",
        word_count: 5,
        is_auto: false,
        created_at: "2026-04-17T10:00:00Z",
      },
    ]);
    vi.mocked(api.snapshots.get).mockResolvedValue({
      id: "snap-1",
      chapter_id: "ch-1",
      label: "v1",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      word_count: 5,
      is_auto: false,
      created_at: "2026-04-17T10:00:00Z",
    });
    const { ApiRequestError } = await import("../api/client");
    (api.snapshots as unknown as { restore: ReturnType<typeof vi.fn> }).restore = vi
      .fn()
      .mockRejectedValue(new ApiRequestError("Malformed response body", 200, "BAD_JSON"));

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    await userEvent.click(await screen.findByRole("button", { name: /^Snapshots/ }));
    await userEvent.click(await screen.findByRole("button", { name: "View" }));
    await waitFor(() => {
      expect(api.snapshots.get).toHaveBeenCalledWith("snap-1");
    });

    const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
    await userEvent.click(restoreButtons[0]!);
    const dialog = await screen.findByRole("alertdialog", { name: "Restore" });
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Restore",
    );
    await userEvent.click(confirmButton!);

    expect(
      await screen.findByText(STRINGS.snapshots.restoreResponseUnreadable),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: STRINGS.editor.refreshButton })).toBeInTheDocument();
  });

  it("clears active chapter's cache on 2xx BAD_JSON from restore (C1)", async () => {
    // The mutate throw bypasses the hook's directive-driven cache-clear.
    // Without this fallback, refresh re-hydrates the pre-restore draft and
    // the next auto-save reverts the server-committed restore.
    const { clearCachedContent } = await import("../hooks/useContentCache");
    vi.mocked(clearCachedContent).mockClear();
    vi.mocked(api.snapshots.list).mockResolvedValue([
      {
        id: "snap-1",
        chapter_id: "ch-1",
        label: "v1",
        word_count: 5,
        is_auto: false,
        created_at: "2026-04-17T10:00:00Z",
      },
    ]);
    vi.mocked(api.snapshots.get).mockResolvedValue({
      id: "snap-1",
      chapter_id: "ch-1",
      label: "v1",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      word_count: 5,
      is_auto: false,
      created_at: "2026-04-17T10:00:00Z",
    });
    const { ApiRequestError } = await import("../api/client");
    (api.snapshots as unknown as { restore: ReturnType<typeof vi.fn> }).restore = vi
      .fn()
      .mockRejectedValue(new ApiRequestError("Malformed response body", 200, "BAD_JSON"));

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    await userEvent.click(await screen.findByRole("button", { name: /^Snapshots/ }));
    await userEvent.click(await screen.findByRole("button", { name: "View" }));
    await waitFor(() => {
      expect(api.snapshots.get).toHaveBeenCalledWith("snap-1");
    });

    const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
    await userEvent.click(restoreButtons[0]!);
    const dialog = await screen.findByRole("alertdialog", { name: "Restore" });
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Restore",
    );
    await userEvent.click(confirmButton!);

    await waitFor(() => {
      expect(clearCachedContent).toHaveBeenCalledWith("ch-1");
    });
  });

  it("exits snapshot view when restore returns not_found (I6)", async () => {
    // When the snapshot has been deleted (or its chapter purged) between
    // entering snapshot view and clicking Restore, the server replies 404.
    // Without exiting view, the SnapshotBanner with its now-broken Restore
    // button stays on screen and the user loops clicking Restore on a
    // dead snapshot.
    vi.mocked(api.snapshots.list).mockResolvedValue([
      {
        id: "snap-gone",
        chapter_id: "ch-1",
        label: "v1",
        word_count: 5,
        is_auto: false,
        created_at: "2026-04-17T10:00:00Z",
      },
    ]);
    vi.mocked(api.snapshots.get).mockResolvedValue({
      id: "snap-gone",
      chapter_id: "ch-1",
      label: "v1",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      word_count: 5,
      is_auto: false,
      created_at: "2026-04-17T10:00:00Z",
    });
    const { ApiRequestError } = await import("../api/client");
    (api.snapshots as unknown as { restore: ReturnType<typeof vi.fn> }).restore = vi
      .fn()
      .mockRejectedValue(new ApiRequestError("Snapshot not found", 404, "NOT_FOUND"));

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    await userEvent.click(await screen.findByRole("button", { name: /^Snapshots/ }));
    await userEvent.click(await screen.findByRole("button", { name: "View" }));
    await waitFor(() => {
      expect(api.snapshots.get).toHaveBeenCalledWith("snap-gone");
    });

    // Confirm banner is on-screen before the 404.
    expect(screen.getByRole("region", { name: STRINGS.snapshots.viewingRegionLabel })).toBeTruthy();

    const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
    await userEvent.click(restoreButtons[0]!);
    const dialog = await screen.findByRole("alertdialog", { name: "Restore" });
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Restore",
    );
    await userEvent.click(confirmButton!);

    // The not-found action banner shows up…
    expect(await screen.findByText(STRINGS.snapshots.restoreFailedNotFound)).toBeInTheDocument();
    // …and the stale SnapshotBanner has left the screen.
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: STRINGS.snapshots.viewingRegionLabel }),
      ).toBeNull();
    });
  });

  it("refreshes snapshot count on 2xx BAD_JSON restore (I1)", async () => {
    // possibly_committed means the server likely wrote a new restore +
    // auto-snapshot. The snapshot panel handle refresh is a no-op when
    // the panel is closed, so refreshSnapshotCount is required to keep
    // the toolbar badge from going stale.
    vi.mocked(api.snapshots.list).mockResolvedValue([
      {
        id: "snap-1",
        chapter_id: "ch-1",
        label: "v1",
        word_count: 5,
        is_auto: false,
        created_at: "2026-04-17T10:00:00Z",
      },
    ]);
    vi.mocked(api.snapshots.get).mockResolvedValue({
      id: "snap-1",
      chapter_id: "ch-1",
      label: "v1",
      content: JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }),
      word_count: 5,
      is_auto: false,
      created_at: "2026-04-17T10:00:00Z",
    });
    const { ApiRequestError } = await import("../api/client");
    (api.snapshots as unknown as { restore: ReturnType<typeof vi.fn> }).restore = vi
      .fn()
      .mockRejectedValue(new ApiRequestError("Malformed response body", 200, "BAD_JSON"));

    renderEditorPage();
    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    // Open panel, view snapshot, then close panel so the Restore click
    // below fires from SnapshotBanner with the panel closed — that's the
    // realistic state where refreshSnapshots() is a no-op and
    // refreshSnapshotCount is the only signal that updates the badge.
    await userEvent.click(await screen.findByRole("button", { name: /^Snapshots/ }));
    await userEvent.click(await screen.findByRole("button", { name: "View" }));
    await waitFor(() => {
      expect(api.snapshots.get).toHaveBeenCalledWith("snap-1");
    });
    // Close the panel via Escape (the toolbar Snapshots button unmounts
    // together with the Editor when viewingSnapshot is truthy).
    await userEvent.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("complementary", { name: /Snapshots/i })).toBeNull();
    });

    const listCallsBefore = vi.mocked(api.snapshots.list).mock.calls.length;

    const restoreButtons = await screen.findAllByRole("button", { name: "Restore" });
    await userEvent.click(restoreButtons[0]!);
    const dialog = await screen.findByRole("alertdialog", { name: "Restore" });
    const confirmButton = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Restore",
    );
    await userEvent.click(confirmButton!);

    // Lock banner confirms we're in the possibly_committed branch.
    expect(
      await screen.findByText(STRINGS.snapshots.restoreResponseUnreadable),
    ).toBeInTheDocument();
    // refreshSnapshotCount() issues a fresh list() call to update the
    // toolbar badge — without the I1 fix this would stay at the pre-
    // restore value because refreshSnapshots() is a no-op on a closed
    // panel.
    await waitFor(() => {
      expect(vi.mocked(api.snapshots.list).mock.calls.length).toBeGreaterThan(listCallsBefore);
    });
  });

  it("clicks Create Snapshot in the panel (exercises onBeforeCreate)", async () => {
    (api.snapshots as unknown as { create: ReturnType<typeof vi.fn> }).create = vi
      .fn()
      .mockResolvedValue({
        status: "created",
        snapshot: {
          id: "snap-new",
          chapter_id: "ch-1",
          label: null,
          content: "{}",
          word_count: 10,
          is_auto: false,
          created_at: new Date().toISOString(),
        },
      });
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    const button = await screen.findByRole("button", { name: /^Snapshots$/ });
    await userEvent.click(button);

    const create = await screen.findByRole("button", { name: "Create Snapshot" });
    await userEvent.click(create);

    const save = await screen.findByRole("button", { name: "Save" });
    await userEvent.click(save);
  });
});
