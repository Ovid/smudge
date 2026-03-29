import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { EditorPage } from "../pages/EditorPage";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    projects: {
      get: vi.fn(),
      update: vi.fn(),
    },
    chapters: {
      get: vi.fn(),
      update: vi.fn(),
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
      content: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Hello world test" }] },
        ],
      },
      sort_order: 0,
      word_count: 3,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      deleted_at: null,
    },
  ],
};

const mockChapter = mockProject.chapters[0]!;

function renderEditorPage() {
  return render(
    <MemoryRouter initialEntries={["/projects/proj-1"]}>
      <Routes>
        <Route path="/projects/:projectId" element={<EditorPage />} />
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
      const statusBar = document.querySelector("[role='status']");
      expect(statusBar).not.toBeNull();
      expect(statusBar?.textContent).toContain("words");
    });
  });

  it("shows chapter word count", async () => {
    renderEditorPage();

    await waitFor(() => {
      const statusBar = document.querySelector("[role='status']");
      expect(statusBar?.textContent).toContain("3");
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
