import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportDialog } from "../components/ExportDialog";
import { api } from "../api/client";

vi.mock("../api/client", () => ({
  api: {
    projects: {
      export: vi.fn(),
    },
  },
}));

const mockChapters = [
  { id: "ch-1", title: "Chapter One", sort_order: 0 },
  { id: "ch-2", title: "Chapter Two", sort_order: 1 },
];

describe("ExportDialog", () => {
  const defaultProps = {
    open: true,
    projectSlug: "test-project",
    chapters: mockChapters,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
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
    globalThis.URL.createObjectURL = vi.fn(() => "blob:test-url");
    globalThis.URL.revokeObjectURL = vi.fn();

    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(api.projects.export).toHaveBeenCalledWith("test-project", {
        format: "html",
        include_toc: true,
      });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("shows error message when export fails", async () => {
    const user = userEvent.setup();
    vi.mocked(api.projects.export).mockRejectedValue(new Error("Network error"));

    render(<ExportDialog {...defaultProps} />);
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Export failed. Please try again.");
    });
  });

  it("exports with markdown format when selected", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const mockBlob = new Blob(["# test"], { type: "text/markdown" });
    vi.mocked(api.projects.export).mockResolvedValue(mockBlob);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:test-url");
    globalThis.URL.revokeObjectURL = vi.fn();

    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByLabelText("Markdown"));
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(api.projects.export).toHaveBeenCalledWith("test-project", {
        format: "markdown",
        include_toc: true,
      });
    });
  });

  it("exports without TOC when unchecked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const mockBlob = new Blob(["<html>test</html>"], { type: "text/html" });
    vi.mocked(api.projects.export).mockResolvedValue(mockBlob);
    globalThis.URL.createObjectURL = vi.fn(() => "blob:test-url");
    globalThis.URL.revokeObjectURL = vi.fn();

    render(<ExportDialog {...defaultProps} onClose={onClose} />);
    await user.click(screen.getByLabelText("Include table of contents"));
    await user.click(screen.getByText("Export"));

    await waitFor(() => {
      expect(api.projects.export).toHaveBeenCalledWith("test-project", {
        format: "html",
        include_toc: false,
      });
    });
  });
});
