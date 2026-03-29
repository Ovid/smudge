import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewMode } from "../components/PreviewMode";
import type { Chapter } from "@smudge/shared";

beforeAll(() => {
  // Mock IntersectionObserver for jsdom
  global.IntersectionObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
});

const chapters: Chapter[] = [
  {
    id: "ch1",
    project_id: "p1",
    title: "Chapter One",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    },
    sort_order: 0,
    word_count: 2,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: null,
  },
  {
    id: "ch2",
    project_id: "p1",
    title: "Chapter Two",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Goodbye world" }] }],
    },
    sort_order: 1,
    word_count: 2,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: null,
  },
];

describe("PreviewMode", () => {
  it("renders all chapter titles as h2 headings", () => {
    render(<PreviewMode chapters={chapters} onClose={vi.fn()} onNavigateToChapter={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Chapter One" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chapter Two" })).toBeInTheDocument();
  });

  it("renders chapter content as HTML", () => {
    render(<PreviewMode chapters={chapters} onClose={vi.fn()} onNavigateToChapter={vi.fn()} />);

    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("Goodbye world")).toBeInTheDocument();
  });

  it("calls onClose when Back to Editor is clicked", async () => {
    const onClose = vi.fn();
    render(<PreviewMode chapters={chapters} onClose={onClose} onNavigateToChapter={vi.fn()} />);

    await userEvent.click(screen.getByText("Back to Editor"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onNavigateToChapter when clicking a chapter heading", async () => {
    const onNav = vi.fn();
    render(<PreviewMode chapters={chapters} onClose={vi.fn()} onNavigateToChapter={onNav} />);

    await userEvent.click(screen.getByRole("heading", { name: "Chapter Two" }));
    expect(onNav).toHaveBeenCalledWith("ch2");
  });

  it("has Back to Editor as the first focusable element", () => {
    render(<PreviewMode chapters={chapters} onClose={vi.fn()} onNavigateToChapter={vi.fn()} />);

    const backButton = screen.getByText("Back to Editor");
    const allButtons = screen.getAllByRole("button");
    expect(allButtons[0]).toBe(backButton);
  });

  it("renders TOC with chapter titles as links", () => {
    render(<PreviewMode chapters={chapters} onClose={vi.fn()} onNavigateToChapter={vi.fn()} />);

    const tocNav = screen.getByRole("navigation", { name: "Table of Contents" });
    expect(tocNav).toBeInTheDocument();
  });
});
