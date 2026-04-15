import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReferencePanel } from "../components/ReferencePanel";
import { PANEL_MIN_WIDTH, PANEL_MAX_WIDTH } from "../hooks/useReferencePanelState";
import { STRINGS } from "../strings";

describe("ReferencePanel", () => {
  const defaultProps = {
    width: 320,
    onResize: vi.fn(),
    children: <div data-testid="panel-content">Gallery content</div>,
  };

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("rendering", () => {
    it("renders an aside with the correct aria label", () => {
      render(<ReferencePanel {...defaultProps} />);
      const aside = screen.getByRole("complementary", {
        name: STRINGS.referencePanel.ariaLabel,
      });
      expect(aside).toBeInTheDocument();
    });

    it("renders children in the tabpanel", () => {
      render(<ReferencePanel {...defaultProps} />);
      expect(screen.getByTestId("panel-content")).toBeInTheDocument();
      expect(screen.getByText("Gallery content")).toBeInTheDocument();
    });

    it("renders the Images tab", () => {
      render(<ReferencePanel {...defaultProps} />);
      const tab = screen.getByRole("tab", { name: STRINGS.referencePanel.imagesTab });
      expect(tab).toBeInTheDocument();
      expect(tab).toHaveAttribute("aria-selected", "true");
    });

    it("renders a tablist", () => {
      render(<ReferencePanel {...defaultProps} />);
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });

    it("renders a tabpanel", () => {
      render(<ReferencePanel {...defaultProps} />);
      expect(screen.getByRole("tabpanel")).toBeInTheDocument();
    });

    it("applies the width from props as inline style", () => {
      render(<ReferencePanel {...defaultProps} width={400} />);
      const aside = screen.getByRole("complementary");
      expect(aside).toHaveStyle({ width: "400px", minWidth: "400px" });
    });
  });

  describe("resize handle", () => {
    it("renders a resize separator with correct ARIA attributes", () => {
      render(<ReferencePanel {...defaultProps} />);
      const separator = screen.getByRole("separator");
      expect(separator).toHaveAttribute("aria-orientation", "vertical");
      expect(separator).toHaveAttribute("aria-label", STRINGS.referencePanel.resizeHandle);
      expect(separator).toHaveAttribute("aria-valuenow", "320");
      expect(separator).toHaveAttribute("aria-valuemin", String(PANEL_MIN_WIDTH));
      expect(separator).toHaveAttribute("aria-valuemax", String(PANEL_MAX_WIDTH));
      expect(separator).toHaveAttribute("tabindex", "0");
    });

    it("reflects current width in aria-valuenow", () => {
      render(<ReferencePanel {...defaultProps} width={400} />);
      const separator = screen.getByRole("separator");
      expect(separator).toHaveAttribute("aria-valuenow", "400");
    });
  });

  describe("keyboard resizing", () => {
    it("increases width on ArrowLeft", async () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      separator.focus();
      await userEvent.keyboard("{ArrowLeft}");

      expect(onResize).toHaveBeenCalledWith(330); // 320 + 10
    });

    it("decreases width on ArrowRight", async () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      separator.focus();
      await userEvent.keyboard("{ArrowRight}");

      expect(onResize).toHaveBeenCalledWith(310); // 320 - 10
    });

    it("clamps ArrowLeft to PANEL_MAX_WIDTH", async () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} width={PANEL_MAX_WIDTH} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      separator.focus();
      await userEvent.keyboard("{ArrowLeft}");

      expect(onResize).toHaveBeenCalledWith(PANEL_MAX_WIDTH);
    });

    it("clamps ArrowRight to PANEL_MIN_WIDTH", async () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} width={PANEL_MIN_WIDTH} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      separator.focus();
      await userEvent.keyboard("{ArrowRight}");

      expect(onResize).toHaveBeenCalledWith(PANEL_MIN_WIDTH);
    });

    it("does not call onResize for non-arrow keys", async () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      separator.focus();
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard("{ArrowUp}");
      await userEvent.keyboard("{ArrowDown}");
      await userEvent.keyboard("a");

      expect(onResize).not.toHaveBeenCalled();
    });
  });

  describe("mouse resizing", () => {
    it("calls onResize during mouse drag", () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} width={320} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      // Simulate mousedown at x=500
      fireEvent.mouseDown(separator, { clientX: 500 });

      // Drag left by 50px (moving mouse left increases width since panel is on right)
      fireEvent.mouseMove(document, { clientX: 450 });

      // Width should be startWidth - (newX - startX) = 320 - (450 - 500) = 320 + 50 = 370
      expect(onResize).toHaveBeenCalledWith(370);
    });

    it("clamps drag to PANEL_MAX_WIDTH", () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} width={320} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      fireEvent.mouseDown(separator, { clientX: 500 });
      // Drag far left to exceed max
      fireEvent.mouseMove(document, { clientX: 0 });

      // startWidth - (0 - 500) = 320 + 500 = 820, clamped to PANEL_MAX_WIDTH
      expect(onResize).toHaveBeenCalledWith(PANEL_MAX_WIDTH);
    });

    it("clamps drag to PANEL_MIN_WIDTH", () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} width={320} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      fireEvent.mouseDown(separator, { clientX: 500 });
      // Drag far right to go below min
      fireEvent.mouseMove(document, { clientX: 1000 });

      // startWidth - (1000 - 500) = 320 - 500 = -180, clamped to PANEL_MIN_WIDTH
      expect(onResize).toHaveBeenCalledWith(PANEL_MIN_WIDTH);
    });

    it("stops resizing on mouseup", () => {
      const onResize = vi.fn();
      render(<ReferencePanel {...defaultProps} width={320} onResize={onResize} />);
      const separator = screen.getByRole("separator");

      fireEvent.mouseDown(separator, { clientX: 500 });
      fireEvent.mouseMove(document, { clientX: 450 });
      expect(onResize).toHaveBeenCalledTimes(1);

      // Release mouse
      fireEvent.mouseUp(document);
      onResize.mockClear();

      // Further mouse moves should not trigger onResize
      fireEvent.mouseMove(document, { clientX: 400 });
      expect(onResize).not.toHaveBeenCalled();
    });

    it("cleans up event listeners on unmount during active drag", () => {
      const onResize = vi.fn();
      const { unmount } = render(
        <ReferencePanel {...defaultProps} width={320} onResize={onResize} />,
      );
      const separator = screen.getByRole("separator");

      // Start a drag
      fireEvent.mouseDown(separator, { clientX: 500 });
      fireEvent.mouseMove(document, { clientX: 450 });
      expect(onResize).toHaveBeenCalledTimes(1);
      onResize.mockClear();

      // Unmount during drag
      unmount();

      // Further mouse moves should not trigger onResize
      fireEvent.mouseMove(document, { clientX: 400 });
      expect(onResize).not.toHaveBeenCalled();
    });

    it("prevents default on mousedown to avoid text selection", () => {
      render(<ReferencePanel {...defaultProps} />);
      const separator = screen.getByRole("separator");

      const event = new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        clientX: 500,
      });
      const preventDefaultSpy = vi.spyOn(event, "preventDefault");

      separator.dispatchEvent(event);
      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });
});
