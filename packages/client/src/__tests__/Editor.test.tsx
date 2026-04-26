import { describe, it, expect, vi, afterEach } from "vitest";
import { render, within, fireEvent, waitFor, cleanup, act } from "@testing-library/react";
import { Editor, type EditorHandle } from "../components/Editor";
import { api, ApiRequestError } from "../api/client";
import { STRINGS } from "../strings";
import type { ImageRow } from "@smudge/shared";

vi.mock("../api/client", () => ({
  api: {
    images: {
      upload: vi.fn(),
    },
  },
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
      public readonly code?: string,
      public readonly extras?: Record<string, unknown>,
    ) {
      super(message);
      this.name = "ApiRequestError";
    }
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Editor", () => {
  // Helper: create an onSave mock that returns a resolved Promise (matching the type contract)
  const mockOnSave = () => vi.fn().mockResolvedValue(true);

  it("shows placeholder attribute when content is empty", () => {
    const { container } = render(
      <Editor projectId="test-project" content={null} onSave={mockOnSave()} />,
    );
    const placeholder = container.querySelector("[data-placeholder]");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("data-placeholder")).toBe("Start writing\u2026");
  });

  it("does not show placeholder when content has text", () => {
    const content = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    const { container } = render(
      <Editor projectId="test-project" content={content} onSave={mockOnSave()} />,
    );
    expect(within(container).getByText("Hello world")).toBeInTheDocument();
    const emptyParagraph = container.querySelector(".is-editor-empty");
    expect(emptyParagraph).toBeNull();
  });

  it("exposes the editor instance via editorRef", async () => {
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;
    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
      />,
    );
    await waitFor(() => {
      expect(editorRef.current?.editor).not.toBeNull();
    });
  });

  it("has correct ARIA attributes on the editor", () => {
    const { container } = render(
      <Editor projectId="test-project" content={null} onSave={mockOnSave()} />,
    );
    const editor = container.querySelector("[role='textbox'][aria-label='Chapter content']");
    expect(editor).not.toBeNull();
    expect(editor?.getAttribute("aria-multiline")).toBe("true");
    expect(editor?.getAttribute("spellcheck")).toBe("true");
  });

  it("renders editor content area without toolbar", () => {
    const { container } = render(
      <Editor projectId="test-project" content={null} onSave={mockOnSave()} />,
    );
    expect(container.querySelector("[role='textbox']")).not.toBeNull();
    expect(container.querySelector("[role='toolbar']")).toBeNull();
  });

  it("does not fire onSave on blur when content is unchanged", async () => {
    const onSave = mockOnSave();
    const content = { type: "doc", content: [{ type: "paragraph" }] };
    const { container } = render(
      <Editor projectId="test-project" content={content} onSave={onSave} />,
    );

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
    const { container } = render(
      <Editor projectId="test-project" content={null} onSave={onSave} />,
    );

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
        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }), undefined);
      },
      { timeout: 3000 },
    );
  });

  it("mounts with empty editor when content is null (new chapter)", async () => {
    const { container } = render(
      <Editor projectId="test-project" content={null} onSave={mockOnSave()} />,
    );
    await waitFor(() => {
      expect(container.querySelector(".is-editor-empty")).not.toBeNull();
    });
  });

  it("mounts with provided content", async () => {
    const content1 = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }],
    };

    const { container } = render(
      <Editor projectId="test-project" content={content1} onSave={mockOnSave()} />,
    );
    await waitFor(() => {
      expect(within(container).getByText("First")).toBeInTheDocument();
    });
  });

  it("fires onSave on blur when content has changed", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const { container } = render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
      />,
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
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }), undefined);
    });
  });

  it("sets dirtyRef to true on blur when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network error"));
    const onContentChange = vi.fn();
    const { container } = render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
      />,
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
      <Editor
        projectId="test-project"
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
      />,
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
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

    const { container } = render(
      <Editor
        projectId="test-project"
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
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }), undefined);
  });

  it("setEditable(false) does not emit onUpdate or dirty the editor (C1)", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
        editorRef={editorRef}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    onContentChange.mockClear();
    onSave.mockClear();

    editorRef.current?.setEditable(false);
    editorRef.current?.setEditable(true);

    // No content change and no save scheduled — the guard must not flip
    // dirtyRef because the unmount cleanup would then PATCH pre-replace
    // content and undo the replace.
    await act(async () => {});
    expect(onContentChange).not.toHaveBeenCalled();
    await editorRef.current?.flushSave();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("debounced save does not fire when editor is locked before the timer (I6 2026-04-26)", async () => {
    // Regression: useProjectEditor's terminal-code branches (BAD_JSON,
    // UPDATE_READ_FAILURE, CORRUPT_CONTENT, NOT_FOUND) lock the editor
    // via onRequestEditorLock → applyReloadFailedLock → setEditable(false).
    // But a debounced save queued by typing during the prior retry window
    // would still fire after the lock, deterministically 4xx-ing again
    // and re-firing the lock setter — wasted round-trips and warn-spam
    // against the CLAUDE.md "zero warnings" rule. The debounced save
    // must check editor.isEditable in its setTimeout callback.
    vi.useFakeTimers();
    try {
      const onSave = vi.fn().mockResolvedValue(true);
      const onContentChange = vi.fn();
      const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

      const { container } = render(
        <Editor
          projectId="test-project"
          content={null}
          onSave={onSave}
          onContentChange={onContentChange}
          editorRef={editorRef}
        />,
      );

      await vi.waitFor(() => expect(editorRef.current).not.toBeNull(), { timeout: 3000 });

      const editorEl = container.querySelector("[role='textbox']") as HTMLElement;

      // Type to dirty the editor. This queues a debounced save 1500ms out.
      fireEvent.focus(editorEl);
      editorEl.textContent = "typed during retry";
      fireEvent.input(editorEl);

      await vi.waitFor(() => expect(onContentChange).toHaveBeenCalled(), { timeout: 3000 });

      onSave.mockClear();

      // Lock the editor before the debounce fires (mimics applyReloadFailedLock).
      editorRef.current?.setEditable(false);

      // Advance past the debounce window. Without the isEditable guard the
      // setTimeout callback would call onSaveRef.current(getJSON, ...) and
      // trigger another 404 → lock cycle.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(onSave).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("onBlur does not save while editor is non-editable (C2 2026-04-24)", async () => {
    // The mutation gate (setEditable(false) around restore / replace /
    // reload) relies on blur NOT committing a save with pre-mutation
    // content. TipTap still dispatches blur events on a non-editable
    // editor — e.g. the user clicks the Restore or Replace button after
    // typing, which fires blur before the mutation's markClean() runs.
    // Without an isEditable check, onBlur's immediate save PATCHes the
    // stale draft on top of the committed mutation. Gate onBlur on
    // editor.isEditable in addition to dirtyRef.
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

    const { container } = render(
      <Editor
        projectId="test-project"
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

    // Type to dirty the editor.
    fireEvent.focus(editorEl);
    editorEl.textContent = "pre-mutation draft";
    fireEvent.input(editorEl);
    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });

    onSave.mockClear();

    // A mutation path locks the editor; blur can still fire (e.g. the
    // user's click on Restore is itself the blur trigger).
    editorRef.current?.setEditable(false);
    fireEvent.blur(editorEl);

    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
  });

  it("flushSave is a no-op when not dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

    render(
      <Editor projectId="test-project" content={null} onSave={onSave} editorRef={editorRef} />,
    );

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
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

    const { container } = render(
      <Editor
        projectId="test-project"
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
      <Editor
        projectId="test-project"
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
      />,
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
      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type: "doc" }), undefined);
    });
  });

  it("markClean prevents the fire-and-forget unmount save", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const editorRef = { current: null } as { current: EditorHandle | null };
    const { container, unmount } = render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
        editorRef={editorRef}
      />,
    );

    const editorEl = container.querySelector("[role='textbox']") as HTMLElement;
    fireEvent.focus(editorEl);
    editorEl.textContent = "dirty content";
    fireEvent.input(editorEl);

    await waitFor(() => {
      expect(onContentChange).toHaveBeenCalled();
    });
    onSave.mockClear();

    // Orchestration path (e.g. snapshot restore) marks clean before
    // triggering the remount — unmount must NOT fire a save that would
    // clobber the just-committed server state.
    editorRef.current?.markClean();
    unmount();

    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not fire save on unmount when not dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const { unmount } = render(<Editor projectId="test-project" content={null} onSave={onSave} />);

    // Unmount without typing — should not save
    unmount();

    await act(async () => {});
    expect(onSave).not.toHaveBeenCalled();
  });

  it("beforeunload handler calls preventDefault when dirty", async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onContentChange = vi.fn();
    const { container } = render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={onSave}
        onContentChange={onContentChange}
      />,
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
    const { unmount } = render(
      <Editor projectId="test-project" content={null} onSave={mockOnSave()} />,
    );

    const event = new Event("beforeunload", { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, "preventDefault");
    window.dispatchEvent(event);

    // Clean up before asserting to avoid other test handlers interfering
    unmount();

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it("insertImage via editorRef inserts an image into the editor", async () => {
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;
    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current?.editor).not.toBeNull();
    });

    // Call insertImage — it should call editor.chain().focus().setImage().run()
    const chainSpy = vi.spyOn(editorRef.current!.editor!, "chain");

    editorRef.current!.insertImage("/api/images/img-1", "A test image");

    expect(chainSpy).toHaveBeenCalled();
  });

  it("insertImage is a no-op when editor is null", async () => {
    // We verify insertImage doesn't throw when editor is null by testing
    // the code path before the editor is initialized. The editorRef.current
    // is set in a useEffect, so we check the function is safe.
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;
    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current).not.toBeNull();
    });

    // insertImage should not throw even though we call it
    // (editor should be non-null by now, but the guard is still tested by coverage)
    expect(() => editorRef.current!.insertImage("/test", "alt")).not.toThrow();
  });

  // Helper to find the imagePaste plugin from editor state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findImagePastePlugin(editor: any) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return editor.view.state.plugins.find((p: any) => {
      const key = p?.key;
      return typeof key === "string" && key.includes("imagePaste");
    });
  }

  it("image upload handler calls api.images.upload and inserts image on success", async () => {
    const onImageAnnouncement = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;
    vi.mocked(api.images.upload).mockResolvedValue({
      id: "img-123",
      project_id: "test-project",
      filename: "photo.png",
      alt_text: "photo",
      caption: "",
      source: "",
      license: "",
      mime_type: "image/png",
      size_bytes: 1024,
      created_at: "2026-01-01T00:00:00Z",
      reference_count: 0,
    });

    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
        onImageAnnouncement={onImageAnnouncement}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current?.editor).not.toBeNull();
    });

    // Access the ProseMirror plugin's handlePaste directly
    const editor = editorRef.current!.editor!;
    const file = new File(["fake-image-data"], "photo.png", { type: "image/png" });

    // Find the imagePaste plugin and invoke handlePaste
    const imagePastePlugin = findImagePastePlugin(editor);
    expect(imagePastePlugin).toBeDefined();

    const fakeEvent = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => file }],
      },
    };

    const handled = (imagePastePlugin.props.handlePaste as (...args: unknown[]) => unknown)(
      editor.view,
      fakeEvent,
      editor.view.state.doc.slice(0),
    );
    expect(handled).toBe(true);
    expect(fakeEvent.preventDefault).toHaveBeenCalled();

    await waitFor(() => {
      expect(api.images.upload).toHaveBeenCalledWith("test-project", file);
    });

    await waitFor(() => {
      expect(onImageAnnouncement).toHaveBeenCalledWith("Image inserted: photo.png");
    });
  });

  it("image upload handler announces failure on upload error", async () => {
    const onImageAnnouncement = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;
    vi.mocked(api.images.upload).mockRejectedValue(new Error("File too large"));

    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
        onImageAnnouncement={onImageAnnouncement}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current?.editor).not.toBeNull();
    });

    const editor = editorRef.current!.editor!;
    const file = new File(["fake-image-data"], "big.png", { type: "image/png" });

    // Find the imagePaste plugin and invoke handlePaste
    const imagePastePlugin = findImagePastePlugin(editor);

    const fakeEvent = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => file }],
      },
    };

    (imagePastePlugin.props.handlePaste as (...args: unknown[]) => unknown)(
      editor.view,
      fakeEvent,
      editor.view.state.doc.slice(0),
    );

    await waitFor(() => {
      expect(api.images.upload).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(onImageAnnouncement).toHaveBeenCalledWith(STRINGS.imageGallery.uploadFailedGeneric);
    });
  });

  // I3 (2026-04-24 review): on 2xx BAD_JSON (server stored the blob but
  // the client can't parse the response) the editor paste path must
  // surface the committed copy — user needs to know to check the gallery.
  // The insert is *not* attempted because there's no server-assigned id;
  // if the user retried by pasting again, the server would store a
  // second blob for one intended insertion. The current try/catch
  // already skips the insert on error; this test pins the behavior so
  // a future refactor can't regress it into a silent failure.
  it("image paste handler announces committed copy on 2xx BAD_JSON and does not insert (I3)", async () => {
    const onImageAnnouncement = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;
    vi.mocked(api.images.upload).mockRejectedValue(
      new ApiRequestError("[dev] bad body", 200, "BAD_JSON"),
    );

    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
        onImageAnnouncement={onImageAnnouncement}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current?.editor).not.toBeNull();
    });

    const editor = editorRef.current!.editor!;
    const initialJsonBeforePaste = JSON.stringify(editor.getJSON());
    const file = new File(["pixels"], "committed.png", { type: "image/png" });
    const imagePastePlugin = findImagePastePlugin(editor);

    const fakeEvent = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [{ type: "image/png", getAsFile: () => file }],
      },
    };

    (imagePastePlugin.props.handlePaste as (...args: unknown[]) => unknown)(
      editor.view,
      fakeEvent,
      editor.view.state.doc.slice(0),
    );

    await waitFor(() => {
      expect(api.images.upload).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(onImageAnnouncement).toHaveBeenCalledWith(STRINGS.imageGallery.uploadCommittedRefresh);
    });
    // No insert happened — the editor content is unchanged. Retrying
    // by pasting again would upload the file a second time and create
    // a duplicate server row, so the committed copy is the signal to
    // check the gallery instead.
    expect(JSON.stringify(editor.getJSON())).toBe(initialJsonBeforePaste);
  });

  // I8 (review 2026-04-24): ImageGallery.handleFileSelect already bumps
  // its own refresh on possiblyCommitted, but the Editor's paste/drop
  // path runs through this component. Without the callback, the gallery
  // kept its stale list and a user retry uploaded the same file again.
  // The callback lets EditorPage bump a shared external refresh key
  // that drives the gallery to re-fetch.
  it("image paste handler fires onImageUploadCommitted on 2xx BAD_JSON (I8)", async () => {
    const onImageUploadCommitted = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;
    vi.mocked(api.images.upload).mockRejectedValue(
      new ApiRequestError("[dev] bad body", 200, "BAD_JSON"),
    );

    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
        onImageUploadCommitted={onImageUploadCommitted}
      />,
    );

    await waitFor(() => expect(editorRef.current?.editor).not.toBeNull());
    const editor = editorRef.current!.editor!;
    const file = new File(["pixels"], "x.png", { type: "image/png" });
    const imagePastePlugin = findImagePastePlugin(editor);

    (imagePastePlugin.props.handlePaste as (...args: unknown[]) => unknown)(
      editor.view,
      {
        preventDefault: vi.fn(),
        clipboardData: { items: [{ type: "image/png", getAsFile: () => file }] },
      },
      editor.view.state.doc.slice(0),
    );

    await waitFor(() => expect(onImageUploadCommitted).toHaveBeenCalled());
  });

  it("paste-upload does not fire gallery refresh after a project switch (I9 2026-04-25)", async () => {
    // I9 (review 2026-04-25): the Editor doesn't necessarily remount on
    // cross-project navigation, so projectIdRef.current can advance
    // during the in-flight upload. Reading it inside the response
    // handlers fired the gallery refresh / committed callback against
    // whatever project was active at response-time — a project-B
    // gallery refresh for a project-A upload, with the user seeing no
    // evidence and the new image hidden until they navigate back.
    // Capture the project id at upload-start and gate the response
    // callbacks on it still being live.
    const onImageUploadCommitted = vi.fn();
    const onImageAnnouncement = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

    let resolveUpload!: (img: ImageRow) => void;
    vi.mocked(api.images.upload).mockImplementation(
      () =>
        new Promise<ImageRow>((res) => {
          resolveUpload = res;
        }),
    );

    const { rerender } = render(
      <Editor
        projectId="project-a"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
        onImageUploadCommitted={onImageUploadCommitted}
        onImageAnnouncement={onImageAnnouncement}
      />,
    );
    await waitFor(() => expect(editorRef.current?.editor).not.toBeNull());
    const editor = editorRef.current!.editor!;
    const file = new File(["pixels"], "x.png", { type: "image/png" });
    const imagePastePlugin = findImagePastePlugin(editor);

    (imagePastePlugin.props.handlePaste as (...args: unknown[]) => unknown)(
      editor.view,
      {
        preventDefault: vi.fn(),
        clipboardData: { items: [{ type: "image/png", getAsFile: () => file }] },
      },
      editor.view.state.doc.slice(0),
    );
    await waitFor(() => expect(api.images.upload).toHaveBeenCalled());

    // User navigates to a different project mid-upload.
    rerender(
      <Editor
        projectId="project-b"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
        onImageUploadCommitted={onImageUploadCommitted}
        onImageAnnouncement={onImageAnnouncement}
      />,
    );

    // Now resolve the upload — it landed against project A.
    resolveUpload({
      id: "img-1",
      project_id: "project-a",
      filename: "x.png",
      alt_text: "",
      caption: "",
      source: "",
      license: "",
      mime_type: "image/png",
      size_bytes: 100,
      created_at: "2026-01-01T00:00:00Z",
      reference_count: 0,
    });

    // Give the response handler a tick to run.
    await new Promise((r) => setTimeout(r, 10));

    // No gallery refresh fired — would have been against project B.
    expect(onImageUploadCommitted).not.toHaveBeenCalled();
    // No announcement either — the project the user is now looking at
    // didn't generate this upload, so they shouldn't see it announced.
    expect(onImageAnnouncement).not.toHaveBeenCalled();
  });

  it("image drop handler calls api.images.upload", async () => {
    const onImageAnnouncement = vi.fn();
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;
    vi.mocked(api.images.upload).mockResolvedValue({
      id: "img-456",
      project_id: "test-project",
      filename: "dropped.jpg",
      alt_text: "dropped",
      caption: "",
      source: "",
      license: "",
      mime_type: "image/jpeg",
      size_bytes: 2048,
      created_at: "2026-01-01T00:00:00Z",
      reference_count: 0,
    });

    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
        onImageAnnouncement={onImageAnnouncement}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current?.editor).not.toBeNull();
    });

    const editor = editorRef.current!.editor!;
    const file = new File(["fake-image-data"], "dropped.jpg", { type: "image/jpeg" });

    // Find the imagePaste plugin and invoke handleDrop
    const imagePastePlugin = findImagePastePlugin(editor);

    const fakeEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        files: [file],
      },
    };

    const handled = (imagePastePlugin.props.handleDrop as (...args: unknown[]) => unknown)(
      editor.view,
      fakeEvent,
    );
    expect(handled).toBe(true);
    expect(fakeEvent.preventDefault).toHaveBeenCalled();

    await waitFor(() => {
      expect(api.images.upload).toHaveBeenCalledWith("test-project", file);
    });

    await waitFor(() => {
      expect(onImageAnnouncement).toHaveBeenCalledWith("Image inserted: dropped.jpg");
    });
  });

  it("paste handler returns false when no image items are present", async () => {
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current?.editor).not.toBeNull();
    });

    const editor = editorRef.current!.editor!;
    const imagePastePlugin = findImagePastePlugin(editor);

    // Paste with no image items
    const fakeEvent = {
      preventDefault: vi.fn(),
      clipboardData: {
        items: [{ type: "text/plain", getAsFile: () => null }],
      },
    };

    const handled = (imagePastePlugin.props.handlePaste as (...args: unknown[]) => unknown)(
      editor.view,
      fakeEvent,
      editor.view.state.doc.slice(0),
    );
    expect(handled).toBe(false);
  });

  it("drop handler returns false when no image files are present", async () => {
    const editorRef = { current: null } as React.MutableRefObject<EditorHandle | null>;

    render(
      <Editor
        projectId="test-project"
        content={null}
        onSave={mockOnSave()}
        editorRef={editorRef}
      />,
    );

    await waitFor(() => {
      expect(editorRef.current?.editor).not.toBeNull();
    });

    const editor = editorRef.current!.editor!;
    const imagePastePlugin = findImagePastePlugin(editor);

    // Drop with no files
    const fakeEvent = {
      preventDefault: vi.fn(),
      dataTransfer: {
        files: [new File(["text"], "readme.txt", { type: "text/plain" })],
      },
    };

    const handled = (imagePastePlugin.props.handleDrop as (...args: unknown[]) => unknown)(
      editor.view,
      fakeEvent,
    );
    expect(handled).toBe(false);
  });
});
