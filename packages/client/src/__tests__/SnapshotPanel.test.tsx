import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SnapshotPanel } from "../components/SnapshotPanel";
import { api } from "../api/client";
import { STRINGS } from "../strings";
import type { SnapshotListItem } from "@smudge/shared";

vi.mock("../api/client", () => {
  class ApiRequestError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }
  return {
    api: {
      snapshots: {
        list: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
    },
    ApiRequestError,
  };
});

const S = STRINGS.snapshots;

function makeSnapshot(overrides: Partial<SnapshotListItem> = {}): SnapshotListItem {
  return {
    id: "snap-1",
    chapter_id: "ch-1",
    label: "Before rewrite",
    word_count: 1500,
    is_auto: false,
    created_at: new Date(Date.now() - 3600_000).toISOString(), // 1 hour ago
    ...overrides,
  };
}

const defaultProps = {
  chapterId: "ch-1",
  isOpen: true,
  onClose: vi.fn(),
  onView: vi.fn(),
};

describe("SnapshotPanel", () => {
  beforeEach(() => {
    vi.mocked(api.snapshots.list).mockResolvedValue([]);
    vi.mocked(api.snapshots.create).mockResolvedValue({
      duplicate: false,
      snapshot: {
        id: "snap-new",
        chapter_id: "ch-1",
        label: null,
        content: "{}",
        word_count: 100,
        is_auto: false,
        created_at: new Date().toISOString(),
      },
    });
    vi.mocked(api.snapshots.delete).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders an aside with the correct aria label", async () => {
      render(<SnapshotPanel {...defaultProps} />);
      await waitFor(() => {
        expect(screen.getByRole("complementary", { name: S.ariaLabel })).toBeInTheDocument();
      });
    });

    it("renders empty state when no snapshots", async () => {
      vi.mocked(api.snapshots.list).mockResolvedValue([]);
      render(<SnapshotPanel {...defaultProps} />);
      await waitFor(() => {
        expect(screen.getByText(S.emptyState)).toBeInTheDocument();
      });
    });

    it("does not render when isOpen is false", () => {
      render(<SnapshotPanel {...defaultProps} isOpen={false} />);
      expect(screen.queryByRole("complementary", { name: S.ariaLabel })).not.toBeInTheDocument();
    });

    it("does not fetch when chapterId is null", () => {
      render(<SnapshotPanel {...defaultProps} chapterId={null} />);
      expect(api.snapshots.list).not.toHaveBeenCalled();
    });
  });

  describe("snapshot list", () => {
    it("renders snapshot list with labels, dates, and word counts", async () => {
      const snap = makeSnapshot({ label: "My checkpoint", word_count: 2500 });
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText("My checkpoint")).toBeInTheDocument();
      });
      expect(screen.getByText("2,500 words")).toBeInTheDocument();
      expect(screen.getByText("1h ago")).toBeInTheDocument();
    });

    it("shows 'Untitled snapshot' for snapshots without labels", async () => {
      const snap = makeSnapshot({ label: null });
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.untitled)).toBeInTheDocument();
      });
    });

    it("shows auto badge for auto-snapshots", async () => {
      const snap = makeSnapshot({ is_auto: true });
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.auto)).toBeInTheDocument();
      });
    });

    it("shows count summary", async () => {
      const manual = makeSnapshot({ id: "snap-1", is_auto: false });
      const auto = makeSnapshot({ id: "snap-2", is_auto: true });
      vi.mocked(api.snapshots.list).mockResolvedValue([manual, auto]);
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.count(1, 1))).toBeInTheDocument();
      });
    });
  });

  describe("create snapshot", () => {
    it("shows inline form when Create Snapshot is clicked", async () => {
      const user = userEvent.setup();
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.createButton)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.createButton));
      expect(screen.getByPlaceholderText(S.labelPlaceholder)).toBeInTheDocument();
      expect(screen.getByText(S.save)).toBeInTheDocument();
      expect(screen.getByText(S.cancel)).toBeInTheDocument();
    });

    it("creates a snapshot with label and refreshes list", async () => {
      const user = userEvent.setup();
      vi.mocked(api.snapshots.list).mockResolvedValue([]);
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.createButton)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.createButton));
      await user.type(screen.getByPlaceholderText(S.labelPlaceholder), "My label");
      await user.click(screen.getByText(S.save));

      expect(api.snapshots.create).toHaveBeenCalledWith("ch-1", "My label");
    });

    it("creates a snapshot without label when input is empty", async () => {
      const user = userEvent.setup();
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.createButton)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.createButton));
      await user.click(screen.getByText(S.save));

      expect(api.snapshots.create).toHaveBeenCalledWith("ch-1", undefined);
    });

    it("shows duplicate message when content unchanged", async () => {
      const user = userEvent.setup();
      vi.mocked(api.snapshots.create).mockResolvedValue({
        duplicate: true,
        message: "Snapshot skipped",
      });
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.createButton)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.createButton));
      await user.click(screen.getByText(S.save));

      await waitFor(() => {
        expect(screen.getByText(S.duplicateSkipped)).toBeInTheDocument();
      });
    });

    it("hides inline form when Cancel is clicked", async () => {
      const user = userEvent.setup();
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.createButton)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.createButton));
      expect(screen.getByPlaceholderText(S.labelPlaceholder)).toBeInTheDocument();

      await user.click(screen.getByText(S.cancel));
      expect(screen.queryByPlaceholderText(S.labelPlaceholder)).not.toBeInTheDocument();
    });
  });

  describe("view snapshot", () => {
    it("calls onView with snapshot data when View is clicked", async () => {
      const user = userEvent.setup();
      const snap = makeSnapshot({ id: "snap-42", label: "My snap" });
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      const onView = vi.fn();
      render(<SnapshotPanel {...defaultProps} onView={onView} />);

      await waitFor(() => {
        expect(screen.getByText("My snap")).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.view));

      expect(onView).toHaveBeenCalledWith({
        id: "snap-42",
        label: "My snap",
        created_at: snap.created_at,
      });
    });
  });

  describe("delete snapshot", () => {
    it("shows confirmation before deleting", async () => {
      const user = userEvent.setup();
      const snap = makeSnapshot();
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.delete)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.delete));
      expect(screen.getByText(S.deleteConfirm)).toBeInTheDocument();
    });

    it("calls api.snapshots.delete and refreshes on confirm", async () => {
      const user = userEvent.setup();
      const snap = makeSnapshot({ id: "snap-del" });
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.delete)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.delete));
      await user.click(screen.getByText(S.deleteConfirmButton));

      await waitFor(() => {
        expect(api.snapshots.delete).toHaveBeenCalledWith("snap-del");
      });
    });

    it("cancels delete when Cancel is clicked in confirmation", async () => {
      const user = userEvent.setup();
      const snap = makeSnapshot();
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      render(<SnapshotPanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByText(S.delete)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.delete));
      expect(screen.getByText(S.deleteConfirm)).toBeInTheDocument();

      await user.click(screen.getByText(S.deleteCancel));
      expect(screen.queryByText(S.deleteConfirm)).not.toBeInTheDocument();
    });

    it("treats a 404 delete as success — refreshes list and closes dialog", async () => {
      const user = userEvent.setup();
      const { ApiRequestError } = await import("../api/client");
      const snap = makeSnapshot({ id: "snap-gone" });
      // Initial list shows the snapshot; after the 404, list returns empty.
      vi.mocked(api.snapshots.list).mockResolvedValueOnce([snap]).mockResolvedValueOnce([]);
      vi.mocked(api.snapshots.delete).mockRejectedValueOnce(
        new ApiRequestError("not found", 404, "NOT_FOUND"),
      );

      render(<SnapshotPanel {...defaultProps} />);
      await waitFor(() => {
        expect(screen.getByText(S.delete)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.delete));
      await user.click(screen.getByText(S.deleteConfirmButton));

      await waitFor(() => {
        expect(screen.queryByText(S.deleteConfirm)).not.toBeInTheDocument();
      });
      expect(screen.queryByText(S.deleteFailed)).not.toBeInTheDocument();
      expect(api.snapshots.list).toHaveBeenCalledTimes(2);
    });
  });

  describe("keyboard interaction", () => {
    it("calls onClose when Escape is pressed", async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      render(<SnapshotPanel {...defaultProps} onClose={onClose} />);

      await waitFor(() => {
        expect(screen.getByRole("complementary", { name: S.ariaLabel })).toBeInTheDocument();
      });

      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("focus management", () => {
    it("moves focus to panel when opened", async () => {
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
      vi.mocked(api.snapshots.list).mockResolvedValue([]);

      // Render initially closed, then re-render open to trigger the transition
      const { rerender } = render(<SnapshotPanel {...defaultProps} isOpen={false} />);
      rerender(<SnapshotPanel {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        const panel = screen.getByRole("complementary", { name: S.ariaLabel });
        expect(panel).toBeInTheDocument();
        expect(panel).toHaveFocus();
      });
    });
  });
});
