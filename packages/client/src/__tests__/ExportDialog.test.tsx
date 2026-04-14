import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExportDialog } from "../components/ExportDialog";

vi.mock("../api/client");

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
});
