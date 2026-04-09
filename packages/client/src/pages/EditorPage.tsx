import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { ChapterStatusRow } from "@smudge/shared";
import { Editor, type EditorHandle } from "../components/Editor";
import { EditorToolbar } from "../components/EditorToolbar";
import type { Editor as TipTapEditor } from "@tiptap/react";
import { Sidebar } from "../components/Sidebar";
import { TrashView } from "../components/TrashView";
import { PreviewMode } from "../components/PreviewMode";
import { DashboardView } from "../components/DashboardView";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { SettingsDialog } from "../components/SettingsDialog";
import { ProjectSettingsDialog } from "../components/ProjectSettingsDialog";
import { ShortcutHelpDialog } from "../components/ShortcutHelpDialog";
import { STRINGS } from "../strings";
import { useProjectEditor } from "../hooks/useProjectEditor";
import { useSidebarState } from "../hooks/useSidebarState";
import { useChapterTitleEditing } from "../hooks/useChapterTitleEditing";
import { useProjectTitleEditing } from "../hooks/useProjectTitleEditing";
import { useTrashManager } from "../hooks/useTrashManager";
import { useKeyboardShortcuts, type ViewMode } from "../hooks/useKeyboardShortcuts";
import { api, type VelocityResponse } from "../api/client";
import { Logo } from "../components/Logo";

export function EditorPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const {
    project,
    error,
    projectTitleError,
    setProjectTitleError,
    setProject,
    activeChapter,
    saveStatus,
    saveErrorMessage,
    cacheWarning,
    chapterWordCount,
    handleSave,
    handleContentChange,
    handleCreateChapter,
    handleSelectChapter,
    handleDeleteChapter,
    handleReorderChapters,
    handleUpdateProjectTitle,
    handleRenameChapter,
    handleStatusChange,
  } = useProjectEditor(slug);

  const { sidebarWidth, sidebarOpen, handleSidebarResize, toggleSidebar } = useSidebarState();

  const {
    editingTitle,
    titleDraft,
    setTitleDraft,
    titleInputRef,
    startEditingTitle,
    saveTitle,
    cancelEditingTitle,
  } = useChapterTitleEditing(activeChapter, handleRenameChapter);

  const {
    editingProjectTitle,
    projectTitleDraft,
    setProjectTitleDraft,
    projectTitleInputRef,
    startEditingProjectTitle,
    saveProjectTitle,
    cancelEditingProjectTitle,
  } = useProjectTitleEditing(project, slug, handleUpdateProjectTitle, setProjectTitleError, navigate);

  const {
    trashOpen,
    setTrashOpen,
    trashedChapters,
    deleteTarget,
    setDeleteTarget,
    actionError,
    setActionError,
    openTrash,
    handleRestore,
    confirmDeleteChapter,
  } = useTrashManager(project, slug, setProject, handleDeleteChapter, navigate);

  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [statuses, setStatuses] = useState<ChapterStatusRow[]>([]);
  const [navAnnouncement, setNavAnnouncement] = useState("");
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [wordCountAnnouncement, setWordCountAnnouncement] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [lastSession, setLastSession] = useState<VelocityResponse["sessions"][0] | null>(null);

  const editorRef = useRef<EditorHandle | null>(null);
  const [toolbarEditor, setToolbarEditor] = useState<TipTapEditor | null>(null);

  // Fetch chapter statuses with retry
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    function fetchStatuses() {
      api.chapterStatuses
        .list()
        .then((data) => {
          if (!cancelled) setStatuses(data);
        })
        .catch((err) => {
          if (cancelled) return;
          console.error(err);
          if (attempts < 2) {
            attempts++;
            timerId = setTimeout(fetchStatuses, 2000 * attempts);
          }
        });
    }
    fetchStatuses();
    return () => {
      cancelled = true;
      if (timerId !== null) clearTimeout(timerId);
    };
  }, []);

  // Fetch last session for status bar (on load, then throttled after saves)
  const hasFetchedInitial = useRef(false);
  const lastVelocityFetch = useRef(0);
  const VELOCITY_THROTTLE_MS = 60_000;

  // Reset velocity state when navigating between projects
  useEffect(() => {
    hasFetchedInitial.current = false;
    lastVelocityFetch.current = 0;
    setLastSession(null);
  }, [slug]);
  useEffect(() => {
    if (!slug) return;
    const isInitialLoad = !hasFetchedInitial.current;
    if (!isInitialLoad) {
      if (saveStatus !== "saved") return;
      const now = Date.now();
      if (now - lastVelocityFetch.current < VELOCITY_THROTTLE_MS) return;
    }
    hasFetchedInitial.current = true;
    let cancelled = false;
    api.projects
      .velocity(slug)
      .then((data) => {
        if (cancelled) return;
        lastVelocityFetch.current = Date.now();
        if (data.sessions.length > 0) {
          const last = data.sessions[data.sessions.length - 1];
          if (last) setLastSession(last);
        } else {
          setLastSession(null);
        }
      })
      .catch(() => {
        // Best-effort
      });
    return () => {
      cancelled = true;
    };
  }, [slug, saveStatus]);

  const handleStatusChangeWithError = useCallback(
    async (chapterId: string, status: string) => {
      await handleStatusChange(chapterId, status, setActionError);
    },
    [handleStatusChange, setActionError],
  );

  const handleSelectChapterWithFlush = useCallback(
    async (chapterId: string) => {
      await editorRef.current?.flushSave();
      setTrashOpen(false);
      setViewMode("editor");
      await handleSelectChapter(chapterId);
    },
    [handleSelectChapter, setTrashOpen],
  );

  useKeyboardShortcuts({
    shortcutHelpOpen,
    deleteTarget,
    settingsOpen,
    projectSettingsOpen,
    viewMode,
    activeChapter,
    project,
    chapterWordCount,
    editorRef,
    setShortcutHelpOpen,
    toggleSidebar,
    handleCreateChapter,
    handleSelectChapterWithFlush,
    setWordCountAnnouncement,
    setNavAnnouncement,
    setTrashOpen,
    setViewMode,
  });

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <div className="text-center page-enter">
          <p className="text-text-primary text-lg mb-4">{error}</p>
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
            className="text-accent hover:underline"
          >
            {STRINGS.error.backToProjects}
          </a>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <p className="text-text-muted">{STRINGS.nav.loading}</p>
      </div>
    );
  }

  if (!activeChapter && project.chapters.length === 0) {
    return (
      <div className="flex flex-col h-screen bg-bg-primary">
        <header className="border-b border-border/60 px-6 h-12 flex items-center shrink-0">
          <button
            onClick={() => navigate("/")}
            className="focus:outline-none focus:ring-2 focus:ring-focus-ring rounded-md"
          >
            <Logo />
          </button>
          <span className="text-border mx-4" aria-hidden="true">
            /
          </span>
          <span className="text-sm font-serif font-semibold text-text-primary">
            {project.title}
          </span>
        </header>
        <div className="flex flex-1 overflow-hidden">
          {sidebarOpen && (
            <Sidebar
              project={project}
              activeChapterId={null}
              onSelectChapter={handleSelectChapterWithFlush}
              onAddChapter={handleCreateChapter}
              onDeleteChapter={setDeleteTarget}
              onReorderChapters={handleReorderChapters}
              onRenameChapter={handleRenameChapter}
              onOpenTrash={openTrash}
              onOpenSettings={() => setSettingsOpen(true)}
              statuses={statuses}
              onStatusChange={handleStatusChangeWithError}
              width={sidebarWidth}
              onResize={handleSidebarResize}
            />
          )}
          <div className="flex-1 flex flex-col items-center justify-center page-enter">
            <p className="text-text-muted mb-6 text-base">{STRINGS.project.emptyChapters}</p>
            <button
              onClick={handleCreateChapter}
              className="rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring focus:ring-offset-2 focus:ring-offset-bg-primary shadow-sm"
            >
              {STRINGS.sidebar.addChapter}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!activeChapter) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <p className="text-text-muted">{STRINGS.nav.loading}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-bg-primary">
      <header className="border-b border-border/60 px-6 h-12 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/")}
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
              aria-label={project.title}
            >
              {project.title}
            </h1>
          )}
        </div>
        {viewMode === "editor" && toolbarEditor && <EditorToolbar editor={toolbarEditor} />}
        <nav
          className="flex gap-0.5 bg-bg-sidebar/60 rounded-lg p-0.5"
          aria-label={STRINGS.a11y.viewModesNav}
        >
          <button
            onClick={() => {
              setTrashOpen(false);
              setViewMode("editor");
            }}
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
            onClick={async () => {
              await editorRef.current?.flushSave();
              setTrashOpen(false);
              setViewMode("preview");
            }}
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
            onClick={async () => {
              await editorRef.current?.flushSave();
              setTrashOpen(false);
              setViewMode("dashboard");
              setDashboardRefreshKey((k) => k + 1);
            }}
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
        {viewMode === "dashboard" && (
          <button
            onClick={() => setProjectSettingsOpen(true)}
            aria-label={STRINGS.projectSettings.heading}
            className="text-sm text-text-muted hover:text-text-secondary rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            &#x2699;
          </button>
        )}
      </header>

      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            project={project}
            activeChapterId={activeChapter.id}
            onSelectChapter={handleSelectChapterWithFlush}
            onAddChapter={handleCreateChapter}
            onDeleteChapter={setDeleteTarget}
            onReorderChapters={handleReorderChapters}
            onRenameChapter={handleRenameChapter}
            onOpenTrash={openTrash}
            onOpenSettings={() => setSettingsOpen(true)}
            statuses={statuses}
            onStatusChange={handleStatusChangeWithError}
            width={sidebarWidth}
            onResize={handleSidebarResize}
          />
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {actionError && (
            <div
              role="alert"
              className="px-6 py-2 bg-status-error/8 text-status-error text-sm flex items-center justify-between border-b border-status-error/15"
            >
              <span>{actionError}</span>
              <button
                onClick={() => setActionError(null)}
                className="text-status-error hover:text-text-primary text-xs ml-4 focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
                aria-label={STRINGS.a11y.dismissError}
              >
                ✕
              </button>
            </div>
          )}

          {trashOpen ? (
            <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
              <TrashView
                chapters={trashedChapters}
                onRestore={handleRestore}
                onBack={() => setTrashOpen(false)}
              />
            </main>
          ) : viewMode === "preview" ? (
            <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
              <PreviewMode
                chapters={project.chapters}
                onNavigateToChapter={(chapterId) => {
                  setViewMode("editor");
                  handleSelectChapterWithFlush(chapterId);
                }}
              />
            </main>
          ) : viewMode === "dashboard" ? (
            <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
              <DashboardView
                slug={project.slug}
                statuses={statuses}
                refreshKey={dashboardRefreshKey}
                onNavigateToChapter={(chapterId) => {
                  setViewMode("editor");
                  handleSelectChapterWithFlush(chapterId);
                }}
              />
            </main>
          ) : (
            <main
              className="flex-1 overflow-y-auto px-6 py-8 page-enter"
              aria-label={STRINGS.a11y.mainContent}
            >
              {editingTitle ? (
                <input
                  ref={titleInputRef}
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={saveTitle}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") cancelEditingTitle();
                  }}
                  className="mx-auto block max-w-[720px] mb-6 text-3xl font-serif font-semibold text-text-primary bg-transparent border-b-2 border-accent focus:outline-none w-full tracking-tight"
                  aria-label={STRINGS.a11y.chapterTitleInput}
                />
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
                key={activeChapter.id}
                content={activeChapter.content}
                onSave={handleSave}
                onContentChange={handleContentChange}
                editorRef={editorRef}
                onEditorReady={setToolbarEditor}
              />
            </main>
          )}

          <footer className="border-t border-border/40 bg-bg-primary px-6 py-2 flex items-center justify-between text-xs text-text-muted">
            <div className="flex items-center gap-4">
              <span className="font-medium">{STRINGS.project.wordCount(chapterWordCount)}</span>
              {project && (
                <span className="text-text-secondary">
                  {STRINGS.project.wordCount(
                    project.chapters.reduce((sum, c) => sum + c.word_count, 0),
                  )}{" "}
                  {STRINGS.nav.totalSuffix}
                </span>
              )}
            </div>
            {lastSession && (
              <span className="text-text-muted">
                {STRINGS.velocity.lastSession}: {lastSession.duration_minutes} min,{" "}
                {lastSession.net_words >= 0 ? "+" : ""}
                {lastSession.net_words.toLocaleString()} words
              </span>
            )}
            <div role="status" aria-live="polite">
              {saveStatus === "unsaved" && (
                <span className="text-text-muted">{STRINGS.editor.unsaved}</span>
              )}
              {saveStatus === "saving" && (
                <span className="text-text-muted">{STRINGS.editor.saving}</span>
              )}
              {saveStatus === "saved" && (
                <span className="text-status-success">{STRINGS.editor.saved}</span>
              )}
              {saveStatus === "error" && (
                <span className="text-status-error">
                  {saveErrorMessage ?? STRINGS.editor.saveFailed}
                </span>
              )}
              {saveStatus === "idle" && ""}
              {cacheWarning && saveStatus !== "error" && (
                <span className="text-status-warning ml-2">{STRINGS.editor.cacheUnavailable}</span>
              )}
            </div>
          </footer>
        </div>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={STRINGS.delete.confirmTitle(deleteTarget.title)}
          body={STRINGS.delete.confirmBody}
          confirmLabel={STRINGS.delete.confirmButton}
          cancelLabel={STRINGS.delete.cancelButton}
          onConfirm={confirmDeleteChapter}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      <div aria-live="polite" className="sr-only" data-testid="nav-announcement">
        {navAnnouncement}
      </div>
      <div aria-live="polite" className="sr-only" data-testid="word-count-announcement">
        {wordCountAnnouncement}
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      <ProjectSettingsDialog
        key={`${project.slug}-${project.target_word_count}-${project.target_deadline}-${project.completion_threshold}`}
        open={projectSettingsOpen}
        project={project}
        onClose={() => setProjectSettingsOpen(false)}
        onUpdate={() => {
          setDashboardRefreshKey((k) => k + 1);
          // Re-fetch project to update local state with new settings
          if (slug) {
            api.projects
              .get(slug)
              .then((data) => setProject(data))
              .catch(() => {});
          }
        }}
      />

      <ShortcutHelpDialog
        open={shortcutHelpOpen}
        onClose={() => setShortcutHelpOpen(false)}
      />
    </div>
  );
}
