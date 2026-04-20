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
      status: "created",
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

    it("surfaces createFailed when onBeforeCreate throws (I3 defense-in-depth)", async () => {
      // EditorPage's onBeforeCreate wraps flushSave in try/catch, but the
      // panel provides its own try/catch as a defensive layer — a future
      // caller that forgets the wrap must still surface createFailed
      // rather than producing an unhandled rejection.
      const user = userEvent.setup();
      const throwingOnBeforeCreate = vi.fn().mockRejectedValue(new Error("flushSave threw"));
      render(<SnapshotPanel {...defaultProps} onBeforeCreate={throwingOnBeforeCreate} />);

      await waitFor(() => {
        expect(screen.getByText(S.createButton)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.createButton));
      await user.click(screen.getByText(S.save));

      await waitFor(() => {
        expect(screen.getByText(S.createFailed)).toBeInTheDocument();
      });
      expect(throwingOnBeforeCreate).toHaveBeenCalled();
      // api.snapshots.create must NOT have been called — the throw short-
      // circuited before the POST.
      expect(api.snapshots.create).not.toHaveBeenCalled();
    });

    it("surfaces createFailed when onBeforeCreate returns flush_failed", async () => {
      // I5 (review 2026-04-21): parity with the throw case above. A
      // flush_failed outcome means the pre-save didn't land, so the
      // snapshot about to be taken would capture stale content — surface
      // createFailed so the user doesn't believe the snapshot reflects
      // their current writes.
      const user = userEvent.setup();
      const onBeforeCreate = vi.fn(async () => ({
        ok: false as const,
        reason: "flush_failed" as const,
      }));
      render(<SnapshotPanel {...defaultProps} onBeforeCreate={onBeforeCreate} />);

      await waitFor(() => {
        expect(screen.getByText(S.createButton)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.createButton));
      await user.click(screen.getByText(S.save));

      await waitFor(() => {
        expect(screen.getByText(S.createFailed)).toBeInTheDocument();
      });
      expect(api.snapshots.create).not.toHaveBeenCalled();
    });

    it("suppresses createError when onBeforeCreate returns busy (I5 — review 2026-04-21)", async () => {
      // Before I5: the caller returned false for both busy and
      // flush_failed. The panel stamped createError unconditionally,
      // producing two contradictory banners — the caller's
      // mutationBusy info banner and the panel's "save your unsaved
      // changes" error. The discriminated busy outcome now lets the
      // panel skip its error stamp when the caller has already surfaced
      // its own.
      const user = userEvent.setup();
      const onBeforeCreate = vi.fn(async () => ({
        ok: false as const,
        reason: "busy" as const,
      }));
      render(<SnapshotPanel {...defaultProps} onBeforeCreate={onBeforeCreate} />);

      await waitFor(() => {
        expect(screen.getByText(S.createButton)).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.createButton));
      await user.click(screen.getByText(S.save));

      // No createError banner — the caller owns the user-visible signal.
      expect(screen.queryByText(S.createFailed)).not.toBeInTheDocument();
      // POST was skipped because onBeforeCreate said so.
      expect(api.snapshots.create).not.toHaveBeenCalled();
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
        status: "duplicate",
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

    it("surfaces save_failed view-result with the save-first copy (I3)", async () => {
      const user = userEvent.setup();
      const snap = makeSnapshot({ id: "snap-77", label: "Pre-view" });
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      const onView = vi.fn().mockResolvedValue({ ok: false, reason: "save_failed" });
      render(<SnapshotPanel {...defaultProps} onView={onView} />);

      await waitFor(() => {
        expect(screen.getByText("Pre-view")).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.view));

      await waitFor(() => {
        expect(screen.getByText(S.viewFailedSaveFirst)).toBeInTheDocument();
      });
    });

    it("clears a stale viewError when the panel reopens for a different chapter (I3)", async () => {
      const user = userEvent.setup();
      const snap = makeSnapshot({ id: "snap-77", label: "Pre-view" });
      vi.mocked(api.snapshots.list).mockResolvedValue([snap]);
      const onView = vi.fn().mockResolvedValue({ ok: false, reason: "save_failed" });

      const { rerender } = render(
        <SnapshotPanel {...defaultProps} chapterId="ch-1" onView={onView} />,
      );

      await waitFor(() => {
        expect(screen.getByText("Pre-view")).toBeInTheDocument();
      });

      await user.click(screen.getByText(S.view));

      await waitFor(() => {
        expect(screen.getByText(S.viewFailedSaveFirst)).toBeInTheDocument();
      });

      // Close panel, reopen for a different chapter. The previous
      // view-failure banner must not persist.
      rerender(<SnapshotPanel {...defaultProps} chapterId="ch-1" isOpen={false} onView={onView} />);
      rerender(<SnapshotPanel {...defaultProps} chapterId="ch-2" isOpen={true} onView={onView} />);

      await waitFor(() => {
        expect(screen.queryByText(S.viewFailedSaveFirst)).not.toBeInTheDocument();
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

    it("moves focus to panel on first mount when already open", async () => {
      // The panel is conditionally mounted in EditorPage (only rendered
      // when open), so on first render isOpen is already true. Previously
      // the prevIsOpen ref was seeded from isOpen, defeating the
      // transition guard and leaving focus on <body>.
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        cb(0);
        return 0;
      });
      vi.mocked(api.snapshots.list).mockResolvedValue([]);

      render(<SnapshotPanel {...defaultProps} isOpen={true} />);

      await waitFor(() => {
        const panel = screen.getByRole("complementary", { name: S.ariaLabel });
        expect(panel).toHaveFocus();
      });
    });
  });
});
