import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ShortcutHelpDialog } from "../components/ShortcutHelpDialog";

afterEach(cleanup);

describe("ShortcutHelpDialog", () => {
  it("calls showModal when opened", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render(<ShortcutHelpDialog open={true} onClose={vi.fn()} />);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls close when open changes to false", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "close");
    const { rerender } = render(<ShortcutHelpDialog open={true} onClose={vi.fn()} />);
    rerender(<ShortcutHelpDialog open={false} onClose={vi.fn()} />);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("calls onClose when clicking the backdrop", () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<ShortcutHelpDialog open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
