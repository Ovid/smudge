import { useRef } from "react";
import { PANEL_MIN_WIDTH, PANEL_MAX_WIDTH } from "../hooks/useReferencePanelState";
import { STRINGS } from "../strings";
import { ResizeSeparator } from "./ResizeSeparator";

export interface ReferencePanelTab {
  id: string;
  label: string;
  panel: React.ReactNode;
}

interface ReferencePanelProps {
  width: number;
  onResize: (newWidth: number) => void;
  tabs: ReferencePanelTab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
}

// S12 (agentic-review 2026-08-04): the "no roving-tabindex arrow nav until 2+
// tabs warrant APG polish" deferral recorded here has come due — Outtakes made
// this tablist multi-tab for the first time, and 4c.3 adds a Tags tab. The
// markup opts into the WAI-ARIA tabs pattern (role="tablist"/"tab"/"tabpanel",
// aria-selected, aria-controls), and a screen-reader user who knows that pattern
// expects arrow keys to move between tabs and Tab to leave the tablist. aXe has
// no rule for this, so the panel's e2e scan could not have caught it.
//
// Automatic activation (focus selects), which APG recommends when switching
// panels is cheap — both panels are already-loaded client components.
export function ReferencePanel({
  width,
  onResize,
  tabs,
  activeTabId,
  onSelectTab,
}: ReferencePanelProps) {
  // A persisted activeTabId can name a tab that no longer exists (renamed or
  // removed in a later build). Degrade to the first tab so the panel stays
  // non-empty and the tablist keeps a valid selection + aria-labelledby target.
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    // Index of the SELECTED tab, not of the event target: with a roving
    // tabIndex the selected tab is the only focusable one, so they agree —
    // and deriving from selection keeps the unknown-tab fallback above honest.
    const current = tabs.findIndex((t) => t.id === activeTab?.id);
    if (current < 0) return;
    const last = tabs.length - 1;
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = current === last ? 0 : current + 1;
        break;
      case "ArrowLeft":
        next = current === 0 ? last : current - 1;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = last;
        break;
      default:
        return;
    }
    // `current >= 0` above means the list is non-empty, so every branch lands
    // in range — but read it optionally rather than asserting.
    const target = tabs[next];
    if (!target) return;
    // Only after a key we handle: Escape and Ctrl+. must still reach the
    // listeners that close the panel.
    event.preventDefault();
    onSelectTab(target.id);
    tabRefs.current[next]?.focus();
  }

  return (
    <aside
      id="reference-panel"
      aria-label={STRINGS.referencePanel.ariaLabel}
      className="border-l border-border/60 bg-bg-sidebar flex flex-col h-full overflow-hidden relative"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
    >
      <ResizeSeparator
        edge="left"
        value={width}
        min={PANEL_MIN_WIDTH}
        max={PANEL_MAX_WIDTH}
        ariaLabel={STRINGS.referencePanel.resizeHandle}
        onResize={onResize}
      />

      <div
        role="tablist"
        onKeyDown={handleTabKeyDown}
        className="border-b border-border/40 px-4 py-2 flex gap-2"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeTab?.id;
          return (
            <button
              key={tab.id}
              id={`${tab.id}-tab`}
              ref={(el) => {
                tabRefs.current[index] = el;
              }}
              role="tab"
              aria-selected={selected}
              aria-controls={`${tab.id}-tabpanel`}
              // Roving tabIndex: one Tab stop for the whole tablist, arrows move
              // within it. Without this, Tab walked every tab individually —
              // fine as plain buttons, wrong for the pattern the markup claims.
              tabIndex={selected ? 0 : -1}
              onClick={() => onSelectTab(tab.id)}
              className={
                selected
                  ? "text-sm font-medium text-text-primary px-2 py-1 border-b-2 border-accent"
                  : "text-sm font-medium text-text-secondary px-2 py-1 border-b-2 border-transparent hover:text-text-primary"
              }
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div
        id={activeTab && `${activeTab.id}-tabpanel`}
        role="tabpanel"
        aria-labelledby={activeTab && `${activeTab.id}-tab`}
        className="flex-1 overflow-y-auto"
      >
        {activeTab?.panel ?? null}
      </div>
    </aside>
  );
}
