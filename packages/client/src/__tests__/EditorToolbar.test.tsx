import { describe, it, expect, vi, afterEach } from "vitest";
import { render, within, fireEvent, cleanup } from "@testing-library/react";
import { EditorToolbar } from "../components/EditorToolbar";
import type { Editor } from "@tiptap/react";

afterEach(() => {
  cleanup();
});

function createMockEditor(activeItems: string[] = []): Editor {
  const chainable = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === "run") return vi.fn();
        return (..._args: unknown[]) => chainable;
      },
    },
  ) as Record<string, (...args: unknown[]) => unknown>;

  const chain = vi.fn(() => chainable);

  return {
    chain,
    isActive: vi.fn((type: string, _attrs?: Record<string, unknown>) => activeItems.includes(type)),
  } as unknown as Editor;
}

describe("EditorToolbar", () => {
  it("renders toolbar with expected buttons", () => {
    const editor = createMockEditor();
    const { container } = render(<EditorToolbar editor={editor} />);
    const toolbar = container.querySelector("[role='toolbar']");
    expect(toolbar).not.toBeNull();
    const toolbarEl = toolbar as HTMLElement;
    expect(within(toolbarEl).getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "Italic" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "H3" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "H4" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "H5" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "Quote" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "Numbered" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "HR" })).toBeInTheDocument();
  });

  it("toolbar buttons are clickable and invoke editor commands", () => {
    const editor = createMockEditor();
    const { container } = render(<EditorToolbar editor={editor} />);
    const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.length).toBe(9);
    for (const button of buttons) {
      fireEvent.click(button);
    }
    // Each click should have triggered a chain call
    expect(editor.chain).toHaveBeenCalledTimes(9);
  });

  it("reflects active state via aria-pressed for toggle buttons", () => {
    const editor = createMockEditor(["bold", "blockquote"]);
    const { container } = render(<EditorToolbar editor={editor} />);
    const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;

    const boldBtn = within(toolbar).getByRole("button", { name: "Bold" });
    expect(boldBtn.getAttribute("aria-pressed")).toBe("true");

    const italicBtn = within(toolbar).getByRole("button", { name: "Italic" });
    expect(italicBtn.getAttribute("aria-pressed")).toBe("false");

    const quoteBtn = within(toolbar).getByRole("button", { name: "Quote" });
    expect(quoteBtn.getAttribute("aria-pressed")).toBe("true");
  });

  it("reflects active state for all toggle buttons", () => {
    const editor = createMockEditor(["italic", "heading", "bulletList", "orderedList"]);
    const { container } = render(<EditorToolbar editor={editor} />);
    const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;

    expect(
      within(toolbar).getByRole("button", { name: "Italic" }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(toolbar).getByRole("button", { name: "H3" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(within(toolbar).getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      within(toolbar).getByRole("button", { name: "Numbered" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("has correct ARIA toolbar label", () => {
    const editor = createMockEditor();
    const { container } = render(<EditorToolbar editor={editor} />);
    const toolbar = container.querySelector("[role='toolbar']");
    expect(toolbar?.getAttribute("aria-label")).toBe("Formatting");
  });

  describe("snapshot button", () => {
    it("does not render snapshot button when onToggleSnapshots is not provided", () => {
      const editor = createMockEditor();
      const { container } = render(<EditorToolbar editor={editor} />);
      const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;
      expect(within(toolbar).queryByRole("button", { name: /Snapshots/ })).not.toBeInTheDocument();
    });

    it("renders snapshot button with count badge when count > 0", () => {
      const editor = createMockEditor();
      const onToggle = vi.fn();
      const { container } = render(
        <EditorToolbar editor={editor} snapshotCount={5} onToggleSnapshots={onToggle} />,
      );
      const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;
      const btn = within(toolbar).getByRole("button", { name: "Snapshots (5)" });
      expect(btn).toBeInTheDocument();
      // Badge should show count
      expect(btn.querySelector("span")?.textContent).toBe("5");
    });

    it("renders snapshot button without badge when count is 0", () => {
      const editor = createMockEditor();
      const onToggle = vi.fn();
      const { container } = render(
        <EditorToolbar editor={editor} snapshotCount={0} onToggleSnapshots={onToggle} />,
      );
      const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;
      const btn = within(toolbar).getByRole("button", { name: "Snapshots" });
      expect(btn).toBeInTheDocument();
      // No badge span (the only span should be the svg content, not a count badge)
      expect(btn.querySelector("span")).toBeNull();
    });

    it("calls onToggleSnapshots when clicked", () => {
      const editor = createMockEditor();
      const onToggle = vi.fn();
      const { container } = render(
        <EditorToolbar editor={editor} snapshotCount={3} onToggleSnapshots={onToggle} />,
      );
      const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;
      const btn = within(toolbar).getByRole("button", { name: "Snapshots (3)" });
      fireEvent.click(btn);
      expect(onToggle).toHaveBeenCalledOnce();
      // Should NOT trigger editor.chain (it's not a formatting command)
      expect(editor.chain).not.toHaveBeenCalled();
    });
  });
});
