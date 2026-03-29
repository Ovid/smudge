import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorPage } from "../pages/EditorPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api/client";

// Mock the API module
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
      title: "My Chapter",
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
    <MemoryRouter initialEntries={["/projects/proj-1"]}>
      <Routes>
        <Route path="/projects/:projectId" element={<EditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("A11y: title attributes", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("does not use title attribute on chapter heading (leaks into accessible name)", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "My Chapter" })).toBeInTheDocument();
    });
    const h2 = screen.getByRole("heading", { level: 2, name: "My Chapter" });
    expect(h2).not.toHaveAttribute("title");
    expect(h2).toHaveAttribute("aria-label", "My Chapter");
  });

  it("does not use title attribute on project heading (leaks into accessible name)", async () => {
    renderEditorPage();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1).not.toHaveAttribute("title");
  });
});

describe("Chapter title editing", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    vi.mocked(api.chapters.update).mockResolvedValue({
      ...mockChapter,
      title: "Renamed Chapter",
    });
  });

  async function findChapterTitle(): Promise<HTMLElement> {
    // Wait for the page to load, then find the h2 with the chapter title
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "My Chapter" })).toBeInTheDocument();
    });
    return screen.getByRole("heading", { level: 2, name: "My Chapter" });
  }

  function getTitleInput(): HTMLInputElement {
    return document.querySelector("input[aria-label='Chapter title']") as HTMLInputElement;
  }

  it("displays the chapter title as an h2", async () => {
    renderEditorPage();
    const title = await findChapterTitle();
    expect(title.tagName).toBe("H2");
    expect(title.textContent).toBe("My Chapter");
  });

  it("enters edit mode on double-click", async () => {
    renderEditorPage();
    const title = await findChapterTitle();
    fireEvent.doubleClick(title);
    const input = getTitleInput();
    expect(input).not.toBeNull();
    expect(input).toHaveValue("My Chapter");
  });

  it("saves title on Enter", async () => {
    renderEditorPage();
    const title = await findChapterTitle();
    fireEvent.doubleClick(title);
    const input = getTitleInput();

    await userEvent.clear(input);
    await userEvent.type(input, "Renamed Chapter{Enter}");

    await waitFor(() => {
      expect(api.chapters.update).toHaveBeenCalledWith("ch-1", {
        title: "Renamed Chapter",
      });
    });
  });

  it("cancels editing on Escape without saving", async () => {
    renderEditorPage();
    const title = await findChapterTitle();
    fireEvent.doubleClick(title);
    const input = getTitleInput();

    await userEvent.clear(input);
    await userEvent.type(input, "Something else{Escape}");

    expect(api.chapters.update).not.toHaveBeenCalled();
    const restoredTitle = screen.getByRole("heading", { level: 2, name: "My Chapter" });
    expect(restoredTitle.textContent).toBe("My Chapter");
  });

  it("does not save if title is whitespace-only", async () => {
    renderEditorPage();
    const title = await findChapterTitle();
    fireEvent.doubleClick(title);
    const input = getTitleInput();

    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");

    expect(api.chapters.update).not.toHaveBeenCalled();
  });
});

describe("Project title editing", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    vi.mocked(api.projects.update).mockResolvedValue({
      ...mockProject,
      title: "Renamed Project",
      chapters: mockProject.chapters,
    });
  });

  it("enters edit mode on double-click of project title", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    const projectTitle = screen.getByRole("heading", { level: 1 });
    fireEvent.doubleClick(projectTitle);

    const input = document.querySelector("input[aria-label='Project title']") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input).toHaveValue("Test Project");
  });

  it("cancels project title editing on Escape without saving", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    const projectTitle = screen.getByRole("heading", { level: 1 });
    fireEvent.doubleClick(projectTitle);

    const input = document.querySelector("input[aria-label='Project title']") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Something else{Escape}");

    expect(api.projects.update).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });
  });

  it("does not save project title if whitespace-only", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    const projectTitle = screen.getByRole("heading", { level: 1 });
    fireEvent.doubleClick(projectTitle);

    const input = document.querySelector("input[aria-label='Project title']") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");

    expect(api.projects.update).not.toHaveBeenCalled();
  });

  it("saves project title on Enter", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    const projectTitle = screen.getByRole("heading", { level: 1 });
    fireEvent.doubleClick(projectTitle);

    const input = document.querySelector("input[aria-label='Project title']") as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed Project{Enter}");

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalledWith("proj-1", {
        title: "Renamed Project",
      });
    });
  });
});

describe("EditorPage save status", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("shows loading state before data arrives", () => {
    // Make API calls never resolve
    vi.mocked(api.projects.get).mockReturnValue(new Promise(() => {}));
    renderEditorPage();
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows 'Saving...' during save", async () => {
    // Make update hang indefinitely to capture saving state
    vi.mocked(api.chapters.update).mockReturnValue(new Promise(() => {}));
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "My Chapter" })).toBeInTheDocument();
    });

    // Modify editor content to mark dirty, then blur to trigger save
    const editorEl = document.querySelector("[role='textbox']") as HTMLElement;
    if (editorEl) {
      fireEvent.focus(editorEl);
      editorEl.textContent = "dirty content";
      fireEvent.input(editorEl);

      // Wait for auto-save debounce to trigger save
      await waitFor(
        () => {
          expect(screen.getByText("Saving\u2026")).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    }
  });

  it("shows 'Saved' after successful save", async () => {
    vi.mocked(api.chapters.update).mockResolvedValue({
      ...mockChapter,
      content: { type: "doc", content: [{ type: "paragraph" }] },
    });
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "My Chapter" })).toBeInTheDocument();
    });

    const editorEl = document.querySelector("[role='textbox']") as HTMLElement;
    if (editorEl) {
      fireEvent.focus(editorEl);
      editorEl.textContent = "dirty content";
      fireEvent.input(editorEl);

      // Wait for auto-save debounce to trigger save + resolve
      await waitFor(
        () => {
          expect(screen.getByText("Saved")).toBeInTheDocument();
        },
        { timeout: 3000 },
      );
    }
  });

  it("shows error message on save failure", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new Error("Network error"));
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "My Chapter" })).toBeInTheDocument();
    });

    const editorEl = document.querySelector("[role='textbox']") as HTMLElement;
    if (editorEl) {
      fireEvent.focus(editorEl);
      editorEl.textContent = "dirty content";
      fireEvent.input(editorEl);

      // Wait for auto-save debounce + retries (with backoff) to complete
      await waitFor(
        () => {
          expect(screen.getByText("Unable to save \u2014 check connection")).toBeInTheDocument();
        },
        { timeout: 20000 },
      );
    }
  }, 25000);

  it("displays the back button that navigates home", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "My Chapter" })).toBeInTheDocument();
    });

    const backButton = screen.getByText(/Projects/);
    expect(backButton).toBeInTheDocument();
    expect(backButton.tagName).toBe("BUTTON");
  });

  it("displays the project title in the header", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Test Project" })).toBeInTheDocument();
    });
  });
});
