import type { RefObject } from "react";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { Logo } from "./Logo";
import { EditorToolbar } from "./EditorToolbar";
import { ViewModeNav } from "./ViewModeNav";
import { STRINGS } from "../strings";
import type { ViewMode } from "../hooks/useKeyboardShortcuts";

// F-1 decomposition (2026-05-29): the EditorPage top bar — logo +
// navigate-home, the inline-editable project title, the formatting
// toolbar (editor view only), the view-mode nav, and the export /
// reference-panel / settings action buttons. Purely presentational:
// every behavior is threaded in as a prop so the EditorPage body keeps
// ownership of the save-pipeline / lock / busy invariants.
interface EditorHeaderProps {
  projectTitle: string;
  onNavigateHome: () => void;

  // Inline project-title editing (useProjectTitleEditing).
  editingProjectTitle: boolean;
  projectTitleDraft: string;
  setProjectTitleDraft: (value: string) => void;
  saveProjectTitle: () => void;
  cancelEditingProjectTitle: () => void;
  startEditingProjectTitle: () => void;
  projectTitleError: string | null;
  projectTitleInputRef: RefObject<HTMLInputElement | null>;

  // Toolbar (shown only in editor view with a ready TipTap instance).
  showActiveEditor: boolean;
  viewMode: ViewMode;
  toolbarEditor: TipTapEditor | null;
  snapshotCount: number | null;
  onToggleSnapshots: () => void;
  onToggleFindReplace: () => void;
  snapshotsTriggerRef: RefObject<HTMLButtonElement | null>;
  findReplaceTriggerRef: RefObject<HTMLButtonElement | null>;

  // Right-hand actions.
  onSwitchToView: (mode: ViewMode) => Promise<boolean>;
  onOpenExport: () => void;
  onToggleReferencePanel: () => void;
  panelOpen: boolean;
  onOpenSettings: () => void;
}

export function EditorHeader({
  projectTitle,
  onNavigateHome,
  editingProjectTitle,
  projectTitleDraft,
  setProjectTitleDraft,
  saveProjectTitle,
  cancelEditingProjectTitle,
  startEditingProjectTitle,
  projectTitleError,
  projectTitleInputRef,
  showActiveEditor,
  viewMode,
  toolbarEditor,
  snapshotCount,
  onToggleSnapshots,
  onToggleFindReplace,
  snapshotsTriggerRef,
  findReplaceTriggerRef,
  onSwitchToView,
  onOpenExport,
  onToggleReferencePanel,
  panelOpen,
  onOpenSettings,
}: EditorHeaderProps) {
  return (
    <header className="border-b border-border/60 px-6 h-12 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-4">
        <button
          onClick={onNavigateHome}
          className="focus:outline-none focus:ring-2 focus:ring-focus-ring rounded-md"
        >
          <Logo />
        </button>
        <span className="text-border" aria-hidden="true">
          /
        </span>
        {editingProjectTitle ? (
          <div className="flex flex-col">
            <input
              ref={projectTitleInputRef}
              value={projectTitleDraft}
              onChange={(e) => setProjectTitleDraft(e.target.value)}
              onBlur={saveProjectTitle}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveProjectTitle();
                if (e.key === "Escape") cancelEditingProjectTitle();
              }}
              className="text-sm font-serif font-semibold text-text-primary bg-transparent border-b-2 border-accent focus:outline-none"
              aria-label={STRINGS.a11y.projectTitleInput}
            />
            {projectTitleError && (
              <span role="alert" className="text-xs text-status-error mt-1">
                {projectTitleError}
              </span>
            )}
          </div>
        ) : (
          <h1
            className="text-sm font-serif font-semibold text-text-primary cursor-pointer hover:text-text-secondary"
            onDoubleClick={startEditingProjectTitle}
            aria-label={projectTitle}
          >
            {projectTitle}
          </h1>
        )}
      </div>
      {showActiveEditor && viewMode === "editor" && toolbarEditor && (
        <EditorToolbar
          editor={toolbarEditor}
          snapshotCount={snapshotCount ?? undefined}
          onToggleSnapshots={onToggleSnapshots}
          onToggleFindReplace={onToggleFindReplace}
          snapshotsTriggerRef={snapshotsTriggerRef}
          findReplaceTriggerRef={findReplaceTriggerRef}
        />
      )}
      <div className="flex items-center gap-2">
        {showActiveEditor && <ViewModeNav viewMode={viewMode} onSwitchToView={onSwitchToView} />}
        <button
          onClick={onOpenExport}
          className="text-sm text-text-muted hover:text-text-secondary rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          {STRINGS.export.buttonLabel}
        </button>
        <button
          type="button"
          onClick={onToggleReferencePanel}
          aria-expanded={panelOpen}
          aria-controls="reference-panel"
          aria-label={STRINGS.referencePanel.toggleTooltip}
          title={STRINGS.referencePanel.toggleTooltip}
          className="p-2 rounded hover:bg-bg-hover text-text-secondary focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="2" y="3" width="20" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
        <button
          onClick={onOpenSettings}
          aria-label={STRINGS.projectSettings.openLabel}
          className="text-sm text-text-muted hover:text-text-secondary rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          &#x2699;
        </button>
      </div>
    </header>
  );
}
