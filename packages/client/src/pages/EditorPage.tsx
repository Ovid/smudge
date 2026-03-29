import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { api } from "../api/client";
import { Editor } from "../components/Editor";
import { STRINGS } from "../strings";

export function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<ProjectWithChapters | null>(null);
  const [activeChapter, setActiveChapter] = useState<Chapter | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const escapePressedRef = useRef(false);

  const loadProject = useCallback(async () => {
    if (!projectId) return;
    const data = await api.projects.get(projectId);
    setProject(data);
    const firstChapter = data.chapters[0];
    if (firstChapter && !activeChapter) {
      const chapter = await api.chapters.get(firstChapter.id);
      setActiveChapter(chapter);
    }
  }, [projectId, activeChapter]);

  useEffect(() => {
    loadProject();
  }, [loadProject]);

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
          <h1 className="text-lg font-semibold text-text-primary">{project.title}</h1>
        </div>
        <div aria-live="polite" className="text-sm text-text-muted">
          {saveStatus === "saving" && STRINGS.editor.saving}
          {saveStatus === "saved" && STRINGS.editor.saved}
          {saveStatus === "error" && (
            <span className="text-status-error">{STRINGS.editor.saveFailed}</span>
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
            title="Double-click to edit"
          >
            {activeChapter.title}
          </h2>
        )}
        <Editor content={activeChapter.content} onSave={handleSave} />
      </main>
    </div>
  );
}
