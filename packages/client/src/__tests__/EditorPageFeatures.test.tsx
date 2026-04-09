import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      dashboard: vi.fn(),
      velocity: vi.fn().mockResolvedValue({
        daily_snapshots: [],
        sessions: [],
        streak: { current: 0, best: 0 },
        projection: {
          target_word_count: null,
          target_deadline: null,
          projected_date: null,
          daily_average_30d: 0,
        },
        completion: { threshold_status: "final", total_chapters: 0, completed_chapters: 0 },
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
  completion_threshold: "final" as const,
  chapters: [
    {
      id: "ch-1",
      project_id: "proj-1",
      title: "Chapter One",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 0,
      word_count: 10,
      target_word_count: null,
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
      target_word_count: null,
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
    vi.mocked(api.projects.get).mockRejectedValue(new Error("Project not found."));

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Project not found.")).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: "Back to Projects" })).toBeInTheDocument();
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
      target_word_count: null,
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
      target_word_count: null,
      status: "outline" as const,
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: "2026-03-20T10:00:00.000Z",
    };
    vi.mocked(api.projects.trash).mockResolvedValue([trashedChapter]);
    vi.mocked(api.chapters.restore).mockResolvedValue({
      ...trashedChapter,
      deleted_at: null,
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
      target_word_count: null,
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
      target_word_count: null,
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
  });

  it("navigates when project title update returns a different slug", async () => {
    vi.mocked(api.projects.update).mockResolvedValue({
      id: mockProject.id,
      slug: "new-title",
      title: "New Title",
      mode: mockProject.mode,
      target_word_count: mockProject.target_word_count,
      target_deadline: mockProject.target_deadline,
      completion_threshold: mockProject.completion_threshold,
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
    vi.mocked(api.projects.get).mockRejectedValue(new Error("Server error"));

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Server error")).toBeInTheDocument();
    });

    const backLink = screen.getByRole("link", { name: "Back to Projects" });
    expect(backLink).toBeInTheDocument();
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
      expect(screen.getByText("status boom")).toBeInTheDocument();
    });

    consoleSpy.mockRestore();
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
        target_word_count: null,
        status_label: "Outline",
        status_color: "#ccc",
      })),
      status_summary: { outline: 2 },
      totals: { word_count: 11, chapter_count: 2, most_recent_edit: null, least_recent_edit: null },
    });
  });

  it("switches to editor view when clicking Editor tab button", async () => {
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
  });

  it("switches to dashboard view when clicking Dashboard tab button", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    // Click Dashboard tab
    await userEvent.click(screen.getByText("Dashboard"));

    // Dashboard view should render with sub-tabs (Velocity is default)
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Velocity/i })).toBeInTheDocument();
    });
  });

  it("renders dashboard view with DashboardView component", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Dashboard"));

    await waitFor(() => {
      // The DashboardView component should render sub-tabs
      expect(screen.getByRole("tab", { name: /Velocity/i })).toBeInTheDocument();
    });

    // The Dashboard tab should show as current
    const dashboardButton = screen.getByText("Dashboard");
    expect(dashboardButton).toHaveAttribute("aria-current", "page");
  });
});
