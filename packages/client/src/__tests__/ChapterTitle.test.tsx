import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
  configure,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorPage } from "../pages/EditorPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api/client";
import { STRINGS } from "../strings";

// CI runners (especially Node 20 on Ubuntu) can be slow enough that full EditorPage
// re-renders exceed the default 1000ms waitFor timeout. 10s covers observed CI variance
// (failures seen at ~5060ms). Tests using userEvent.type also need { timeout: 15000 }
// on their it() calls because per-character re-renders can exceed the default 5s vitest
// testTimeout.
configure({ asyncUtilTimeout: 10_000 });

vi.mock("../hooks/useContentCache", () => ({
  getCachedContent: vi.fn().mockReturnValue(null),
  setCachedContent: vi.fn().mockReturnValue(true),
  clearCachedContent: vi.fn(),
}));

// Store the onSave callback so tests can trigger saves directly
let capturedOnSave: ((content: Record<string, unknown>) => Promise<boolean>) | null = null;

vi.mock("../components/Editor", () => ({
  Editor: ({
    onSave,
  }: {
    content: Record<string, unknown> | null;
    onSave: (content: Record<string, unknown>) => Promise<boolean>;
    onContentChange?: (content: Record<string, unknown>) => void;
    editorRef?: React.MutableRefObject<{ flushSave: () => void } | null>;
  }) => {
    capturedOnSave = onSave;
    return (
      <div role="textbox" aria-multiline="true" aria-label="Chapter content">
        Mock editor
      </div>
    );
  },
}));

// Mock the API module
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
    settings: {
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ message: "ok" }),
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
  target_word_count: null,
  target_deadline: null,
  completion_threshold: "final" as const,
  chapters: [
    {
      id: "ch-1",
      project_id: "proj-1",
      title: "My Chapter",
      content: { type: "doc", content: [{ type: "paragraph" }] },
      sort_order: 0,
      word_count: 0,
      target_word_count: null,
      status: "outline",
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

  async function findTitleInput(): Promise<HTMLInputElement> {
    let input: HTMLInputElement | null = null;
    await waitFor(() => {
      input = document.querySelector("input[aria-label='Chapter title']");
      expect(input).not.toBeNull();
    });
    return input!;
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
    const input = await findTitleInput();
    expect(input).not.toBeNull();
    expect(input).toHaveValue("My Chapter");
  });

  it("saves title on Enter", { timeout: 15000 }, async () => {
    renderEditorPage();
    const title = await findChapterTitle();
    fireEvent.doubleClick(title);
    const input = await findTitleInput();

    await userEvent.clear(input);
    await userEvent.type(input, "Renamed Chapter{Enter}");

    await waitFor(() => {
      expect(api.chapters.update).toHaveBeenCalledWith("ch-1", {
        title: "Renamed Chapter",
      });
    });
  });

  it("cancels editing on Escape without saving", { timeout: 15000 }, async () => {
    renderEditorPage();
    const title = await findChapterTitle();
    fireEvent.doubleClick(title);
    const input = await findTitleInput();

    await userEvent.clear(input);
    await userEvent.type(input, "Something else{Escape}");

    expect(api.chapters.update).not.toHaveBeenCalled();
    const restoredTitle = screen.getByRole("heading", { level: 2, name: "My Chapter" });
    expect(restoredTitle.textContent).toBe("My Chapter");
  });

  it("does not save if title is whitespace-only", { timeout: 15000 }, async () => {
    renderEditorPage();
    const title = await findChapterTitle();
    fireEvent.doubleClick(title);
    const input = await findTitleInput();

    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");

    expect(api.chapters.update).not.toHaveBeenCalled();
  });
});

async function findProjectTitleInput(): Promise<HTMLInputElement> {
  let input: HTMLInputElement | null = null;
  await waitFor(() => {
    input = document.querySelector("input[aria-label='Project title']");
    expect(input).not.toBeNull();
  });
  return input!;
}

describe("Project title editing", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
    vi.mocked(api.projects.update).mockResolvedValue({
      id: mockProject.id,
      slug: "renamed-project",
      title: "Renamed Project",
      mode: mockProject.mode,
      target_word_count: mockProject.target_word_count,
      target_deadline: mockProject.target_deadline,
      completion_threshold: mockProject.completion_threshold,
      created_at: mockProject.created_at,
      updated_at: mockProject.updated_at,
      deleted_at: mockProject.deleted_at,
    });
  });

  it("enters edit mode on double-click of project title", { timeout: 15000 }, async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    const projectTitle = screen.getByRole("heading", { level: 1 });
    fireEvent.doubleClick(projectTitle);

    const input = await findProjectTitleInput();
    expect(input).not.toBeNull();
    expect(input).toHaveValue("Test Project");
  });

  it("cancels project title editing on Escape without saving", { timeout: 15000 }, async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    const projectTitle = screen.getByRole("heading", { level: 1 });
    fireEvent.doubleClick(projectTitle);

    const input = await findProjectTitleInput();
    await userEvent.clear(input);
    await userEvent.type(input, "Something else{Escape}");

    expect(api.projects.update).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });
  });

  it("does not save project title if whitespace-only", { timeout: 15000 }, async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    const projectTitle = screen.getByRole("heading", { level: 1 });
    fireEvent.doubleClick(projectTitle);

    const input = await findProjectTitleInput();
    await userEvent.clear(input);
    await userEvent.type(input, "   {Enter}");

    expect(api.projects.update).not.toHaveBeenCalled();
  });

  it("saves project title on Enter", { timeout: 15000 }, async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });

    const projectTitle = screen.getByRole("heading", { level: 1 });
    fireEvent.doubleClick(projectTitle);

    const input = await findProjectTitleInput();
    await userEvent.clear(input);
    await userEvent.type(input, "Renamed Project{Enter}");

    await waitFor(() => {
      expect(api.projects.update).toHaveBeenCalledWith("test-project", {
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

    // Trigger save directly via captured onSave callback
    expect(capturedOnSave).toBeTruthy();
    // Fire and forget — the mock never resolves so status stays "saving"
    capturedOnSave?.({ type: "doc", content: [{ type: "paragraph" }] });

    await waitFor(() => {
      expect(screen.getByText("Saving\u2026")).toBeInTheDocument();
    });
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

    expect(capturedOnSave).toBeTruthy();
    await act(async () => {
      await capturedOnSave?.({ type: "doc", content: [{ type: "paragraph" }] });
    });

    await waitFor(
      () => {
        expect(screen.getByText("Saved")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("shows error message on save failure", async () => {
    vi.mocked(api.chapters.update).mockRejectedValue(new TypeError("Failed to fetch"));
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "My Chapter" })).toBeInTheDocument();
    });

    expect(capturedOnSave).toBeTruthy();
    await act(async () => {
      await capturedOnSave?.({ type: "doc", content: [{ type: "paragraph" }] });
    });

    await waitFor(() => {
      expect(screen.getByText(STRINGS.editor.saveFailed)).toBeInTheDocument();
    });
  }, 25000);

  it("displays the back button that navigates home", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: "My Chapter" })).toBeInTheDocument();
    });

    const logoText = screen.getByText("Smudge");
    expect(logoText).toBeInTheDocument();
    const backButton = logoText.closest("button");
    expect(backButton).toBeInTheDocument();
  });

  it("displays the project title in the header", async () => {
    renderEditorPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Test Project" })).toBeInTheDocument();
    });
  });
});
