import type { ViewMode } from "../hooks/useKeyboardShortcuts";
import { STRINGS } from "../strings";

interface ViewModeNavProps {
  viewMode: ViewMode;
  onSwitchToView: (mode: ViewMode) => Promise<void>;
  onDashboardRefresh: () => void;
}

export function ViewModeNav({ viewMode, onSwitchToView, onDashboardRefresh }: ViewModeNavProps) {
  return (
    <nav
      className="flex gap-0.5 bg-bg-sidebar/60 rounded-lg p-0.5"
      aria-label={STRINGS.a11y.viewModesNav}
    >
      <button
        onClick={() =>
          void onSwitchToView("editor").catch((err) =>
            console.warn("View switch flush failed:", err),
          )
        }
        aria-current={viewMode === "editor" ? "page" : undefined}
        className={`text-sm rounded-md px-3.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring transition-all duration-200 ${
          viewMode === "editor"
            ? "bg-bg-primary text-text-primary font-medium shadow-sm"
            : "text-text-muted hover:text-text-secondary"
        }`}
      >
        {STRINGS.nav.editor}
      </button>
      <button
        onClick={() =>
          void onSwitchToView("preview").catch((err) =>
            console.warn("View switch flush failed:", err),
          )
        }
        aria-current={viewMode === "preview" ? "page" : undefined}
        className={`text-sm rounded-md px-3.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring transition-all duration-200 ${
          viewMode === "preview"
            ? "bg-bg-primary text-text-primary font-medium shadow-sm"
            : "text-text-muted hover:text-text-secondary"
        }`}
      >
        {STRINGS.nav.preview}
      </button>
      <button
        onClick={() =>
          void onSwitchToView("dashboard")
            .then(() => onDashboardRefresh())
            .catch((err) => console.warn("View switch flush failed:", err))
        }
        aria-current={viewMode === "dashboard" ? "page" : undefined}
        className={`text-sm rounded-md px-3.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring transition-all duration-200 ${
          viewMode === "dashboard"
            ? "bg-bg-primary text-text-primary font-medium shadow-sm"
            : "text-text-muted hover:text-text-secondary"
        }`}
      >
        {STRINGS.nav.dashboard}
      </button>
    </nav>
  );
}
