import type { ComponentProps, RefObject } from "react";
import type { Chapter, ChapterStatusRow, ProjectWithChapters } from "@smudge/shared";
import { Sidebar } from "./Sidebar";
import { TrashView } from "./TrashView";
import { PreviewMode } from "./PreviewMode";
import { DashboardView } from "./DashboardView";
import { ActionErrorBanner } from "./ActionErrorBanner";
import { EditorFooter } from "./EditorFooter";
import { Editor } from "./Editor";
import { ReferencePanel } from "./ReferencePanel";
import { SnapshotPanel } from "./SnapshotPanel";
import { FindReplacePanel } from "./FindReplacePanel";
import { SnapshotBanner } from "./SnapshotBanner";
import { ImageGallery } from "./ImageGallery";
import { STRINGS } from "../strings";
import type { ViewMode } from "../hooks/useKeyboardShortcuts";
import type { useSnapshotState } from "../hooks/useSnapshotState";
import type { useFindReplaceState } from "../hooks/useFindReplaceState";
import type { useSnapshotController } from "../hooks/useSnapshotController";
import type { useFindReplaceController } from "../hooks/useFindReplaceController";
import { renderSnapshotContent } from "../hooks/useSnapshotController";

type FooterProps = ComponentProps<typeof EditorFooter>;
type EditorProps = ComponentProps<typeof Editor>;
type FindReplaceState = ReturnType<typeof useFindReplaceState>;
type FindReplaceController = ReturnType<typeof useFindReplaceController>;
type SnapshotStateReturn = ReturnType<typeof useSnapshotState>;
type SnapshotController = ReturnType<typeof useSnapshotController>;
type SnapshotPanelProps = ComponentProps<typeof SnapshotPanel>;

// F-1 decomposition (2026-05-29): the EditorPage body region — sidebar,
// the lock / action-error / action-info banners, the
// trash|empty|preview|dashboard|editor|snapshot view-switch, the footer,
// and the reference / snapshot / find-replace side panels. Purely
// presentational: the EditorPage body retains all state, the
// save-pipeline / lock / busy invariants, and every handler, threading
// them in here. The three image closures (onImageAnnouncement,
// onImageUploadCommitted, onInsertImage) are pre-built at the call site
// so the timer ref, refresh-key setter, busy guard, and editor handle
// stay owned by the body.
interface EditorMainContentProps {
  // Layout / project.
  sidebarOpen: boolean;
  sidebarWidth: number;
  onSidebarResize: ComponentProps<typeof Sidebar>["onResize"];
  project: ProjectWithChapters;
  activeChapter: Chapter | null;
  showActiveEditor: boolean;
  viewMode: ViewMode;
  statuses: ChapterStatusRow[];

  // Sidebar handlers.
  onSelectChapter: ComponentProps<typeof Sidebar>["onSelectChapter"];
  onAddChapter: () => void;
  onDeleteChapter: ComponentProps<typeof Sidebar>["onDeleteChapter"];
  onReorderChapters: ComponentProps<typeof Sidebar>["onReorderChapters"];
  onRenameChapter: ComponentProps<typeof Sidebar>["onRenameChapter"];
  onOpenTrash: () => void;
  onStatusChange: ComponentProps<typeof Sidebar>["onStatusChange"];

  // Banners.
  editorLockedMessage: string | null;
  actionError: string | null;
  onDismissActionError: () => void;
  actionInfo: string | null;
  onDismissActionInfo: () => void;

  // Trash.
  trashOpen: boolean;
  trashedChapters: ComponentProps<typeof TrashView>["chapters"];
  onRestore: ComponentProps<typeof TrashView>["onRestore"];
  onCloseTrash: () => void;

  // Dashboard.
  dashboardRefreshKey: number;

  // Snapshot view.
  viewingSnapshot: SnapshotStateReturn["viewingSnapshot"];
  onRestoreSnapshot: SnapshotController["handleRestoreSnapshot"];
  onExitSnapshotView: () => void;

  // Inline chapter-title editing.
  editingTitle: boolean;
  titleDraft: string;
  setTitleDraft: (value: string) => void;
  saveTitle: () => void;
  cancelEditingTitle: () => void;
  startEditingTitle: () => void;
  titleError: string | null;
  titleInputRef: RefObject<HTMLInputElement | null>;

  // Editor.
  chapterReloadKey: number;
  editorRef: EditorProps["editorRef"];
  onSave: EditorProps["onSave"];
  onContentChange: EditorProps["onContentChange"];
  onEditorReady: EditorProps["onEditorReady"];
  onImageAnnouncement: (message: string) => void;
  onImageUploadCommitted: () => void;

  // Footer.
  chapterWordCount: FooterProps["chapterWordCount"];
  saveStatus: FooterProps["saveStatus"];
  saveErrorMessage: FooterProps["saveErrorMessage"];
  cacheWarning: FooterProps["cacheWarning"];

  // Reference panel + gallery.
  panelOpen: boolean;
  panelWidth: number;
  onPanelResize: ComponentProps<typeof ReferencePanel>["onResize"];
  activeTabId: ComponentProps<typeof ReferencePanel>["activeTabId"];
  onSelectTab: ComponentProps<typeof ReferencePanel>["onSelectTab"];
  galleryExternalRefreshKey: number;
  onInsertImage: (url: string, alt: string) => void;

  // Snapshot panel.
  snapshotPanelOpen: boolean;
  onCloseSnapshotPanel: () => void;
  snapshotPanelRef: SnapshotStateReturn["snapshotPanelRef"];
  onSnapshotView: SnapshotController["onSnapshotView"];
  onSnapshotBeforeCreate: SnapshotController["onSnapshotBeforeCreate"];
  onSnapshotsChange: SnapshotPanelProps["onSnapshotsChange"];
  snapshotsTriggerRef: RefObject<HTMLButtonElement | null>;

  // Find-and-replace panel.
  findReplace: FindReplaceState;
  onReplaceOne: FindReplaceController["handleReplaceOne"];
  onReplaceAllInChapter: FindReplaceController["handleReplaceAllInChapter"];
  onReplaceAllInManuscript: FindReplaceController["handleReplaceAllInManuscript"];
  findReplaceTriggerRef: RefObject<HTMLButtonElement | null>;
}

export function EditorMainContent({
  sidebarOpen,
  sidebarWidth,
  onSidebarResize,
  project,
  activeChapter,
  showActiveEditor,
  viewMode,
  statuses,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  onReorderChapters,
  onRenameChapter,
  onOpenTrash,
  onStatusChange,
  editorLockedMessage,
  actionError,
  onDismissActionError,
  actionInfo,
  onDismissActionInfo,
  trashOpen,
  trashedChapters,
  onRestore,
  onCloseTrash,
  dashboardRefreshKey,
  viewingSnapshot,
  onRestoreSnapshot,
  onExitSnapshotView,
  editingTitle,
  titleDraft,
  setTitleDraft,
  saveTitle,
  cancelEditingTitle,
  startEditingTitle,
  titleError,
  titleInputRef,
  chapterReloadKey,
  editorRef,
  onSave,
  onContentChange,
  onEditorReady,
  onImageAnnouncement,
  onImageUploadCommitted,
  chapterWordCount,
  saveStatus,
  saveErrorMessage,
  cacheWarning,
  panelOpen,
  panelWidth,
  onPanelResize,
  activeTabId,
  onSelectTab,
  galleryExternalRefreshKey,
  onInsertImage,
  snapshotPanelOpen,
  onCloseSnapshotPanel,
  snapshotPanelRef,
  onSnapshotView,
  onSnapshotBeforeCreate,
  onSnapshotsChange,
  snapshotsTriggerRef,
  findReplace,
  onReplaceOne,
  onReplaceAllInChapter,
  onReplaceAllInManuscript,
  findReplaceTriggerRef,
}: EditorMainContentProps) {
  return (
    <div className="flex flex-1 overflow-hidden">
      {sidebarOpen && (
        <Sidebar
          project={project}
          activeChapterId={activeChapter?.id ?? null}
          onSelectChapter={onSelectChapter}
          onAddChapter={onAddChapter}
          onDeleteChapter={onDeleteChapter}
          onReorderChapters={onReorderChapters}
          onRenameChapter={onRenameChapter}
          onOpenTrash={onOpenTrash}
          statuses={statuses}
          onStatusChange={onStatusChange}
          width={sidebarWidth}
          onResize={onSidebarResize}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        {editorLockedMessage && (
          <div
            role="alert"
            className="px-6 py-2 bg-status-error/8 text-status-error text-sm flex items-center justify-between border-b border-status-error/15"
          >
            <span>{editorLockedMessage}</span>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-4 rounded-md bg-status-error/15 px-2.5 py-1 text-xs font-medium text-status-error hover:bg-status-error/25 focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              {STRINGS.editor.refreshButton}
            </button>
          </div>
        )}
        {actionError && <ActionErrorBanner error={actionError} onDismiss={onDismissActionError} />}
        {actionInfo && (
          <div
            role="status"
            aria-live="polite"
            className="px-6 py-2 bg-accent/10 text-accent text-sm flex items-center justify-between border-b border-accent/20"
          >
            <span>{actionInfo}</span>
            <button
              onClick={onDismissActionInfo}
              className="text-accent hover:text-text-primary text-xs ml-4 focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
              aria-label={STRINGS.a11y.dismissInfo}
            >
              ✕
            </button>
          </div>
        )}

        {trashOpen ? (
          <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
            <TrashView chapters={trashedChapters} onRestore={onRestore} onBack={onCloseTrash} />
          </main>
        ) : !showActiveEditor ? (
          <div className="flex-1 flex flex-col items-center justify-center page-enter">
            <p className="text-text-muted mb-6 text-base">{STRINGS.project.emptyChapters}</p>
            <button
              onClick={onAddChapter}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 focus:ring-offset-bg-primary shadow-sm"
            >
              {STRINGS.sidebar.addChapter}
            </button>
          </div>
        ) : viewMode === "preview" ? (
          <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
            <PreviewMode chapters={project.chapters} onNavigateToChapter={onSelectChapter} />
          </main>
        ) : viewMode === "dashboard" ? (
          <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
            <DashboardView
              slug={project.slug}
              statuses={statuses}
              refreshKey={dashboardRefreshKey}
              onNavigateToChapter={onSelectChapter}
            />
          </main>
        ) : activeChapter ? (
          <main
            className="flex-1 overflow-y-auto flex flex-col"
            aria-label={STRINGS.a11y.mainContent}
          >
            {viewingSnapshot && (
              <SnapshotBanner
                label={viewingSnapshot.label}
                date={viewingSnapshot.created_at}
                onRestore={onRestoreSnapshot}
                onBack={onExitSnapshotView}
                // C1: Disable Restore while the editor-lock banner is
                // showing. The lock is raised on possibly_committed /
                // unknown restore outcomes where the server almost
                // certainly already committed — a second click would
                // re-enter restoreSnapshot and issue a second server
                // restore + second auto-snapshot. Keeping the banner
                // visible (rather than exitSnapshotView()) preserves
                // the "which snapshot was I looking at" context the
                // user needs to decide whether to refresh.
                canRestore={editorLockedMessage === null}
                // S3: Same gate on Back-to-editing. Clicking Back while
                // locked would drop the user into a locked editor showing
                // pre-restore content while the banner says "editing
                // would overwrite" — a confusing state with no clean
                // recovery path that isn't "refresh." Keep the user in
                // snapshot view until they refresh.
                canBack={editorLockedMessage === null}
              />
            )}
            <div className="flex-1 overflow-y-auto px-6 py-8 page-enter">
              {viewingSnapshot ? (
                <div
                  className="mx-auto max-w-[720px] prose prose-lg font-serif text-text-primary prose-headings:text-text-primary prose-a:text-accent"
                  dangerouslySetInnerHTML={{
                    __html: renderSnapshotContent(viewingSnapshot.content),
                  }}
                />
              ) : (
                <>
                  {editingTitle ? (
                    <div className="mx-auto max-w-[720px] mb-6">
                      <input
                        ref={titleInputRef}
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveTitle();
                          if (e.key === "Escape") cancelEditingTitle();
                        }}
                        className="block text-3xl font-serif font-semibold text-text-primary bg-transparent border-b-2 border-accent focus:outline-none w-full tracking-tight"
                        aria-label={STRINGS.a11y.chapterTitleInput}
                      />
                      {titleError && (
                        <p role="alert" className="text-xs text-status-error mt-1">
                          {titleError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <h2
                      className="mx-auto max-w-[720px] mb-6 text-3xl font-serif font-semibold text-text-primary cursor-pointer hover:text-text-secondary tracking-tight"
                      onDoubleClick={startEditingTitle}
                      aria-label={activeChapter.title}
                    >
                      {activeChapter.title}
                    </h2>
                  )}
                  <Editor
                    key={`${activeChapter.id}:${chapterReloadKey}`}
                    chapterId={activeChapter.id}
                    content={activeChapter.content}
                    onSave={onSave}
                    onContentChange={onContentChange}
                    editorRef={editorRef}
                    onEditorReady={onEditorReady}
                    projectId={project.id}
                    onImageAnnouncement={onImageAnnouncement}
                    onImageUploadCommitted={onImageUploadCommitted}
                  />
                </>
              )}
            </div>
          </main>
        ) : null}

        {showActiveEditor && (
          <EditorFooter
            chapterWordCount={chapterWordCount}
            project={project}
            saveStatus={saveStatus}
            saveErrorMessage={saveErrorMessage}
            cacheWarning={cacheWarning}
          />
        )}
      </div>
      {panelOpen && (
        <ReferencePanel
          width={panelWidth}
          onResize={onPanelResize}
          activeTabId={activeTabId}
          onSelectTab={onSelectTab}
          tabs={[
            {
              id: "images",
              label: STRINGS.referencePanel.imagesTab,
              panel: (
                <ImageGallery
                  projectId={project.id}
                  externalRefreshKey={galleryExternalRefreshKey}
                  onInsertImage={onInsertImage}
                  onNavigateToChapter={onSelectChapter}
                />
              ),
            },
          ]}
        />
      )}
      {snapshotPanelOpen && activeChapter && (
        <SnapshotPanel
          ref={snapshotPanelRef}
          chapterId={activeChapter.id}
          isOpen={snapshotPanelOpen}
          onClose={onCloseSnapshotPanel}
          onView={onSnapshotView}
          onBeforeCreate={onSnapshotBeforeCreate}
          onSnapshotsChange={onSnapshotsChange}
          triggerRef={snapshotsTriggerRef}
        />
      )}
      {findReplace.panelOpen && (
        <FindReplacePanel
          isOpen={findReplace.panelOpen}
          onClose={() => findReplace.closePanel()}
          results={findReplace.results}
          loading={findReplace.loading}
          error={findReplace.error}
          query={findReplace.query}
          onQueryChange={findReplace.setQuery}
          replacement={findReplace.replacement}
          onReplacementChange={findReplace.setReplacement}
          options={findReplace.options}
          onToggleOption={findReplace.toggleOption}
          onReplaceOne={onReplaceOne}
          onReplaceAllInChapter={onReplaceAllInChapter}
          onReplaceAllInManuscript={onReplaceAllInManuscript}
          triggerRef={findReplaceTriggerRef}
        />
      )}
    </div>
  );
}
