import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportDialog } from "../components/ExportDialog";
import { api, ApiRequestError } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    projects: {
      export: vi.fn(),
    },
    images: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      message: string,
      public readonly status: number,
    ) {
      super(message);
      this.name = "ApiRequestError";
    }
  },
}));

const mockChapters = [
  { id: "ch-1", title: "Chapter One", sort_order: 0 },
  { id: "ch-2", title: "Chapter Two", sort_order: 1 },
];

describe("ExportDialog", () => {
  const defaultProps = {
    open: true,
    projectId: "proj-1",
    projectSlug: "test-project",
    chapters: mockChapters,
    onClose: vi.fn(),
  };

  // Save originals (may be undefined in happy-dom); fall back to no-ops
  // so the component's 100ms setTimeout for revokeObjectURL doesn't crash
  // if it fires after afterEach restores the originals.
  const originalCreateObjectURL = globalThis.URL.createObjectURL ?? (() => "blob:noop");
  const originalRevokeObjectURL = globalThis.URL.revokeObjectURL ?? (() => {});

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:test-url");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    globalThis.URL.createObjectURL = originalCreateObjectURL;
    globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("renders format options", () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByLabelText("HTML")).toBeInTheDocument();
    expect(screen.getByLabelText("Markdown")).toBeInTheDocument();
    expect(screen.getByLabelText("Plain Text")).toBeInTheDocument();
  });

  it("renders TOC checkbox checked by default", () => {
    render(<ExportDialog {...defaultProps} />);
    const checkbox = screen.getByLabelText("Include table of contents");
    expect(checkbox).toBeChecked();
  });

  it("defaults to all chapters selected", () => {
    render(<ExportDialog {...defaultProps} />);
    expect(screen.getByText("Select specific chapters...")).toBeInTheDocument();
  });

  it("shows chapter checklist when clicking select specific", async () => {
    const user = userEvent.setup();
    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByText("Select specific chapters..."));
    expect(screen.getByLabelText("Chapter One")).toBeInTheDocument();
    expect(screen.getByLabelText("Chapter Two")).toBeInTheDocument();
  });

  it("does not render when open is false", () => {
    render(<ExportDialog {...defaultProps} open={false} />);
    expect(screen.queryByText("Export Manuscript")).not.toBeInTheDocument();
  });

  it("calls onClose when cancel is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("preserves user selections when chapters prop reference changes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ExportDialog {...defaultProps} />);

    // Change format to markdown
    await user.click(screen.getByLabelText("Markdown"));
    expect(screen.getByLabelText("Markdown")).toBeChecked();

    // Rerender with a new chapters array reference (same data, new object)
    const newChapters = [...mockChapters.map((ch) => ({ ...ch }))];
    rerender(<ExportDialog {...defaultProps} chapters={newChapters} />);

    // Format should still be markdown, not reset to html
    expect(screen.getByLabelText("Markdown")).toBeChecked();
  });

  it("toggles a chapter off when unchecked", async () => {
    const user = userEvent.setup();
    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByText("Select specific chapters..."));
    const chapterOneCheckbox = screen.getByLabelText("Chapter One");
    expect(chapterOneCheckbox).toBeChecked();
    await user.click(chapterOneCheckbox);
    expect(chapterOneCheckbox).not.toBeChecked();
  });

  it("exports successfully and calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const mockBlob = new Blob(["<html>test</html>"], { type: "text/html" });
    vi.mocked(api.projects.export).mockResolvedValue(mockBlob);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(api.projects.export).toHaveBeenCalledWith(
        "test-project",
        { format: "html", include_toc: true },
        expect.any(AbortSignal),
      );
      expect(onClose).toHaveBeenCalled();
    });
    clickSpy.mockRestore();
  });

  it("shows generic error message for non-API errors", async () => {
    const user = userEvent.setup();
    vi.mocked(api.projects.export).mockRejectedValue(new Error("Network error"));

    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Export failed. Please try again.");
    });
  });

  it("shows specific server error message for ApiRequestError", async () => {
    const user = userEvent.setup();
    vi.mocked(api.projects.export).mockRejectedValue(
      new ApiRequestError("One or more chapter IDs do not belong to this project.", 400),
    );

    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "One or more chapter IDs do not belong to this project.",
      );
    });
  });

  it("exports with markdown format when selected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const mockBlob = new Blob(["# test"], { type: "text/markdown" });
    vi.mocked(api.projects.export).mockResolvedValue(mockBlob);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByLabelText("Markdown"));
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(api.projects.export).toHaveBeenCalledWith(
        "test-project",
        { format: "markdown", include_toc: true },
        expect.any(AbortSignal),
      );
    });
    clickSpy.mockRestore();
  });

  it("calls onClose when Escape key is pressed", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("shows aria-busy and loading text while export is in flight", async () => {
    const user = userEvent.setup();
    let resolveExport!: (blob: Blob) => void;
    vi.mocked(api.projects.export).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveExport = resolve;
        }),
    );
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportDialog {...defaultProps} />);
    const exportButton = screen.getByRole("button", { name: "Export" });
    expect(exportButton).not.toHaveAttribute("aria-busy", "true");

    await user.click(exportButton);

    await waitFor(
      () => {
        const btn = screen.getByRole("button", { name: "Exporting..." });
        expect(btn).toHaveAttribute("aria-busy", "true");
        expect(btn).toBeDisabled();
      },
      { timeout: 3000 },
    );

    // Resolve the export to clean up
    resolveExport(new Blob(["test"]));
    await waitFor(
      () => {
        expect(defaultProps.onClose).toHaveBeenCalled();
      },
      { timeout: 3000 },
    );
    clickSpy.mockRestore();
  });

  it("exports without TOC when unchecked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const mockBlob = new Blob(["<html>test</html>"], { type: "text/html" });
    vi.mocked(api.projects.export).mockResolvedValue(mockBlob);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByLabelText("Include table of contents"));
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(api.projects.export).toHaveBeenCalledWith(
        "test-project",
        { format: "html", include_toc: false },
        expect.any(AbortSignal),
      );
    });
    clickSpy.mockRestore();
  });

  it("shows cover image selector when epub format is selected and images exist", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.list).mockResolvedValue([
      {
        id: "img-1",
        project_id: "proj-1",
        filename: "cover.jpg",
        alt_text: "Cover",
        caption: "",
        source: "",
        license: "",
        mime_type: "image/jpeg",
        size_bytes: 5000,
        created_at: "2026-01-01T00:00:00Z",
        reference_count: 0,
      },
      {
        id: "img-2",
        project_id: "proj-1",
        filename: "back.png",
        alt_text: "Back",
        caption: "",
        source: "",
        license: "",
        mime_type: "image/png",
        size_bytes: 3000,
        created_at: "2026-01-02T00:00:00Z",
        reference_count: 0,
      },
    ]);

    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByLabelText("EPUB"));

    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalledWith("proj-1");
    });

    await waitFor(() => {
      expect(screen.getByText("Cover image")).toBeInTheDocument();
    });

    // Verify the select has the None option and the two images
    const select = screen.getByRole("combobox");
    expect(select).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("cover.jpg")).toBeInTheDocument();
    expect(screen.getByText("back.png")).toBeInTheDocument();
  });

  it("does not show cover image selector when epub images list is empty", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.list).mockResolvedValue([]);

    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByLabelText("EPUB"));

    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalledWith("proj-1");
    });

    // Give it a tick to settle
    await act(async () => {});
    expect(screen.queryByText("Cover image")).not.toBeInTheDocument();
  });

  it("does not show cover image selector when images.list fails", async () => {
    const user = userEvent.setup();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(api.images.list).mockRejectedValue(new Error("Network error"));

    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByLabelText("EPUB"));

    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalledWith("proj-1");
    });

    await act(async () => {});
    expect(screen.queryByText("Cover image")).not.toBeInTheDocument();

    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("includes epub_cover_image_id in export when cover image is selected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const mockBlob = new Blob(["epub-data"], { type: "application/epub+zip" });
    vi.mocked(api.projects.export).mockResolvedValue(mockBlob);
    vi.mocked(api.images.list).mockResolvedValue([
      {
        id: "img-cover",
        project_id: "proj-1",
        filename: "cover.jpg",
        alt_text: "Cover",
        caption: "",
        source: "",
        license: "",
        mime_type: "image/jpeg",
        size_bytes: 5000,
        created_at: "2026-01-01T00:00:00Z",
        reference_count: 0,
      },
    ]);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByLabelText("EPUB"));

    // Wait for the cover image select to appear
    await waitFor(() => {
      expect(screen.getByText("cover.jpg")).toBeInTheDocument();
    });

    // Select the cover image
    await user.selectOptions(screen.getByRole("combobox"), "img-cover");

    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(api.projects.export).toHaveBeenCalledWith(
        "test-project",
        {
          format: "epub",
          include_toc: true,
          epub_cover_image_id: "img-cover",
        },
        expect.any(AbortSignal),
      );
    });
    clickSpy.mockRestore();
  });

  it("shows WebP warning when DOCX format is selected and WebP images exist", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.list).mockResolvedValue([
      {
        id: "img-webp",
        project_id: "proj-1",
        filename: "photo.webp",
        alt_text: "",
        caption: "",
        source: "",
        license: "",
        mime_type: "image/webp",
        size_bytes: 5000,
        created_at: "2026-01-01T00:00:00Z",
        reference_count: 0,
      },
    ]);

    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByLabelText("Word (.docx)"));

    await waitFor(() => {
      expect(
        screen.getByText(/WebP format, which may not display in Word 2016/),
      ).toBeInTheDocument();
    });
  });

  it("does not show WebP warning for DOCX when no WebP images exist", async () => {
    const user = userEvent.setup();
    vi.mocked(api.images.list).mockResolvedValue([
      {
        id: "img-png",
        project_id: "proj-1",
        filename: "photo.png",
        alt_text: "",
        caption: "",
        source: "",
        license: "",
        mime_type: "image/png",
        size_bytes: 5000,
        created_at: "2026-01-01T00:00:00Z",
        reference_count: 0,
      },
    ]);

    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByLabelText("Word (.docx)"));

    await waitFor(() => {
      expect(api.images.list).toHaveBeenCalledWith("proj-1");
    });

    expect(
      screen.queryByText(/WebP format, which may not display in Word 2016/),
    ).not.toBeInTheDocument();
  });

  it("toggles a chapter back on after toggling it off", async () => {
    const user = userEvent.setup();
    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByText("Select specific chapters..."));

    const chapterOneCheckbox = screen.getByLabelText("Chapter One");
    expect(chapterOneCheckbox).toBeChecked();

    // Toggle off
    await user.click(chapterOneCheckbox);
    expect(chapterOneCheckbox).not.toBeChecked();

    // Toggle back on
    await user.click(chapterOneCheckbox);
    expect(chapterOneCheckbox).toBeChecked();
  });

  it("disables export button when selecting chapters and none are selected", async () => {
    const user = userEvent.setup();
    render(
      <ExportDialog
        {...defaultProps}
        chapters={[{ id: "ch-1", title: "Only Chapter", sort_order: 0 }]}
      />,
    );
    await user.click(screen.getByText("Select specific chapters..."));

    // Uncheck the only chapter
    await user.click(screen.getByLabelText("Only Chapter"));

    const exportButton = screen.getByRole("button", { name: "Export" });
    expect(exportButton).toBeDisabled();
  });

  it("resets state when dialog reopens", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ExportDialog {...defaultProps} />);

    // Change format to markdown
    await user.click(screen.getByLabelText("Markdown"));
    expect(screen.getByLabelText("Markdown")).toBeChecked();

    // Close dialog
    rerender(<ExportDialog {...defaultProps} open={false} />);

    // Reopen dialog
    rerender(<ExportDialog {...defaultProps} open={true} />);

    // Format should be reset to HTML
    expect(screen.getByLabelText("HTML")).toBeChecked();
  });

  it("exports with selected chapters only", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const mockBlob = new Blob(["<html>test</html>"], { type: "text/html" });
    vi.mocked(api.projects.export).mockResolvedValue(mockBlob);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    render(<ExportDialog {...defaultProps} onClose={onClose} />);

    // Switch to specific chapter selection
    await user.click(screen.getByText("Select specific chapters..."));

    // Uncheck Chapter Two
    await user.click(screen.getByLabelText("Chapter Two"));

    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(api.projects.export).toHaveBeenCalledWith(
        "test-project",
        {
          format: "html",
          include_toc: true,
          chapter_ids: ["ch-1"],
        },
        expect.any(AbortSignal),
      );
    });
    clickSpy.mockRestore();
  });

  it("calls onClose when clicking backdrop", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ExportDialog {...defaultProps} onClose={onClose} />);

    // Click directly on the dialog element (backdrop)
    const dialog = screen.getByRole("dialog");
    await user.click(dialog);

    expect(onClose).toHaveBeenCalled();
  });
});
