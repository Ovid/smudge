import { describe, it, expect, vi, afterEach } from "vitest";
import { render, within, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { Editor } from "../components/Editor";

afterEach(() => {
  cleanup();
});

describe("Editor", () => {
  // Helper: create an onSave mock that returns a resolved Promise (matching the type contract)
  const mockOnSave = () => vi.fn().mockResolvedValue(true);

  it("shows placeholder attribute when content is empty", () => {
    const { container } = render(<Editor content={null} onSave={mockOnSave()} />);
    const placeholder = container.querySelector("[data-placeholder]");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("data-placeholder")).toBe("Start writing\u2026");
  });

  it("does not show placeholder when content has text", () => {
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    const { container } = render(<Editor content={content} onSave={mockOnSave()} />);
    expect(within(container).getByText("Hello world")).toBeInTheDocument();
    const emptyParagraph = container.querySelector(".is-editor-empty");
    expect(emptyParagraph).toBeNull();
  });

  it("renders formatting toolbar with expected buttons", () => {
    const { container } = render(<Editor content={null} onSave={mockOnSave()} />);
    const toolbar = container.querySelector("[role='toolbar'][aria-label='Formatting']");
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

  it("has correct ARIA attributes on the editor", () => {
    const { container } = render(<Editor content={null} onSave={mockOnSave()} />);
    const editor = container.querySelector("[role='textbox'][aria-label='Chapter content']");
    expect(editor).not.toBeNull();
    expect(editor?.getAttribute("aria-multiline")).toBe("true");
    expect(editor?.getAttribute("spellcheck")).toBe("true");
  });

  it("toolbar buttons are clickable", () => {
    const { container } = render(<Editor content={null} onSave={mockOnSave()} />);
    const toolbar = container.querySelector("[role='toolbar']") as HTMLElement;

    // Click each toolbar button — should not throw
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.length).toBe(9);
    for (const button of buttons) {
      fireEvent.click(button);
    }
  });

  it("does not fire onSave on blur when content is unchanged", async () => {
    const onSave = mockOnSave();
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    const { container } = render(<Editor content={content} onSave={onSave} />);

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;
    expect(editorEl).not.toBeNull();

    // Focus then blur without typing — should not save
    fireEvent.focus(editorEl);
    fireEvent.blur(editorEl);

    // Flush microtasks to ensure nothing fires
    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
  });

  it("calls onSave after debounce when content changes (auto-save)", async () => {
    const onSave = mockOnSave();
    const { container } = render(<Editor content={null} onSave={onSave} />);

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;
    // Simulate typing by dispatching input
    fireEvent.focus(editorEl);
    editorEl.textContent = "Hello auto-save";
    fireEvent.input(editorEl);

    // Should not have saved immediately
    expect(onSave).not.toHaveBeenCalled();

    // Wait for debounce (1500ms) + buffer
    await waitFor(
      () => {
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }));
      },
      { timeout: 3000 },
    );
  });

  it("clears content when prop changes to null (new chapter)", async () => {
    const content1 = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Existing content" }] }],
    };

    const { container, rerender } = render(<Editor content={content1} onSave={mockOnSave()} />);
    expect(within(container).getByText("Existing content")).toBeInTheDocument();

    rerender(<Editor content={null} onSave={mockOnSave()} />);
    await waitFor(() => {
      expect(container.querySelector(".is-editor-empty")).not.toBeNull();
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

    const { container, rerender } = render(<Editor content={content1} onSave={mockOnSave()} />);
    expect(within(container).getByText("First")).toBeInTheDocument();

    rerender(<Editor content={content2} onSave={mockOnSave()} />);
    await waitFor(() => {
      expect(within(container).getByText("Second")).toBeInTheDocument();
    });
  });

  it("fires onSave on blur when content has changed", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const { container } = render(
      <Editor content={null} onSave={onSave} onContentChange={onContentChange} />,
    );

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;

    // Simulate typing — mutate DOM and wait for TipTap to detect the change
    fireEvent.focus(editorEl);
    editorEl.textContent = "dirty content";
    fireEvent.input(editorEl);

    // Wait for TipTap's onUpdate to fire (which sets dirtyRef = true)
    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });

    // Reset so we can isolate the blur-triggered save
    onSave.mockClear();

    // Blur should trigger immediate save and cancel debounce
    fireEvent.blur(editorEl);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }));
    });
  });

  it("sets dirtyRef to true on blur when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network error"));
    const onContentChange = vi.fn();
    const { container } = render(
      <Editor content={null} onSave={onSave} onContentChange={onContentChange} />,
    );

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;

    // Type to mark dirty
    fireEvent.focus(editorEl);
    editorEl.textContent = "will fail to save";
    fireEvent.input(editorEl);

    // Wait for TipTap to detect the change
    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });

    onSave.mockClear();
    fireEvent.blur(editorEl);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // Flush microtasks so the .catch() handler completes
    await act(async () => {});

    // After rejection, dirtyRef stayed true, so a subsequent blur should still try to save
    onSave.mockClear();
    fireEvent.focus(editorEl);
    fireEvent.blur(editorEl);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
  });

  it("sets dirtyRef to false on blur when onSave resolves true", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const { container } = render(
      <Editor content={null} onSave={onSave} onContentChange={onContentChange} />,
    );

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;

    // Type to mark dirty, then wait for TipTap to detect it
    fireEvent.focus(editorEl);
    editorEl.textContent = "saved content";
    fireEvent.input(editorEl);

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });

    onSave.mockClear();
    fireEvent.blur(editorEl);

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });

    // Flush microtasks so the .then() handler completes and sets dirtyRef = false
    await act(async () => {});

    // Blur again — dirtyRef should be false now, so onSave should NOT be called again
    onSave.mockClear();
    fireEvent.focus(editorEl);
    fireEvent.blur(editorEl);

    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
  });

  it("exposes flushSave via editorRef that calls onSave when dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<{
      flushSave: () => Promise<void>;
    } | null>;

    const { container } = render(
      <Editor
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
        editorRef={editorRef}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;

    // Type to mark dirty and wait for TipTap to detect it
    fireEvent.focus(editorEl);
    editorEl.textContent = "flush me";
    fireEvent.input(editorEl);

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });

    onSave.mockClear();

    // Flush should trigger immediate save
    await editorRef.current?.flushSave();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }));
  });

  it("flushSave is a no-op when not dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const editorRef = { current: null } as React.MutableRefObject<{
      flushSave: () => Promise<void>;
    } | null>;

    render(<Editor content={null} onSave={onSave} editorRef={editorRef} />);

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    // Flush without typing — should resolve without calling onSave
    await editorRef.current?.flushSave();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("flushSave keeps dirtyRef true when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error("save failed")).mockResolvedValue(true);
    const onContentChange = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<{
      flushSave: () => Promise<void>;
    } | null>;

    const { container } = render(
      <Editor
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
        editorRef={editorRef}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;

    // Type to mark dirty and wait for TipTap to detect it
    fireEvent.focus(editorEl);
    editorEl.textContent = "will fail";
    fireEvent.input(editorEl);

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });

    onSave.mockClear();

    // First flush fails — dirtyRef should remain true
    await editorRef.current?.flushSave();
    expect(onSave).toHaveBeenCalledTimes(1);

    // Second flush should still attempt save because dirtyRef is still true
    await editorRef.current?.flushSave();
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it("fires save on unmount when dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const { container, unmount } = render(
      <Editor content={null} onSave={onSave} onContentChange={onContentChange} />,
    );

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;

    // Type to mark dirty and wait for TipTap to detect it
    fireEvent.focus(editorEl);
    editorEl.textContent = "unsaved on unmount";
    fireEvent.input(editorEl);

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });

    onSave.mockClear();

    // Unmount should trigger a fire-and-forget save
    unmount();

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }));
    });
  });

  it("does not fire save on unmount when not dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { unmount } = render(<Editor content={null} onSave={onSave} />);

    // Unmount without typing — should not save
    unmount();

    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
  });

  it("beforeunload handler calls preventDefault when dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const { container } = render(
      <Editor content={null} onSave={onSave} onContentChange={onContentChange} />,
    );

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;

    // Type to mark dirty and wait for TipTap to detect it
    fireEvent.focus(editorEl);
    editorEl.textContent = "unsaved changes";
    fireEvent.input(editorEl);

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });

    // Dispatch a beforeunload event
    const event = new Event("beforeunload", { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it("beforeunload handler does nothing when not dirty", () => {
    const { unmount } = render(<Editor content={null} onSave={mockOnSave()} />);

    const event = new Event("beforeunload", { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    // Clean up before asserting to avoid other test handlers interfering
    unmount();

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });
});
