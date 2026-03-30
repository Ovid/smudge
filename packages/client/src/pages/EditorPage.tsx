import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Chapter, ChapterStatusRow } from "@smudge/shared";
import { Editor } from "../components/Editor";
import { Sidebar } from "../components/Sidebar";
import { TrashView } from "../components/TrashView";
import { PreviewMode } from "../components/PreviewMode";
import { DashboardView } from "../components/DashboardView";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { STRINGS } from "../strings";
import { useProjectEditor } from "../hooks/useProjectEditor";
import { api } from "../api/client";

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

  useEffect(() => {
    api.chapterStatuses.list().then(setStatuses).catch(console.error);
  }, []);

  const editorRef = useRef<{ flushSave: () => Promise<void> } | null>(null);

  const handleSelectChapterWithFlush = useCallback(
    async (chapterId: string) => {
      await editorRef.current?.flushSave();
      setTrashOpen(false);
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
    } catch (err) {
      console.error("Failed to restore chapter:", err);
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

      if (ctrl && e.shiftKey && e.key === "P") {
        e.preventDefault();
        editorRef.current?.flushSave();
        setViewMode((prev) => (prev === "preview" ? "editor" : "preview"));
        return;
      }

      if (shortcutHelpOpen && e.key === "Escape") {
        e.preventDefault();
        setShortcutHelpOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleCreateChapter, shortcutHelpOpen]);

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
        <div className="text-center">
          <p className="text-text-primary text-lg mb-4">{STRINGS.error.projectNotFound}</p>
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
      <div className="flex h-screen bg-bg-primary">
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
            statuses={statuses}
            onStatusChange={handleStatusChange}
            width={sidebarWidth}
            onResize={handleSidebarResize}
          />
        )}
        <div className="flex-1 flex flex-col items-center justify-center">
          <p className="text-text-muted mb-4">{STRINGS.project.emptyChapters}</p>
          <button
            onClick={handleCreateChapter}
            className="rounded bg-accent px-4 py-2 text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            {STRINGS.sidebar.addChapter}
          </button>
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
    <div className="flex h-screen bg-bg-primary">
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
          statuses={statuses}
          onStatusChange={handleStatusChange}
          width={sidebarWidth}
          onResize={handleSidebarResize}
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="border-b border-border px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
            >
              {STRINGS.nav.backToProjects}
            </button>
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
                  className="text-lg font-semibold text-text-primary bg-transparent border-b-2 border-accent focus:outline-none"
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
                className="text-lg font-semibold text-text-primary cursor-pointer hover:text-text-secondary"
                onDoubleClick={startEditingProjectTitle}
                aria-label={project.title}
              >
                {project.title}
              </h1>
            )}
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => {
                setViewMode("editor");
              }}
              aria-current={viewMode === "editor" ? "page" : undefined}
              className={`text-sm rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-focus-ring ${
                viewMode === "editor"
                  ? "bg-accent-light text-accent font-medium"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {STRINGS.nav.editor}
            </button>
            <button
              onClick={() => {
                editorRef.current?.flushSave();
                setViewMode("preview");
              }}
              aria-current={viewMode === "preview" ? "page" : undefined}
              className={`text-sm rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-focus-ring ${
                viewMode === "preview"
                  ? "bg-accent-light text-accent font-medium"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {STRINGS.nav.preview}
            </button>
            <button
              onClick={() => {
                setViewMode("dashboard");
              }}
              aria-current={viewMode === "dashboard" ? "page" : undefined}
              className={`text-sm rounded px-3 py-1 focus:outline-none focus:ring-2 focus:ring-focus-ring ${
                viewMode === "dashboard"
                  ? "bg-accent-light text-accent font-medium"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {STRINGS.nav.dashboard}
            </button>
          </div>
        </header>

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
              slug={slug!}
              statuses={statuses}
              onNavigateToChapter={(chapterId) => {
                setViewMode("editor");
                handleSelectChapterWithFlush(chapterId);
              }}
            />
          </main>
        ) : (
          <main className="flex-1 overflow-y-auto px-6 py-8" aria-label={STRINGS.a11y.mainContent}>
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
                className="mx-auto block max-w-[720px] mb-4 text-2xl font-serif text-text-primary bg-transparent border-b-2 border-accent focus:outline-none w-full"
                aria-label={STRINGS.a11y.chapterTitleInput}
              />
            ) : (
              <h2
                className="mx-auto max-w-[720px] mb-4 text-2xl font-serif text-text-primary cursor-pointer hover:text-text-secondary"
                onDoubleClick={startEditingTitle}
                aria-label={activeChapter.title}
              >
                {activeChapter.title}
              </h2>
            )}
            <Editor
              content={activeChapter.content}
              onSave={handleSave}
              onContentChange={handleContentChange}
              editorRef={editorRef}
            />
          </main>
        )}

        <footer
          role="status"
          aria-live="polite"
          className="border-t border-border bg-bg-primary px-6 py-2 flex items-center justify-between text-sm text-text-secondary"
        >
          <div>
            {STRINGS.project.wordCount(chapterWordCount)}
            {project && (
              <span className="ml-3 text-text-muted">
                {STRINGS.project.wordCount(
                  project.chapters.reduce((sum, c) => sum + c.word_count, 0),
                )}{" "}
                {STRINGS.nav.totalSuffix}
              </span>
            )}
          </div>
          <div>
            {saveStatus === "unsaved" && STRINGS.editor.unsaved}
            {saveStatus === "saving" && STRINGS.editor.saving}
            {saveStatus === "saved" && STRINGS.editor.saved}
            {saveStatus === "error" && (
              <span className="text-status-error">{STRINGS.editor.saveFailed}</span>
            )}
            {saveStatus === "idle" && ""}
          </div>
        </footer>
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

      {shortcutHelpOpen && (
        <dialog
          open
          aria-label={STRINGS.shortcuts.dialogTitle}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 m-0 p-0 w-full h-full border-none bg-transparent"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShortcutHelpOpen(false);
          }}
        >
          <div className="rounded bg-bg-primary p-6 shadow-lg max-w-sm w-full mx-auto mt-[20vh]">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              {STRINGS.shortcuts.dialogTitle}
            </h3>
            <dl className="flex flex-col gap-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-secondary">{STRINGS.shortcuts.togglePreview}</dt>
                <dd className="font-mono text-text-muted">Ctrl+Shift+P</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">{STRINGS.shortcuts.newChapter}</dt>
                <dd className="font-mono text-text-muted">Ctrl+Shift+N</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">{STRINGS.shortcuts.toggleSidebar}</dt>
                <dd className="font-mono text-text-muted">Ctrl+Shift+\</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-secondary">{STRINGS.shortcuts.showShortcuts}</dt>
                <dd className="font-mono text-text-muted">Ctrl+/</dd>
              </div>
            </dl>
          </div>
        </dialog>
      )}

    </div>
  );
}
