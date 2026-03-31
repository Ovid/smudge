import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PreviewMode } from "../components/PreviewMode";
import type { Chapter } from "@smudge/shared";

const mockObserve = vi.fn();
const mockDisconnect = vi.fn();
let observerCallback: IntersectionObserverCallback;

const originalIntersectionObserver = global.IntersectionObserver;

beforeAll(() => {
  // Mock IntersectionObserver for jsdom
  global.IntersectionObserver = vi.fn().mockImplementation((cb: IntersectionObserverCallback) => {
    observerCallback = cb;
    return {
      observe: mockObserve,
      unobserve: vi.fn(),
      disconnect: mockDisconnect,
    };
  });
});

afterAll(() => {
  global.IntersectionObserver = originalIntersectionObserver;
});

afterEach(() => {
  cleanup();
  mockObserve.mockClear();
  mockDisconnect.mockClear();
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
    status: "outline",
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
    status: "outline",
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: null,
  },
];

describe("PreviewMode", () => {
  it("renders all chapter titles as h2 headings", () => {
    render(<PreviewMode chapters={chapters} onNavigateToChapter={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "Chapter One" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Chapter Two" })).toBeInTheDocument();
  });

  it("renders chapter content as HTML", () => {
    render(<PreviewMode chapters={chapters} onNavigateToChapter={vi.fn()} />);

    expect(screen.getByText("Hello world")).toBeInTheDocument();
    expect(screen.getByText("Goodbye world")).toBeInTheDocument();
  });

  it("calls onNavigateToChapter when clicking a chapter heading", async () => {
    const onNav = vi.fn();
    render(<PreviewMode chapters={chapters} onNavigateToChapter={onNav} />);

    await userEvent.click(screen.getByRole("heading", { name: "Chapter Two" }));
    expect(onNav).toHaveBeenCalledWith("ch2");
  });

  it("renders TOC with chapter titles as links", () => {
    render(<PreviewMode chapters={chapters} onNavigateToChapter={vi.fn()} />);

    const tocNav = screen.getByRole("navigation", { name: "Table of Contents" });
    expect(tocNav).toBeInTheDocument();
  });

  it("renders empty string for null content", () => {
    const chaptersWithNull: Chapter[] = [
      {
        ...chapters[0],
        content: null,
      },
    ];
    render(<PreviewMode chapters={chaptersWithNull} onNavigateToChapter={vi.fn()} />);

    // Chapter title should still render
    expect(screen.getByRole("heading", { name: "Chapter One" })).toBeInTheDocument();
  });

  it("updates activeTocId when IntersectionObserver fires", () => {
    render(<PreviewMode chapters={chapters} onNavigateToChapter={vi.fn()} />);

    // Simulate the observer callback reporting ch2 is intersecting
    const mockEntry = {
      isIntersecting: true,
      target: { id: "ch2" },
    } as unknown as IntersectionObserverEntry;

    act(() => {
      observerCallback([mockEntry], {} as IntersectionObserver);
    });

    // The TOC link for ch2 should now have aria-current="true"
    const tocLinks = screen.getAllByRole("link");
    const ch2Link = tocLinks.find((link) => link.textContent === "Chapter Two");
    expect(ch2Link).toHaveAttribute("aria-current", "true");

    // ch1 link should not have aria-current
    const ch1Link = tocLinks.find((link) => link.textContent === "Chapter One");
    expect(ch1Link).not.toHaveAttribute("aria-current");
  });

  it("ignores non-intersecting entries in observer callback", () => {
    render(<PreviewMode chapters={chapters} onNavigateToChapter={vi.fn()} />);

    // First set ch2 as active
    act(() => {
      observerCallback(
        [{ isIntersecting: true, target: { id: "ch2" } } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    // Now fire a non-intersecting entry for ch1 — should not change active
    act(() => {
      observerCallback(
        [{ isIntersecting: false, target: { id: "ch1" } } as unknown as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    const tocLinks = screen.getAllByRole("link");
    const ch2Link = tocLinks.find((link) => link.textContent === "Chapter Two");
    expect(ch2Link).toHaveAttribute("aria-current", "true");
  });

  it("renders error message when generateHTML throws on malformed content", () => {
    const chaptersWithBadContent: Chapter[] = [
      {
        ...chapters[0],
        content: { type: "invalid_type_that_doesnt_exist" } as unknown as Chapter["content"],
      },
    ];
    render(<PreviewMode chapters={chaptersWithBadContent} onNavigateToChapter={vi.fn()} />);

    // The chapter title should still render
    expect(screen.getByRole("heading", { name: "Chapter One" })).toBeInTheDocument();
    // The render error fallback should appear
    expect(screen.getByText("Unable to render content")).toBeInTheDocument();
  });
});
