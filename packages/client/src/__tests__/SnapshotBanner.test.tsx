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

  it("marks Restore button aria-disabled when canRestore is false (C1)", () => {
    // EditorPage drives canRestore from editorLockedMessage === null. When
    // a prior possibly_committed/unknown restore raised the lock banner, a
    // second click would issue a double-restore against an almost-certainly-
    // committed snapshot. aria-disabled (NOT the native `disabled`
    // attribute) keeps the button focusable so screen readers can reach
    // the aria-describedby target — a native disabled button is removed
    // from the tab order and the reason would never be announced.
    render(<SnapshotBanner {...defaultProps} canRestore={false} />);
    const restoreBtn = screen.getByRole("button", { name: S.restoreButton });
    // aria-disabled is the accessible signal; the native `disabled`
    // attribute is deliberately absent so the button stays focusable.
    expect(restoreBtn).toHaveAttribute("aria-disabled", "true");
    expect(restoreBtn).not.toHaveAttribute("disabled");
    // The reason is exposed via aria-describedby + a visible hint, NOT
    // via the title attribute — browsers suppress tooltips on disabled
    // buttons and most screen readers do not announce title text.
    expect(restoreBtn).not.toHaveAttribute("title");
    expect(restoreBtn).toHaveAttribute("aria-describedby", "snapshot-actions-disabled-reason");
    const reason = document.getElementById("snapshot-actions-disabled-reason");
    expect(reason).not.toBeNull();
    expect(reason?.textContent).toBe(S.actionsUnavailableWhileLocked);
  });

  it("does not open the confirmation dialog when Restore is clicked while aria-disabled (C1)", async () => {
    const user = userEvent.setup();
    const onRestore = vi.fn();
    render(<SnapshotBanner {...defaultProps} onRestore={onRestore} canRestore={false} />);

    // aria-disabled does not block pointer events — clicks still reach
    // onClick. Guard that the handler's early return blocks both the
    // confirm dialog and onRestore.
    await user.click(screen.getByRole("button", { name: S.restoreButton }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
  });

  it("keeps the aria-disabled Restore button focusable for screen readers (GH review)", () => {
    // Native `disabled` removes a button from the tab order on most
    // browsers, preventing assistive tech from ever announcing its
    // aria-describedby target. aria-disabled preserves focusability so
    // the actionsUnavailableWhileLocked hint is actually reachable.
    render(<SnapshotBanner {...defaultProps} canRestore={false} />);
    const restoreBtn = screen.getByRole("button", { name: S.restoreButton });
    // tabIndex not set to -1 and no `disabled` attr — default tab order.
    expect(restoreBtn).not.toHaveAttribute("disabled");
    expect(restoreBtn.tabIndex).toBe(0);
    restoreBtn.focus();
    expect(document.activeElement).toBe(restoreBtn);
  });

  it("enables Restore button when canRestore is true or omitted (default)", () => {
    render(<SnapshotBanner {...defaultProps} />);
    const restoreBtn = screen.getByRole("button", { name: S.restoreButton });
    // No aria-disabled when usable.
    expect(restoreBtn).not.toHaveAttribute("aria-disabled", "true");
    expect(restoreBtn).not.toHaveAttribute("title");
    // No aria-describedby and no hidden reason span when the button is
    // usable — the hint is only meaningful while the action is blocked.
    expect(restoreBtn).not.toHaveAttribute("aria-describedby");
    expect(document.getElementById("snapshot-actions-disabled-reason")).toBeNull();
  });

  it("marks Back button aria-disabled when canBack is false (S3)", () => {
    // EditorPage drives canBack off editorLockedMessage the same way it
    // drives canRestore. Clicking Back while locked would drop the user
    // into an editor showing pre-restore content while the lock banner
    // warns that "typing would overwrite" — a confusing UI with no clean
    // recovery path other than refresh.
    render(<SnapshotBanner {...defaultProps} canBack={false} />);
    const backBtn = screen.getByRole("button", { name: S.backToEditing });
    expect(backBtn).toHaveAttribute("aria-disabled", "true");
    expect(backBtn).not.toHaveAttribute("disabled");
  });

  it("does not call onBack when Back is clicked while aria-disabled (S3)", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<SnapshotBanner {...defaultProps} onBack={onBack} canBack={false} />);
    await user.click(screen.getByRole("button", { name: S.backToEditing }));
    expect(onBack).not.toHaveBeenCalled();
  });

  it("enables Back button when canBack is true or omitted (default)", () => {
    render(<SnapshotBanner {...defaultProps} />);
    const backBtn = screen.getByRole("button", { name: S.backToEditing });
    expect(backBtn).not.toHaveAttribute("aria-disabled", "true");
  });

  it("renders the shared hint when canBack is false even if canRestore is true (GH review)", () => {
    // Guard against a dangling aria-describedby: the Back button's
    // aria-describedby pointed at the hint's id, but the hint was only
    // rendered when !canRestore. If canBack flipped independently, the
    // Back button's describedby would point at a missing element.
    render(<SnapshotBanner {...defaultProps} canRestore={true} canBack={false} />);
    const backBtn = screen.getByRole("button", { name: S.backToEditing });
    expect(backBtn).toHaveAttribute("aria-describedby", "snapshot-actions-disabled-reason");
    const reason = document.getElementById("snapshot-actions-disabled-reason");
    expect(reason).not.toBeNull();
    expect(reason?.textContent).toBe(S.actionsUnavailableWhileLocked);
  });
});
