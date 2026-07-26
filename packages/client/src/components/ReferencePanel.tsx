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

// ponytail: native-button tabs, no roving-tabindex arrow nav until 2+ tabs
// warrant APG polish. Each <button role="tab"> is Tab-focusable and
// Enter/Space-activatable, satisfying WCAG 2.1.1.
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

      <div role="tablist" className="border-b border-border/40 px-4 py-2 flex gap-2">
        {tabs.map((tab) => {
          const selected = tab.id === activeTab?.id;
          return (
            <button
              key={tab.id}
              id={`${tab.id}-tab`}
              role="tab"
              aria-selected={selected}
              aria-controls={`${tab.id}-tabpanel`}
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
