import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Chapter, ChapterStatusRow } from "@smudge/shared";
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
import { STRINGS } from "../strings";
import { useProjectEditor } from "../hooks/useProjectEditor";
import { api, type VelocityResponse } from "../api/client";
import { Logo } from "../components/Logo";

const SIDEBAR_DEFAULT_WIDTH = 260;
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_KEY = "smudge:sidebar-width";

function getSavedSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
    if (stored !== null) {
      const parsed = Number(stored);
      if (!Number.isNaN(parsed) && parsed >= SIDEBAR_MIN_WIDTH && parsed <= SIDEBAR_MAX_WIDTH) {
        return parsed;
      }
    }
  } catch {
    // localStorage unavailable
  }
  return SIDEBAR_DEFAULT_WIDTH;
}

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

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const shortcutDialogRef = useRef<HTMLDialogElement>(null);
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const projectTitleInputRef = useRef<HTMLInputElement>(null);
  const projectEscapePressedRef = useRef(false);
  const isSavingTitleRef = useRef(false);
  const isSavingProjectTitleRef = useRef(false);

  const [sidebarWidth, setSidebarWidth] = useState(getSavedSidebarWidth);
  const handleSidebarResize = useCallback((newWidth: number) => {
    setSidebarWidth(newWidth);
    try {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(newWidth));
    } catch {
      // localStorage unavailable
    }
  }, []);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedChapters, setTrashedChapters] = useState<Chapter[]>([]);
  type ViewMode = "editor" | "preview" | "dashboard";
  const [viewMode, setViewMode] = useState<ViewMode>("editor");
  const [statuses, setStatuses] = useState<ChapterStatusRow[]>([]);
  const [navAnnouncement, setNavAnnouncement] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [dashboardRefreshKey, setDashboardRefreshKey] = useState(0);
  const [wordCountAnnouncement, setWordCountAnnouncement] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false);
  const [lastSession, setLastSession] = useState<VelocityResponse["sessions"][0] | null>(null);

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

  // Fetch last session for status bar (on load and after each successful save)
  useEffect(() => {
    if (!slug) return;
    if (saveStatus !== "saved" && saveStatus !== "idle") return;
    let cancelled = false;
    api.projects
      .velocity(slug)
      .then((data) => {
        if (!cancelled && data.sessions.length > 0) {
          const last = data.sessions[data.sessions.length - 1];
          if (last) setLastSession(last);
        }
      })
      .catch(() => {
        // Best-effort
      });
    return () => {
      cancelled = true;
    };
  }, [slug, saveStatus]);

  useEffect(() => {
    const dialog = shortcutDialogRef.current;
    if (!dialog) return;
    if (shortcutHelpOpen) {
      if (!dialog.open) dialog.showModal();
    } else {
      if (dialog.open) dialog.close();
    }
  }, [shortcutHelpOpen]);

  const editorRef = useRef<EditorHandle | null>(null);
  const [toolbarEditor, setToolbarEditor] = useState<TipTapEditor | null>(null);

  const handleStatusChangeWithError = useCallback(
    async (chapterId: string, status: string) => {
      await handleStatusChange(chapterId, status, setActionError);
    },
    [handleStatusChange],
  );

  const handleSelectChapterWithFlush = useCallback(
    async (chapterId: string) => {
      await editorRef.current?.flushSave();
      setTrashOpen(false);
      setViewMode("editor");
      await handleSelectChapter(chapterId);
    },
    [handleSelectChapter],
  );

  async function openTrash() {
    if (!project) return;
    try {
      const trashed = await api.projects.trash(project.slug);
      setTrashedChapters(trashed);
      setTrashOpen(true);
    } catch (err) {
      console.error("Failed to load trash:", err);
      setActionError(err instanceof Error ? err.message : STRINGS.error.loadTrashFailed);
    }
  }

  async function handleRestore(chapterId: string) {
    try {
      const restored = await api.chapters.restore(chapterId);
      setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
      setProject((prev) => {
        if (!prev) return prev;
        const updatedProject = {
          ...prev,
          chapters: [...prev.chapters, restored].sort((a, b) => a.sort_order - b.sort_order),
        };
        // If the restore also restored the parent project with a new slug, update it
        if (restored.project_slug && restored.project_slug !== prev.slug) {
          updatedProject.slug = restored.project_slug;
        }
        return updatedProject;
      });
      // If the slug changed (project was also restored), update the URL
      if (restored.project_slug && restored.project_slug !== slug) {
        navigate(`/projects/${restored.project_slug}`, { replace: true });
      }
    } catch (err) {
      console.error("Failed to restore chapter:", err);
      setActionError(err instanceof Error ? err.message : STRINGS.error.restoreChapterFailed);
    }
  }

  async function confirmDeleteChapter() {
    if (!deleteTarget) return;
    await handleDeleteChapter(deleteTarget);
    setDeleteTarget(null);
    if (trashOpen && project) {
      try {
        const trashed = await api.projects.trash(project.slug);
        setTrashedChapters(trashed);
      } catch {
        // Trash refresh failed — stale list is acceptable
      }
    }
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "/") {
        e.preventDefault();
        setShortcutHelpOpen((prev) => !prev);
        return;
      }

      if (shortcutHelpOpen && e.key === "Escape") {
        e.preventDefault();
        setShortcutHelpOpen(false);
        return;
      }

      // Don't process shortcuts when a dialog is open (focus trap)
      if (shortcutHelpOpen || deleteTarget) return;

      if (ctrl && e.shiftKey && e.key === "N") {
        e.preventDefault();
        handleCreateChapter();
        return;
      }

      if (ctrl && e.shiftKey && e.key === "\\") {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
        return;
      }

      if (ctrl && e.shiftKey && e.key === "W") {
        e.preventDefault();
        // Clear first so re-pressing announces again even if the count hasn't changed
        setWordCountAnnouncement("");
        requestAnimationFrame(() => {
          setWordCountAnnouncement(STRINGS.project.wordCount(chapterWordCount));
        });
        return;
      }

      if (ctrl && e.shiftKey && e.key === "P") {
        e.preventDefault();
        editorRef.current?.flushSave().then(() => {
          setTrashOpen(false);
          setViewMode((prev) => (prev === "preview" ? "editor" : "preview"));
        });
        return;
      }

      if (ctrl && e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
        if (viewMode !== "editor" || !activeChapter || !project) return;
        e.preventDefault();
        const chapters = project.chapters;
        const currentIndex = chapters.findIndex((c) => c.id === activeChapter.id);
        if (currentIndex === -1) return;
        const nextIndex = e.key === "ArrowUp" ? currentIndex - 1 : currentIndex + 1;
        if (nextIndex < 0 || nextIndex >= chapters.length) return;
        const nextChapter = chapters[nextIndex];
        if (!nextChapter) return;
        handleSelectChapterWithFlush(nextChapter.id);
        setNavAnnouncement(STRINGS.sidebar.navigatedToChapter(nextChapter.title));
        setTimeout(() => setNavAnnouncement(""), 1000);
        return;
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    handleCreateChapter,
    shortcutHelpOpen,
    deleteTarget,
    viewMode,
    activeChapter,
    project,
    handleSelectChapterWithFlush,
    chapterWordCount,
  ]);

  function startEditingTitle() {
    if (!activeChapter) return;
    escapePressedRef.current = false;
    setTitleDraft(activeChapter.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.select(), 0);
  }

  async function saveTitle() {
    if (isSavingTitleRef.current) return;
    if (escapePressedRef.current) {
      setEditingTitle(false);
      return;
    }
    if (!activeChapter || !titleDraft.trim()) {
      setEditingTitle(false);
      return;
    }
    isSavingTitleRef.current = true;
    try {
      const trimmed = titleDraft.trim();
      if (trimmed !== activeChapter.title) {
        await handleRenameChapter(activeChapter.id, trimmed);
      }
      setEditingTitle(false);
    } finally {
      isSavingTitleRef.current = false;
    }
  }

  function startEditingProjectTitle() {
    if (!project) return;
    projectEscapePressedRef.current = false;
    setProjectTitleError(null);
    setProjectTitleDraft(project.title);
    setEditingProjectTitle(true);
    setTimeout(() => projectTitleInputRef.current?.select(), 0);
  }

  async function saveProjectTitle() {
    if (isSavingProjectTitleRef.current) return;
    if (projectEscapePressedRef.current) {
      setEditingProjectTitle(false);
      return;
    }
    if (!project || !projectTitleDraft.trim()) {
      setEditingProjectTitle(false);
      return;
    }
    isSavingProjectTitleRef.current = true;
    try {
      const trimmed = projectTitleDraft.trim();
      if (trimmed !== project.title) {
        const newSlug = await handleUpdateProjectTitle(trimmed);
        if (newSlug === undefined) return; // keep edit mode open on failure
        if (newSlug !== slug) {
          navigate(`/projects/${newSlug}`, { replace: true });
        }
      }
      setEditingProjectTitle(false);
    } finally {
      isSavingProjectTitleRef.current = false;
    }
  }

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
                  if (e.key === "Escape") {
                    projectEscapePressedRef.current = true;
                    setEditingProjectTitle(false);
                  }
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
                    if (e.key === "Escape") {
                      escapePressedRef.current = true;
                      setEditingTitle(false);
                    }
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
        onUpdate={() => setDashboardRefreshKey((k) => k + 1)}
      />

      <dialog
        ref={shortcutDialogRef}
        aria-label={STRINGS.shortcuts.dialogTitle}
        className="z-50 rounded-xl bg-bg-primary p-8 shadow-xl max-w-sm w-full border border-border/60 backdrop:bg-black/30"
        onClick={(e) => {
          if (e.target === e.currentTarget) setShortcutHelpOpen(false);
        }}
        onClose={() => setShortcutHelpOpen(false)}
      >
        <h3 className="text-lg font-semibold text-text-primary mb-5">
          {STRINGS.shortcuts.dialogTitle}
        </h3>
        <dl className="flex flex-col gap-2.5 text-sm">
          <div className="flex justify-between items-center">
            <dt className="text-text-secondary">{STRINGS.shortcuts.togglePreview}</dt>
            <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
              Ctrl+Shift+P
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-text-secondary">{STRINGS.shortcuts.newChapter}</dt>
            <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
              Ctrl+Shift+N
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-text-secondary">{STRINGS.shortcuts.toggleSidebar}</dt>
            <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
              Ctrl+Shift+\
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-text-secondary">{STRINGS.shortcuts.prevChapter}</dt>
            <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
              Ctrl+Shift+↑
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-text-secondary">{STRINGS.shortcuts.nextChapter}</dt>
            <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
              Ctrl+Shift+↓
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-text-secondary">{STRINGS.shortcuts.announceWordCount}</dt>
            <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
              Ctrl+Shift+W
            </dd>
          </div>
          <div className="flex justify-between items-center">
            <dt className="text-text-secondary">{STRINGS.shortcuts.showShortcuts}</dt>
            <dd className="font-mono text-xs text-text-muted bg-bg-sidebar px-2 py-0.5 rounded">
              Ctrl+/
            </dd>
          </div>
        </dl>
      </dialog>
    </div>
  );
}
