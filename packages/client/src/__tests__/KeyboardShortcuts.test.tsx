import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { EditorPage } from "../pages/EditorPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api/client";

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
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
  ],
};

const mockChapter = mockProject.chapters[0] as (typeof mockProject.chapters)[0];

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
      title: "Untitled Chapter",
      content: null,
      sort_order: 1,
      word_count: 0,
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
