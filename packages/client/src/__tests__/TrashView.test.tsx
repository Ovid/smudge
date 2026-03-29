import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrashView } from "../components/TrashView";
import type { Chapter } from "@smudge/shared";

afterEach(() => {
  cleanup();
});

const trashedChapters: Chapter[] = [
  {
    id: "ch1",
    project_id: "p1",
    title: "Deleted Chapter",
    content: null,
    sort_order: 0,
    word_count: 50,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    deleted_at: "2026-03-20T10:00:00.000Z",
  },
];

describe("TrashView", () => {
  it("renders trashed chapters", () => {
    render(<TrashView chapters={trashedChapters} onRestore={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText("Deleted Chapter")).toBeInTheDocument();
  });

  it("calls onRestore when clicking Restore", async () => {
    const onRestore = vi.fn();
    render(<TrashView chapters={trashedChapters} onRestore={onRestore} onBack={vi.fn()} />);

    await userEvent.click(screen.getByText("Restore"));
    expect(onRestore).toHaveBeenCalledWith("ch1");
  });

  it("shows the permanent deletion date for each trashed chapter", () => {
    render(<TrashView chapters={trashedChapters} onRestore={vi.fn()} onBack={vi.fn()} />);

    // deleted_at is 2026-03-20, so purge date is 30 days later: Apr 19, 2026
    expect(screen.getByText(/Permanently deleted.*Apr 19, 2026/)).toBeInTheDocument();
  });

  it("shows empty state when no trashed chapters", () => {
    render(<TrashView chapters={[]} onRestore={vi.fn()} onBack={vi.fn()} />);

    expect(screen.getByText(/no chapters in trash/i)).toBeInTheDocument();
  });

  it("calls onBack when clicking Back", async () => {
    const onBack = vi.fn();
    render(<TrashView chapters={trashedChapters} onRestore={vi.fn()} onBack={onBack} />);

    await userEvent.click(screen.getByText("Back to editor"));
    expect(onBack).toHaveBeenCalled();
  });
});
