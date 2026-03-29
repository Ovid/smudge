import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorPage } from "../pages/EditorPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
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
      word_count: 10,
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
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
  ],
};

const mockChapter = mockProject.chapters[0];

function renderEditorPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/proj-1"]}>
      <Routes>
        <Route path="/projects/:projectId" element={<EditorPage />} />
        <Route path="/" element={<div>Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

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
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("complementary", { name: "Chapters" })).toBeNull();
    });

    // Show sidebar again
    fireEvent.keyDown(document, { key: "\\", ctrlKey: true, shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("complementary", { name: "Chapters" })).toBeInTheDocument();
    });
  });

  it("shows preview button in header", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Preview")).toBeInTheDocument();
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
    await userEvent.click(deleteButtons[0]);

    // Should show confirmation dialog
    expect(screen.getByRole("alertdialog", { name: "Confirm delete" })).toBeInTheDocument();
    expect(screen.getByText(/Move .+ to trash/)).toBeInTheDocument();
  });

  it("cancels delete when clicking Cancel", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getAllByText("Chapter One").length).toBeGreaterThanOrEqual(1);
    });

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    await userEvent.click(deleteButtons[0]);

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
    await userEvent.click(deleteButtons[0]);

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

describe("EditorPage preview mode", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("opens preview when clicking Preview button", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Preview")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Preview"));

    await waitFor(() => {
      expect(screen.getByText("Back to Editor")).toBeInTheDocument();
    });
  });

  it("toggles preview with Ctrl+Shift+P", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "Chapter One" })).toBeInTheDocument();
    });

    // Open preview
    fireEvent.keyDown(document, { key: "P", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.getByText("Back to Editor")).toBeInTheDocument();
    });

    // Close preview
    fireEvent.keyDown(document, { key: "P", ctrlKey: true, shiftKey: true });

    await waitFor(() => {
      expect(screen.queryByText("Back to Editor")).toBeNull();
    });
  });

  it("closes preview and navigates to chapter when clicking chapter heading", async () => {
    vi.mocked(api.chapters.get)
      .mockResolvedValueOnce(mockChapter) // initial load
      .mockResolvedValueOnce(mockProject.chapters[1]); // navigate to ch-2

    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByText("Preview")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByText("Preview"));

    await waitFor(() => {
      expect(screen.getByText("Back to Editor")).toBeInTheDocument();
    });

    // Click a chapter heading in preview
    const ch2Heading = screen.getByRole("heading", { name: "Chapter Two" });
    await userEvent.click(ch2Heading);

    // Preview should close and chapter should switch
    await waitFor(() => {
      expect(screen.queryByText("Back to Editor")).toBeNull();
    });
  });
});
