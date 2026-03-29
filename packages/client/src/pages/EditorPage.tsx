import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { Chapter } from "@smudge/shared";
import { Editor } from "../components/Editor";
import { Sidebar } from "../components/Sidebar";
import { TrashView } from "../components/TrashView";
import { PreviewMode } from "../components/PreviewMode";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { STRINGS } from "../strings";
import { useProjectEditor } from "../hooks/useProjectEditor";
import { api } from "../api/client";

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const {
    project,
    error,
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
  } = useProjectEditor(projectId);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const projectTitleInputRef = useRef<HTMLInputElement>(null);
  const projectEscapePressedRef = useRef(false);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Chapter | null>(null);
  const [trashOpen, setTrashOpen] = useState(false);
  const [trashedChapters, setTrashedChapters] = useState<Chapter[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  const editorRef = useRef<{ flushSave: () => void } | null>(null);

  const handleSelectChapterWithFlush = useCallback(
    async (chapterId: string) => {
      editorRef.current?.flushSave();
      setTrashOpen(false);
      await handleSelectChapter(chapterId);
    },
    [handleSelectChapter],
  );

  async function openTrash() {
    if (!projectId) return;
    try {
      const trashed = await api.projects.trash(projectId);
      setTrashedChapters(trashed);
      setTrashOpen(true);
    } catch {
      // Silently fail — trash view just won't open
    }
  }

  async function handleRestore(chapterId: string) {
    try {
      const restored = await api.chapters.restore(chapterId);
      setTrashedChapters((prev) => prev.filter((c) => c.id !== chapterId));
      setProject((prev) =>
        prev
          ? {
              ...prev,
              chapters: [...prev.chapters, restored].sort((a, b) => a.sort_order - b.sort_order),
            }
          : prev,
      );
    } catch {
      // Silently fail — chapter stays in trash list
    }
  }

  async function confirmDeleteChapter() {
    if (!deleteTarget) return;
    await handleDeleteChapter(deleteTarget);
    setDeleteTarget(null);
    if (trashOpen && projectId) {
      const trashed = await api.projects.trash(projectId);
      setTrashedChapters(trashed);
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
        setPreviewOpen((prev) => !prev);
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
    if (escapePressedRef.current) {
      setEditingTitle(false);
      return;
    }
    if (!activeChapter || !titleDraft.trim()) {
      setEditingTitle(false);
      return;
    }
    const trimmed = titleDraft.trim();
    if (trimmed !== activeChapter.title) {
      await handleRenameChapter(activeChapter.id, trimmed);
    }
    setEditingTitle(false);
  }

  function startEditingProjectTitle() {
    if (!project) return;
    projectEscapePressedRef.current = false;
    setProjectTitleDraft(project.title);
    setEditingProjectTitle(true);
    setTimeout(() => projectTitleInputRef.current?.select(), 0);
  }

  async function saveProjectTitle() {
    if (projectEscapePressedRef.current) {
      setEditingProjectTitle(false);
      return;
    }
    if (!project || !projectTitleDraft.trim()) {
      setEditingProjectTitle(false);
      return;
    }
    const trimmed = projectTitleDraft.trim();
    if (trimmed !== project.title) {
      await handleUpdateProjectTitle(trimmed);
    }
    setEditingProjectTitle(false);
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
        <p className="text-text-muted">Loading...</p>
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
        <p className="text-text-muted">Loading...</p>
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
        />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="border-b border-border px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate("/")}
              className="text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
            >
              &larr; Projects
            </button>
            {editingProjectTitle ? (
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
                aria-label="Project title"
              />
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
          <button
            onClick={() => setPreviewOpen(true)}
            className="text-sm text-text-secondary hover:text-text-primary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded px-2 py-1"
          >
            Preview
          </button>
        </header>

        {trashOpen ? (
          <main className="flex-1 overflow-y-auto" aria-label={STRINGS.a11y.mainContent}>
            <TrashView
              chapters={trashedChapters}
              onRestore={handleRestore}
              onBack={() => setTrashOpen(false)}
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
                aria-label="Chapter title"
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
                total
              </span>
            )}
          </div>
          <div>
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

      {previewOpen && (
        <PreviewMode
          chapters={project.chapters}
          onClose={() => setPreviewOpen(false)}
          onNavigateToChapter={(chapterId) => {
            setPreviewOpen(false);
            handleSelectChapterWithFlush(chapterId);
          }}
        />
      )}
    </div>
  );
}
