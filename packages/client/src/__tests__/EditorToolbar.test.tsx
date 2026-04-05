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
});
