import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { StrictMode, useRef } from "react";
import { useDialogLifecycle } from "./useDialogLifecycle";

afterEach(cleanup);

// Harness that always renders the <dialog> (toggle pattern) so close() can fire.
function Harness({
  open,
  onClose,
  withFocus = false,
  block = false,
}: {
  open: boolean;
  onClose: () => void;
  withFocus?: boolean;
  block?: boolean;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, onBackdropClick } = useDialogLifecycle({
    open,
    onClose,
    initialFocusRef: withFocus ? btnRef : undefined,
    blockEscapePropagation: block,
  });
  return (
    <dialog ref={dialogRef} onClick={onBackdropClick} data-testid="dlg">
      {/* eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing) */}
      <div data-testid="card">card</div>
      {/* eslint-disable-next-line no-restricted-syntax -- test fixture (not user-facing) */}
      <button ref={btnRef}>focus-target</button>
    </dialog>
  );
}

// Harness that NEVER renders the <dialog> (null-ref case).
function NullHarness({ open, onClose }: { open: boolean; onClose: () => void }) {
  useDialogLifecycle({ open, onClose });
  return null;
}

describe("useDialogLifecycle", () => {
  it("calls showModal() when open goes false -> true", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { rerender } = render(<Harness open={false} onClose={vi.fn()} />);
    expect(spy).not.toHaveBeenCalled();
    rerender(<Harness open={true} onClose={vi.fn()} />);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("calls close() when open goes true -> false", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "close");
    const { rerender } = render(<Harness open={true} onClose={vi.fn()} />);
    rerender(<Harness open={false} onClose={vi.fn()} />);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("does not throw and does not call showModal when the dialog ref is null", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    expect(() => render(<NullHarness open={true} onClose={vi.fn()} />)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("focuses initialFocusRef on the open transition (including mount-with-open)", () => {
    const { getByText } = render(<Harness open={true} onClose={vi.fn()} withFocus />);
    expect(getByText("focus-target")).toHaveFocus();
  });

  it("does not move focus to the target when initialFocusRef is omitted", () => {
    const { getByText } = render(<Harness open={true} onClose={vi.fn()} />);
    expect(getByText("focus-target")).not.toHaveFocus();
  });

  it("Escape (default/bubble) calls onClose and preventDefaults", () => {
    const onClose = vi.fn();
    render(<Harness open={true} onClose={onClose} />);
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("default Escape does NOT stop other document keydown listeners", () => {
    const onClose = vi.fn();
    const sibling = vi.fn();
    document.addEventListener("keydown", sibling);
    render(<Harness open={true} onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalled();
    expect(sibling).toHaveBeenCalled();
    document.removeEventListener("keydown", sibling);
  });

  it("blockEscapePropagation stops other document keydown listeners (capture + stopImmediatePropagation)", () => {
    const onClose = vi.fn();
    const sibling = vi.fn();
    document.addEventListener("keydown", sibling); // bubble-phase sibling
    render(<Harness open={true} onClose={onClose} block />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sibling).not.toHaveBeenCalled();
    document.removeEventListener("keydown", sibling);
  });

  it("removes the Escape listener when open goes false", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Harness open={true} onClose={onClose} />);
    rerender(<Harness open={false} onClose={onClose} />);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("removes the Escape listener on unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(<Harness open={true} onClose={onClose} />);
    unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handles StrictMode double-invoke: focuses once, showModal not called twice", () => {
    const showSpy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { getByText } = render(
      <StrictMode>
        <Harness open={true} onClose={vi.fn()} withFocus />
      </StrictMode>,
    );
    expect(getByText("focus-target")).toHaveFocus();
    expect(showSpy).toHaveBeenCalledTimes(1);
    showSpy.mockRestore();
  });

  it("re-fires showModal and re-focuses on reopen (false->true->false->true)", () => {
    const showSpy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    const { rerender, getByText } = render(<Harness open={false} onClose={vi.fn()} withFocus />);
    rerender(<Harness open={true} onClose={vi.fn()} withFocus />);
    expect(showSpy).toHaveBeenCalledTimes(1);
    expect(getByText("focus-target")).toHaveFocus();
    getByText("focus-target").blur();
    rerender(<Harness open={false} onClose={vi.fn()} withFocus />);
    rerender(<Harness open={true} onClose={vi.fn()} withFocus />);
    expect(showSpy).toHaveBeenCalledTimes(2);
    expect(getByText("focus-target")).toHaveFocus();
    showSpy.mockRestore();
  });

  it("onBackdropClick calls onClose only when the target is the dialog itself", () => {
    const onClose = vi.fn();
    const { getByTestId } = render(<Harness open={true} onClose={onClose} />);
    fireEvent.click(getByTestId("card")); // child -> ignored
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(getByTestId("dlg")); // dialog itself -> closes
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
