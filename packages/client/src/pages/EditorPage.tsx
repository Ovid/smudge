import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { countWords } from "@smudge/shared";
import { api } from "../api/client";
import { Editor } from "../components/Editor";
import { STRINGS } from "../strings";

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectWithChapters | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [chapterWordCount, setChapterWordCount] = useState(0);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);
  const [shortcutHelpOpen, setShortcutHelpOpen] = useState(false);
  const [editingProjectTitle, setEditingProjectTitle] = useState(false);
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const projectTitleInputRef = useRef<HTMLInputElement>(null);
  const projectEscapePressedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProject() {
      if (!projectId) return;
      const data = await api.projects.get(projectId);
      if (cancelled) return;
      setProject(data);
      const firstChapter = data.chapters[0];
      if (firstChapter && !activeChapter) {
        const chapter = await api.chapters.get(firstChapter.id);
        if (cancelled) return;
        setActiveChapter(chapter);
        setChapterWordCount(countWords(chapter.content));
      }
    }

    loadProject();

    return () => {
      cancelled = true;
    };
  }, [projectId, activeChapter]);

  const handleSave = useCallback(
    async (content: Record<string, unknown>) => {
      if (!activeChapter) return;

      setSaveStatus("saving");
      try {
        const updated = await api.chapters.update(activeChapter.id, { content });
        setActiveChapter(updated);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("error");
      }
    },
    [activeChapter],
  );

  const handleContentChange = useCallback((content: Record<string, unknown>) => {
    setChapterWordCount(countWords(content));
  }, []);

  const handleCreateChapter = useCallback(async () => {
    if (!projectId) return;
    const newChapter = await api.chapters.create(projectId);
    setActiveChapter(newChapter);
    setChapterWordCount(0);
    setProject((prev) => (prev ? { ...prev, chapters: [...prev.chapters, newChapter] } : prev));
  }, [projectId]);

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
      const updated = await api.chapters.update(activeChapter.id, { title: trimmed });
      setActiveChapter(updated);
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
      await api.projects.update(project.id, { title: trimmed });
      setProject({ ...project, title: trimmed });
    }
    setEditingProjectTitle(false);
  }

  if (!project || !activeChapter) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg-primary">
        <p className="text-text-muted">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg-primary">
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
      </header>

      <main className="px-6 py-8" aria-label={STRINGS.a11y.mainContent}>
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
        />
      </main>

      <footer
        role="status"
        aria-live="polite"
        className="fixed bottom-0 left-0 right-0 border-t border-border bg-bg-primary px-6 py-2 flex items-center justify-between text-sm text-text-secondary"
      >
        <div>{STRINGS.project.wordCount(chapterWordCount)}</div>
        <div>
          {saveStatus === "saving" && STRINGS.editor.saving}
          {saveStatus === "saved" && STRINGS.editor.saved}
          {saveStatus === "error" && (
            <span className="text-status-error">{STRINGS.editor.saveFailed}</span>
          )}
          {saveStatus === "idle" && ""}
        </div>
      </footer>

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
