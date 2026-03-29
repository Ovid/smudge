import { describe, it, expect, vi } from "vitest";
import { render, within } from "@testing-library/react";
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
  });

  it("has correct ARIA attributes on the editor", () => {
    const { container } = render(<Editor content={null} onSave={vi.fn()} />);
    const editor = container.querySelector("[role='textbox'][aria-label='Chapter content']");
    expect(editor).not.toBeNull();
    expect(editor?.getAttribute("aria-multiline")).toBe("true");
    expect(editor?.getAttribute("spellcheck")).toBe("true");
  });
});
