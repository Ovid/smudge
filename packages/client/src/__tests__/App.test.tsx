import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { App } from "../App";
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
      list: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      reorderChapters: vi.fn(),
      trash: vi.fn(),
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
    settings: {
      get: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({ message: "ok" }),
    },
  },
}));

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("App", () => {
  it("renders the home page at /", async () => {
    vi.mocked(api.projects.list).mockResolvedValue([]);

    // Set window location to /
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Smudge", level: 1 })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "New Project" })).toBeInTheDocument();
  });

  it("renders the editor page at /projects/:slug", async () => {
    const mockProject = {
      id: "p1",
      slug: "test-project",
      title: "Test Project",
      mode: "fiction" as const,
      created_at: "",
      updated_at: "",
      deleted_at: null,
      target_word_count: null,
      target_deadline: null,
      author_name: null,
      chapters: [
        {
          id: "ch-1",
          project_id: "p1",
          title: "Chapter One",
          content: { type: "doc", content: [{ type: "paragraph" }] },
          sort_order: 0,
          word_count: 0,
          status: "outline",
          created_at: "",
          updated_at: "",
          deleted_at: null,
        },
      ],
    };

    vi.mocked(api.projects.get).mockResolvedValue(mockProject);
    vi.mocked(api.chapters.get).mockResolvedValue(
      mockProject.chapters[0] as (typeof mockProject.chapters)[0],
    );

    window.history.pushState({}, "", "/projects/test-project");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Test Project" })).toBeInTheDocument();
    });
  });
});
