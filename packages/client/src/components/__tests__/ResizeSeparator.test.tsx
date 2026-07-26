import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResizeSeparator, type ResizeEdge } from "../ResizeSeparator";

// I7 (dedup review 2026-07-26): ReferencePanel and Sidebar carried
// near-verbatim copies of this separator. Their own suites still cover the
// wiring; this file owns the CONTRACT that used to exist twice — the ARIA
// attribute set, the clamp, and the fact that the drag sign and the growing
// arrow key are both derived from `edge` rather than passed independently.
// ReferencePanel and Sidebar are the two live callers of the two edges.

// This suite does not use RTL auto-cleanup (the client config runs without
// vitest globals), so unmount explicitly between cases — same as the sibling
// ReferencePanel / OuttakesPanel suites.
afterEach(() => {
  cleanup();
});

const baseProps = {
  value: 300,
  min: 200,
  max: 400,
  ariaLabel: "Resize",
  onResize: vi.fn(),
};

function renderSeparator(edge: ResizeEdge, overrides: Partial<typeof baseProps> = {}) {
  const onResize = vi.fn();
  render(<ResizeSeparator {...baseProps} edge={edge} onResize={onResize} {...overrides} />);
  return { separator: screen.getByRole("separator"), onResize };
}

describe("ResizeSeparator", () => {
  describe("accessibility contract", () => {
    it.each<ResizeEdge>(["left", "right"])("exposes the full slider ARIA set on %s", (edge) => {
      const { separator } = renderSeparator(edge);
      expect(separator).toHaveAttribute("aria-orientation", "vertical");
      expect(separator).toHaveAttribute("aria-label", "Resize");
      expect(separator).toHaveAttribute("aria-valuenow", "300");
      expect(separator).toHaveAttribute("aria-valuemin", "200");
      expect(separator).toHaveAttribute("aria-valuemax", "400");
      expect(separator).toHaveAttribute("tabindex", "0");
    });

    it.each<ResizeEdge>(["left", "right"])("anchors to the %s edge", (edge) => {
      const { separator } = renderSeparator(edge);
      expect(separator.className).toContain(`${edge}-0`);
    });
  });

  describe("keyboard resizing derives its direction from `edge`", () => {
    // The reference panel is docked right, so ArrowLeft grows it; the sidebar
    // is docked left, so ArrowRight does. Deriving both from one prop is what
    // stops a caller pairing `left-0` with the sidebar's sign.
    it.each<[ResizeEdge, string, number]>([
      ["left", "{ArrowLeft}", 310],
      ["left", "{ArrowRight}", 290],
      ["right", "{ArrowRight}", 310],
      ["right", "{ArrowLeft}", 290],
    ])("edge=%s + %s → %i", async (edge, key, expected) => {
      const { separator, onResize } = renderSeparator(edge);
      separator.focus();
      await userEvent.keyboard(key);
      expect(onResize).toHaveBeenCalledWith(expected);
    });

    it.each<[ResizeEdge, string, number, number]>([
      ["left", "{ArrowLeft}", 400, 400],
      ["left", "{ArrowRight}", 200, 200],
      ["right", "{ArrowRight}", 400, 400],
      ["right", "{ArrowLeft}", 200, 200],
    ])("edge=%s + %s clamps at %i", async (edge, key, value, expected) => {
      const { separator, onResize } = renderSeparator(edge, { value });
      separator.focus();
      await userEvent.keyboard(key);
      expect(onResize).toHaveBeenCalledWith(expected);
    });
  });

  describe("pointer drag", () => {
    it.each<[ResizeEdge, number, number]>([
      // A pointer moving RIGHT by 50px grows a right-edge handle and shrinks a
      // left-edge one — the sign that used to be hand-written per panel.
      ["right", 50, 350],
      ["left", 50, 250],
      ["right", -50, 250],
      ["left", -50, 350],
    ])("edge=%s, dx=%i → %i", (edge, dx, expected) => {
      const { separator, onResize } = renderSeparator(edge);
      fireEvent.mouseDown(separator, { clientX: 100 });
      fireEvent.mouseMove(document, { clientX: 100 + dx });
      expect(onResize).toHaveBeenCalledWith(expected);
      fireEvent.mouseUp(document);
    });

    it("clamps a drag past the bounds", () => {
      const { separator, onResize } = renderSeparator("right");
      fireEvent.mouseDown(separator, { clientX: 100 });
      fireEvent.mouseMove(document, { clientX: 9999 });
      expect(onResize).toHaveBeenLastCalledWith(400);
      fireEvent.mouseMove(document, { clientX: -9999 });
      expect(onResize).toHaveBeenLastCalledWith(200);
      fireEvent.mouseUp(document);
    });

    it("stops resizing after mouseup", () => {
      const { separator, onResize } = renderSeparator("right");
      fireEvent.mouseDown(separator, { clientX: 100 });
      fireEvent.mouseUp(document);
      onResize.mockClear();
      fireEvent.mouseMove(document, { clientX: 200 });
      expect(onResize).not.toHaveBeenCalled();
    });

    it("detaches document listeners when unmounted mid-drag", () => {
      const onResize = vi.fn();
      const { unmount } = render(
        <ResizeSeparator {...baseProps} edge="right" onResize={onResize} />,
      );
      fireEvent.mouseDown(screen.getByRole("separator"), { clientX: 100 });
      unmount();
      onResize.mockClear();
      fireEvent.mouseMove(document, { clientX: 200 });
      expect(onResize).not.toHaveBeenCalled();
    });
  });
});
