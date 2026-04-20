import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SnapshotBanner } from "../components/SnapshotBanner";
import { STRINGS } from "../strings";

afterEach(() => {
  cleanup();
});

const S = STRINGS.snapshots;

const defaultProps = {
  label: "Before rewrite",
  date: "2026-04-15T10:30:00.000Z",
  onRestore: vi.fn(),
  onBack: vi.fn(),
};

describe("SnapshotBanner", () => {
  it("renders the viewing banner text with label and date", () => {
    render(<SnapshotBanner {...defaultProps} />);
    const status = screen.getByRole("status");
    expect(status).toBeInTheDocument();
    expect(status.textContent).toContain("Before rewrite");
  });

  it("renders 'Untitled snapshot' when label is null", () => {
    render(<SnapshotBanner {...defaultProps} label={null} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(S.untitled);
  });

  it("renders Restore and Back to editing buttons", () => {
    render(<SnapshotBanner {...defaultProps} />);
    expect(screen.getByText(S.restoreButton)).toBeInTheDocument();
    expect(screen.getByText(S.backToEditing)).toBeInTheDocument();
  });

  it("calls onBack when Back to editing is clicked", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<SnapshotBanner {...defaultProps} onBack={onBack} />);

    await user.click(screen.getByText(S.backToEditing));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("shows confirmation dialog before restoring", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(<SnapshotBanner {...defaultProps} onRestore={onRestore} />);

    // Click restore — should show dialog, not call onRestore yet
    await user.click(screen.getByText(S.restoreButton));
    expect(onRestore).not.toHaveBeenCalled();

    // Confirmation dialog should appear
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(S.restoreConfirm)).toBeInTheDocument();
  });

  it("calls onRestore when confirmation is accepted", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(<SnapshotBanner {...defaultProps} onRestore={onRestore} />);

    await user.click(screen.getByText(S.restoreButton));

    // Find the confirm button in the dialog (there are two "Restore" buttons now)
    const dialog = screen.getByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", { name: S.restoreButton });
    await user.click(confirmBtn);

    expect(onRestore).toHaveBeenCalledOnce();
  });

  it("does not call onRestore when confirmation is cancelled", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(<SnapshotBanner {...defaultProps} onRestore={onRestore} />);

    await user.click(screen.getByText(S.restoreButton));
    const dialog = screen.getByRole("alertdialog");
    const cancelBtn = within(dialog).getByRole("button", { name: STRINGS.delete.cancelButton });
    await user.click(cancelBtn);

    expect(onRestore).not.toHaveBeenCalled();
    // Dialog should be gone
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("has role=status for screen reader announcement", () => {
    render(<SnapshotBanner {...defaultProps} />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("disables Restore button when canRestore is false (C1)", () => {
    // EditorPage drives canRestore from editorLockedMessage === null. When
    // a prior possibly_committed/unknown restore raised the lock banner, a
    // second click would issue a double-restore against an almost-certainly-
    // committed snapshot. Disabling the button keeps the banner visible (so
    // the user sees which snapshot they were looking at) while blocking the
    // second server round-trip.
    render(<SnapshotBanner {...defaultProps} canRestore={false} />);
    const restoreBtn = screen.getByRole("button", { name: S.restoreButton });
    expect(restoreBtn).toBeDisabled();
    expect(restoreBtn).toHaveAttribute("title", S.restoreUnavailableWhileLocked);
  });

  it("does not open the confirmation dialog when Restore is clicked while disabled (C1)", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(<SnapshotBanner {...defaultProps} onRestore={onRestore} canRestore={false} />);

    // Click the disabled button — userEvent respects disabled and will not
    // fire the click handler. Guard that the dialog never opens AND that
    // onRestore is never called even if a future pointer-events oversight
    // lets a click through.
    await user.click(screen.getByRole("button", { name: S.restoreButton }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("enables Restore button when canRestore is true or omitted (default)", () => {
    render(<SnapshotBanner {...defaultProps} />);
    const restoreBtn = screen.getByRole("button", { name: S.restoreButton });
    expect(restoreBtn).not.toBeDisabled();
    expect(restoreBtn).not.toHaveAttribute("title");
  });
});
