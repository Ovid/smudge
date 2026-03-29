import { describe, it, expect, vi } from "vitest";
import { render, within, fireEvent, waitFor } from "@testing-library/react";
import { Editor } from "../components/Editor";

describe("Editor", () => {
  it("shows placeholder attribute when content is empty", () => {
    const { container } = render(<Editor content={null} onSave={vi.fn()} />);
    const placeholder = container.querySelector("[data-placeholder]");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("data-placeholder")).toBe("Start writing\u2026");
  });

  it("does not show placeholder when content has text", () => {
    const content = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    };
    const { container } = render(<Editor content={content} onSave={vi.fn()} />);
    expect(within(container).getByText("Hello world")).toBeInTheDocument();
    const emptyParagraph = container.querySelector(".is-editor-empty");
    expect(emptyParagraph).toBeNull();
  });

  it("renders formatting toolbar with expected buttons", () => {
    const { container } = render(<Editor content={null} onSave={vi.fn()} />);
    const toolbar = container.querySelector("[role='toolbar'][aria-label='Formatting']");
    expect(toolbar).not.toBeNull();
    const toolbarEl = toolbar as HTMLElement;
    expect(within(toolbarEl).getByRole("button", { name: "Bold" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "Italic" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "H1" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "H2" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "H3" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "Quote" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "List" })).toBeInTheDocument();
    expect(within(toolbarEl).getByRole("button", { name: "Numbered" })).toBeInTheDocument();
  });

  it("has correct ARIA attributes on the editor", () => {
    const { container } = render(<Editor content={null} onSave={vi.fn()} />);
    const editor = container.querySelector("[role='textbox'][aria-label='Chapter content']");
    expect(editor).not.toBeNull();
    expect(editor?.getAttribute("aria-multiline")).toBe("true");
    expect(editor?.getAttribute("spellcheck")).toBe("true");
  });

  it("toolbar buttons are clickable", () => {
    const { container } = render(<Editor content={null} onSave={vi.fn()} />);
    const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;

    // Click each toolbar button — should not throw
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.length).toBe(8);
    for (const button of buttons) {
      fireEvent.click(button);
    }
  });

  it("calls onSave when editor loses focus", async () => {
    const onSave = vi.fn();
    const { container } = render(<Editor content={null} onSave={onSave} />);

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;
    expect(editorEl).not.toBeNull();

    // Focus then blur to trigger onSave
    fireEvent.focus(editorEl);
    fireEvent.blur(editorEl);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }));
    });
  });

  it("syncs content when prop changes", async () => {
    const content1 = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
    };
    const content2 = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Second" }] }],
    };

    const { container, rerender } = render(<Editor content={content1} onSave={vi.fn()} />);
    expect(within(container).getByText("First")).toBeInTheDocument();

    rerender(<Editor content={content2} onSave={vi.fn()} />);
    await waitFor(() => {
      expect(within(container).getByText("Second")).toBeInTheDocument();
    });
  });
});
