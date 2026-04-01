import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "../components/Sidebar";
import type { ProjectWithChapters, ChapterStatusRow } from "@smudge/shared";

const mockStatuses: ChapterStatusRow[] = [
  { status: "outline", sort_order: 0, label: "Outline" },
  { status: "rough_draft", sort_order: 1, label: "Rough Draft" },
  { status: "revised", sort_order: 2, label: "Revised" },
  { status: "edited", sort_order: 3, label: "Edited" },
  { status: "final", sort_order: 4, label: "Final" },
];

const mockProject: ProjectWithChapters = {
  id: "p1",
  slug: "test-project",
  title: "Test Project",
  mode: "fiction",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  deleted_at: null,
  chapters: [
    {
      id: "ch1",
      project_id: "p1",
      title: "Chapter One",
      content: null,
      sort_order: 0,
      word_count: 100,
      status: "outline",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    },
    {
      id: "ch2",
      project_id: "p1",
      title: "Chapter Two",
      content: null,
      sort_order: 1,
      word_count: 200,
      status: "revised",
      created_at: "2026-01-01",
      updated_at: "2026-01-01",
      deleted_at: null,
    },
  ],
};

function renderSidebar(overrides = {}) {
  const defaults = {
    project: mockProject,
    activeChapterId: "ch1",
    onSelectChapter: vi.fn(),
    onAddChapter: vi.fn(),
    onDeleteChapter: vi.fn(),
    onReorderChapters: vi.fn(),
    onRenameChapter: vi.fn(),
    onOpenTrash: vi.fn(),
    statuses: mockStatuses,
    onStatusChange: vi.fn(),
    width: 260,
    onResize: vi.fn(),
  };
  return render(<Sidebar {...defaults} {...overrides} />);
}

afterEach(() => {
  cleanup();
});

describe("Sidebar", () => {
  it("renders the Smudge logo and visually-hidden heading at the top", () => {
    renderSidebar();

    const heading = screen.getByRole("heading", { name: "Smudge", level: 2 });
    expect(heading).toBeInTheDocument();

    const logo = heading.parentElement?.querySelector("img");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("aria-hidden", "true");
  });

  it("renders chapter list", () => {
    renderSidebar();

    expect(screen.getByText("Chapter One")).toBeInTheDocument();
    expect(screen.getByText("Chapter Two")).toBeInTheDocument();
  });

  it("highlights active chapter", () => {
    renderSidebar();

    const activeItem = screen.getByText("Chapter One").closest("li");
    expect(activeItem?.className).toContain("bg-accent-light");
  });

  it("calls onSelectChapter when clicking a chapter", async () => {
    const onSelect = vi.fn();
    renderSidebar({ onSelectChapter: onSelect });

    await userEvent.click(screen.getByText("Chapter Two"));
    expect(onSelect).toHaveBeenCalledWith("ch2");
  });

  it("calls onAddChapter when clicking Add Chapter button", async () => {
    const onAdd = vi.fn();
    renderSidebar({ onAddChapter: onAdd });

    await userEvent.click(screen.getByText("Add Chapter"));
    expect(onAdd).toHaveBeenCalled();
  });

  it("has correct ARIA landmark", () => {
    renderSidebar();

    expect(screen.getByRole("complementary", { name: "Chapters" })).toBeInTheDocument();
  });

  it("sets aria-current on active chapter", () => {
    renderSidebar();

    const activeItem = screen.getByText("Chapter One").closest("li");
    expect(activeItem).toHaveAttribute("aria-current", "true");

    const inactiveItem = screen.getByText("Chapter Two").closest("li");
    expect(inactiveItem).not.toHaveAttribute("aria-current");
  });

  it("allows inline rename on double-click", async () => {
    const onRename = vi.fn();
    renderSidebar({ onRenameChapter: onRename });

    await userEvent.dblClick(screen.getByText("Chapter One"));
    const input = screen.getByRole("textbox", { name: "Chapter title" });
    expect(input).toBeInTheDocument();

    await userEvent.clear(input);
    await userEvent.type(input, "Renamed{Enter}");
    expect(onRename).toHaveBeenCalledWith("ch1", "Renamed");
  });

  it("commits rename on blur", async () => {
    const onRename = vi.fn();
    renderSidebar({ onRenameChapter: onRename });

    await userEvent.dblClick(screen.getByText("Chapter One"));
    const input = screen.getByRole("textbox", { name: "Chapter title" });
    await userEvent.clear(input);
    await userEvent.type(input, "Blur Renamed");
    input.blur();

    expect(onRename).toHaveBeenCalledWith("ch1", "Blur Renamed");
  });

  it("cancels rename on Escape", async () => {
    const onRename = vi.fn();
    renderSidebar({ onRenameChapter: onRename });

    await userEvent.dblClick(screen.getByText("Chapter One"));
    const input = screen.getByRole("textbox", { name: "Chapter title" });
    await userEvent.type(input, "{Escape}");

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Chapter One")).toBeInTheDocument();
  });

  it("calls onDeleteChapter when clicking delete button", async () => {
    const onDelete = vi.fn();
    renderSidebar({ onDeleteChapter: onDelete });

    const deleteButtons = screen.getAllByRole("button", { name: /Delete/ });
    await userEvent.click(deleteButtons[0]!);
    expect(onDelete).toHaveBeenCalledWith(mockProject.chapters[0]);
  });

  it("calls onOpenTrash when clicking Trash button", async () => {
    const onOpenTrash = vi.fn();
    renderSidebar({ onOpenTrash });

    await userEvent.click(screen.getByText("Trash"));
    expect(onOpenTrash).toHaveBeenCalled();
  });

  it("renders drag handles for each chapter", () => {
    renderSidebar();

    const handles = screen.getAllByLabelText("Drag to reorder");
    expect(handles).toHaveLength(2);
  });

  it("drag handles have correct role and tabindex", () => {
    renderSidebar();

    const handles = screen.getAllByLabelText("Drag to reorder");
    for (const handle of handles) {
      expect(handle).toHaveAttribute("role", "button");
      expect(handle).toHaveAttribute("tabindex", "0");
    }
  });

  it("reorders chapter up with Alt+ArrowUp", async () => {
    const onReorder = vi.fn();
    renderSidebar({ onReorderChapters: onReorder, activeChapterId: "ch2" });

    const ch2Button = screen.getByText("Chapter Two");
    ch2Button.focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");

    expect(onReorder).toHaveBeenCalledWith(["ch2", "ch1"]);
  });

  it("reorders chapter down with Alt+ArrowDown", async () => {
    const onReorder = vi.fn();
    renderSidebar({ onReorderChapters: onReorder });

    const ch1Button = screen.getByText("Chapter One");
    ch1Button.focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(onReorder).toHaveBeenCalledWith(["ch2", "ch1"]);
  });

  it("does not reorder first chapter up", async () => {
    const onReorder = vi.fn();
    renderSidebar({ onReorderChapters: onReorder });

    const ch1Button = screen.getByText("Chapter One");
    ch1Button.focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("does not reorder last chapter down", async () => {
    const onReorder = vi.fn();
    renderSidebar({ onReorderChapters: onReorder, activeChapterId: "ch2" });

    const ch2Button = screen.getByText("Chapter Two");
    ch2Button.focus();
    await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");

    expect(onReorder).not.toHaveBeenCalled();
  });

  it("renders status badge for each chapter", () => {
    renderSidebar();

    const outlineBadge = screen.getByRole("button", { name: "Chapter status: Outline" });
    expect(outlineBadge).toBeInTheDocument();

    const revisedBadge = screen.getByRole("button", { name: "Chapter status: Revised" });
    expect(revisedBadge).toBeInTheDocument();
  });

  it("opens status dropdown on click", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(5);
  });

  it("renders resize handle", () => {
    renderSidebar();

    expect(screen.getByLabelText("Resize sidebar")).toBeInTheDocument();
  });

  it("calls onStatusChange when selecting a status", async () => {
    const onStatusChange = vi.fn();
    renderSidebar({ onStatusChange });

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    const editedOption = screen.getByRole("option", { name: "Edited" });
    await userEvent.click(editedOption);

    expect(onStatusChange).toHaveBeenCalledWith("ch1", "edited");
  });

  it("closes status dropdown on outside click", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    // Dropdown should be open
    expect(screen.getByRole("listbox")).toBeInTheDocument();

    // Click outside the dropdown (on the sidebar heading area)
    await userEvent.click(screen.getByRole("heading", { name: "Smudge", level: 2 }));

    // Dropdown should be closed
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("closes status dropdown on Escape key", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    expect(screen.getByRole("listbox")).toBeInTheDocument();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("selects status with Enter key in dropdown", async () => {
    const onStatusChange = vi.fn();
    renderSidebar({ onStatusChange });

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    const revisedOption = screen.getByRole("option", { name: "Revised" });
    revisedOption.focus();
    await userEvent.keyboard("{Enter}");

    expect(onStatusChange).toHaveBeenCalledWith("ch1", "revised");
    // Dropdown should close after selection
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("adjusts sidebar width with keyboard arrows on resize handle", async () => {
    const onResize = vi.fn();
    renderSidebar({ onResize, width: 260 });

    const resizeHandle = screen.getByLabelText("Resize sidebar");
    resizeHandle.focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(onResize).toHaveBeenCalledWith(270);

    onResize.mockClear();
    await userEvent.keyboard("{ArrowLeft}");
    expect(onResize).toHaveBeenCalledWith(250);
  });

  it("opens status dropdown when pressing ArrowDown on status badge", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    badge.focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("opens status dropdown when pressing ArrowUp on status badge", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    badge.focus();
    await userEvent.keyboard("{ArrowUp}");

    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("does not open dropdown for non-arrow keys on status badge (falls through to handleKeyDown)", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    badge.focus();
    await userEvent.keyboard("{Tab}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("navigates listbox options with ArrowDown", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    const options = screen.getAllByRole("option");
    // Focus the first option (Outline, which is currently selected)
    options[0]!.focus();
    expect(document.activeElement).toBe(options[0]);

    // Press ArrowDown to move to the next option
    fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(options[1]);
  });

  it("navigates listbox options with ArrowUp", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    const options = screen.getAllByRole("option");
    // Focus the second option
    options[1]!.focus();

    // Press ArrowUp to move to the previous option
    fireEvent.keyDown(options[1]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(options[0]);
  });

  it("navigates to first listbox option with Home key", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    const options = screen.getAllByRole("option");
    // Focus the last option
    options[4]!.focus();

    // Press Home to move to the first option
    fireEvent.keyDown(options[4]!, { key: "Home" });
    expect(document.activeElement).toBe(options[0]);
  });

  it("navigates to last listbox option with End key", async () => {
    renderSidebar();

    const badge = screen.getByRole("button", { name: "Chapter status: Outline" });
    await userEvent.click(badge);

    const options = screen.getAllByRole("option");
    // Focus the first option
    options[0]!.focus();

    // Press End to move to the last option
    fireEvent.keyDown(options[0]!, { key: "End" });
    expect(document.activeElement).toBe(options[4]);
  });

  it("resizes sidebar via mouse drag on resize handle", () => {
    const onResize = vi.fn();
    renderSidebar({ onResize, width: 260 });

    const resizeHandle = screen.getByLabelText("Resize sidebar");

    // Start the drag at clientX = 260
    fireEvent.mouseDown(resizeHandle, { clientX: 260 });

    // Move the mouse to the right by 50px
    fireEvent.mouseMove(document, { clientX: 310 });
    expect(onResize).toHaveBeenCalledWith(310);

    // Move left past the minimum (180)
    onResize.mockClear();
    fireEvent.mouseMove(document, { clientX: 100 });
    expect(onResize).toHaveBeenCalledWith(180);

    // Release the mouse
    fireEvent.mouseUp(document);

    // After mouseUp, further moves should not trigger onResize
    onResize.mockClear();
    fireEvent.mouseMove(document, { clientX: 400 });
    expect(onResize).not.toHaveBeenCalled();
  });

  it("clamps resize to max width of 480", () => {
    const onResize = vi.fn();
    renderSidebar({ onResize, width: 260 });

    const resizeHandle = screen.getByLabelText("Resize sidebar");

    fireEvent.mouseDown(resizeHandle, { clientX: 260 });
    fireEvent.mouseMove(document, { clientX: 800 });
    expect(onResize).toHaveBeenCalledWith(480);

    fireEvent.mouseUp(document);
  });
});
