import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
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
    },
    chapters: {
      get: vi.fn(),
      update: vi.fn(),
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
      title: "My Chapter",
      content: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world test" }] }],
      },
      sort_order: 0,
      word_count: 3,
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

describe("Status bar", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(mockChapter);
  });

  it("displays a status bar with word count", async () => {
    renderEditorPage();

    await waitFor(() => {
      const footer = document.querySelector("footer");
      expect(footer).not.toBeNull();
      expect(footer?.textContent).toContain("words");
    });
  });

  it("shows chapter word count", async () => {
    renderEditorPage();

    await waitFor(() => {
      const footer = document.querySelector("footer");
      expect(footer?.textContent).toContain("3");
    });
  });

  it("shows save status in status bar area", async () => {
    renderEditorPage();

    // Before any save, the status bar area should exist with an aria-live region
    await waitFor(() => {
      const liveRegion = document.querySelector("[aria-live='polite']");
      expect(liveRegion).not.toBeNull();
    });
  });
});
