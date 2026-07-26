import { useRef, useEffect } from "react";

/**
 * Which edge of the panel the handle sits on. This is the ONLY axis-dependent
 * input — the drag sign and which arrow key grows the panel are both derived
 * from it, so a caller cannot pair `left-0` with the sidebar's sign by mistake.
 *
 * - `"left"`: handle on the panel's left edge, panel extends rightwards
 *   (ReferencePanel, docked right). Dragging LEFT grows it; ArrowLeft grows.
 * - `"right"`: handle on the panel's right edge, panel extends leftwards
 *   (Sidebar, docked left). Dragging RIGHT grows it; ArrowRight grows.
 */
export type ResizeEdge = "left" | "right";

/** Width change per arrow-key press, in px. */
const ARROW_STEP = 10;

interface ResizeSeparatorProps {
  edge: ResizeEdge;
  /** Current width in px — also the `aria-valuenow` the separator reports. */
  value: number;
  min: number;
  max: number;
  /** Accessible name, sourced from STRINGS by the caller (§String externalization). */
  ariaLabel: string;
  onResize: (newWidth: number) => void;
}

/**
 * Keyboard- and pointer-resizable panel separator.
 *
 * I7 (dedup review 2026-07-26): ReferencePanel and Sidebar carried
 * near-verbatim copies of this — same ARIA attribute set, same Tailwind class
 * string, same mousedown closure with its cleanup-ref-and-unmount-effect, same
 * clamp, same ±10 step — differing only in the four values now taken as props.
 * That left two invariants to agree per panel with nothing enforcing it: the
 * handler clamp versus the persisted codec's `numberInRange` bounds, and
 * `aria-valuemin`/`aria-valuemax` versus both. CLAUDE.md makes WCAG 2.1 AA
 * mandatory, so an a11y fix applied to one panel silently left the other
 * non-conformant. The a11y attributes now have a single owner.
 *
 * The min/max passed here MUST be the same constants the panel's
 * usePersistedState codec clamps with (PANEL_MIN/MAX_WIDTH,
 * SIDEBAR_MIN/MAX_WIDTH) — do not inline literals at the call site.
 */
export function ResizeSeparator({
  edge,
  value,
  min,
  max,
  ariaLabel,
  onResize,
}: ResizeSeparatorProps) {
  // Holds the in-flight drag's listener teardown so an unmount mid-drag cannot
  // leave document-level mousemove/mouseup handlers attached.
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  // A handle on the LEFT edge grows the panel as the pointer moves left, so the
  // pointer delta is negated. `growKey` follows the same axis.
  const dragSign = edge === "left" ? -1 : 1;
  const growKey = edge === "left" ? "ArrowLeft" : "ArrowRight";
  const shrinkKey = edge === "left" ? "ArrowRight" : "ArrowLeft";

  const clamp = (width: number) => Math.min(max, Math.max(min, width));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={ariaLabel}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`absolute ${edge === "left" ? "left-0" : "right-0"} top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/20 focus:bg-accent/20 focus:outline-none transition-colors duration-200`}
      onMouseDown={(e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = value;
        function onMouseMove(ev: MouseEvent) {
          onResize(clamp(startWidth + dragSign * (ev.clientX - startX)));
        }
        function onMouseUp() {
          cleanupResize();
        }
        function cleanupResize() {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          resizeCleanupRef.current = null;
        }
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
        resizeCleanupRef.current = cleanupResize;
      }}
      onKeyDown={(e) => {
        if (e.key === growKey) {
          e.preventDefault();
          onResize(clamp(value + ARROW_STEP));
        }
        if (e.key === shrinkKey) {
          e.preventDefault();
          onResize(clamp(value - ARROW_STEP));
        }
      }}
    />
  );
}
