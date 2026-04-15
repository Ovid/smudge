import { useRef, useEffect } from "react";
import { PANEL_MIN_WIDTH, PANEL_MAX_WIDTH } from "../hooks/useReferencePanelState";
import { STRINGS } from "../strings";

interface ReferencePanelProps {
  width: number;
  onResize: (newWidth: number) => void;
  children: React.ReactNode;
}

export function ReferencePanel({ width, onResize, children }: ReferencePanelProps) {
  const resizeCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
    };
  }, []);

  return (
    <aside
      aria-label={STRINGS.referencePanel.ariaLabel}
      className="border-l border-border/60 bg-bg-sidebar flex flex-col h-full overflow-hidden relative"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={STRINGS.referencePanel.resizeHandle}
        aria-valuenow={width}
        aria-valuemin={PANEL_MIN_WIDTH}
        aria-valuemax={PANEL_MAX_WIDTH}
        tabIndex={0}
        className="absolute left-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent/20 focus:bg-accent/20 focus:outline-none transition-colors duration-200"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = width;
          function onMouseMove(ev: MouseEvent) {
            const newWidth = Math.min(
              PANEL_MAX_WIDTH,
              Math.max(PANEL_MIN_WIDTH, startWidth - (ev.clientX - startX)),
            );
            onResize(newWidth);
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
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onResize(Math.min(PANEL_MAX_WIDTH, width + 10));
          }
          if (e.key === "ArrowRight") {
            e.preventDefault();
            onResize(Math.max(PANEL_MIN_WIDTH, width - 10));
          }
        }}
      />

      <div role="tablist" className="border-b border-border/40 px-4 py-2 flex gap-2">
        <button
          role="tab"
          aria-selected={true}
          className="text-sm font-medium text-text-primary px-2 py-1 border-b-2 border-accent"
        >
          {STRINGS.referencePanel.imagesTab}
        </button>
      </div>

      <div role="tabpanel" className="flex-1 overflow-y-auto">
        {children}
      </div>
    </aside>
  );
}
