import { useState, useRef } from "react";
import type { ProjectWithChapters, Chapter } from "@smudge/shared";
import { STRINGS } from "../strings";

interface SidebarProps {
  project: ProjectWithChapters;
  activeChapterId: string;
  onSelectChapter: (id: string) => void;
  onAddChapter: () => void;
  onDeleteChapter: (chapter: Chapter) => void;
  onReorderChapters: (orderedIds: string[]) => void;
  onRenameChapter: (chapterId: string, title: string) => void;
  onOpenTrash: () => void;
}

export function Sidebar({
  project,
  activeChapterId,
  onSelectChapter,
  onAddChapter,
  onDeleteChapter,
  onReorderChapters,
  onRenameChapter,
  onOpenTrash,
}: SidebarProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [announcement, setAnnouncement] = useState("");

  function startRename(chapter: Chapter) {
    setEditingId(chapter.id);
    setEditDraft(chapter.title);
    setTimeout(() => editInputRef.current?.select(), 0);
  }

  function commitRename() {
    if (editingId && editDraft.trim()) {
      onRenameChapter(editingId, editDraft.trim());
    }
    setEditingId(null);
  }

  function handleKeyReorder(e: React.KeyboardEvent, chapterIndex: number) {
    if (!e.altKey) return;
    const chapters = project.chapters;

    if (e.key === "ArrowUp" && chapterIndex > 0) {
      e.preventDefault();
      const reordered = [...chapters];
      [reordered[chapterIndex - 1], reordered[chapterIndex]] = [
        reordered[chapterIndex],
        reordered[chapterIndex - 1],
      ];
      const ids = reordered.map((c) => c.id);
      onReorderChapters(ids);
      setAnnouncement(
        STRINGS.sidebar.chapterPosition(
          chapters[chapterIndex].title,
          chapterIndex,
          chapters.length,
        ),
      );
    }

    if (e.key === "ArrowDown" && chapterIndex < chapters.length - 1) {
      e.preventDefault();
      const reordered = [...chapters];
      [reordered[chapterIndex], reordered[chapterIndex + 1]] = [
        reordered[chapterIndex + 1],
        reordered[chapterIndex],
      ];
      const ids = reordered.map((c) => c.id);
      onReorderChapters(ids);
      setAnnouncement(
        STRINGS.sidebar.chapterPosition(
          chapters[chapterIndex].title,
          chapterIndex + 2,
          chapters.length,
        ),
      );
    }
  }

  return (
    <aside
      aria-label={STRINGS.a11y.chaptersSidebar}
      className="w-[260px] min-w-[260px] border-r border-border bg-bg-sidebar flex flex-col h-full overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wide">
          {project.title}
        </h2>
      </div>

      <nav className="flex-1 overflow-y-auto py-2">
        <ul role="list">
          {project.chapters.map((chapter, index) => (
            <li
              key={chapter.id}
              aria-current={chapter.id === activeChapterId ? "true" : undefined}
              className={`flex items-center gap-2 px-4 py-2 cursor-pointer group ${
                chapter.id === activeChapterId ? "bg-accent-light" : "hover:bg-bg-hover"
              }`}
            >
              {editingId === chapter.id ? (
                <input
                  ref={editInputRef}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  className="flex-1 text-sm text-text-primary bg-bg-input border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
                  aria-label="Chapter title"
                />
              ) : (
                <button
                  onClick={() => onSelectChapter(chapter.id)}
                  onDoubleClick={() => startRename(chapter)}
                  onKeyDown={(e) => handleKeyReorder(e, index)}
                  className="flex-1 text-left text-sm text-text-primary truncate focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
                >
                  {chapter.title}
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteChapter(chapter);
                }}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-status-error text-xs p-1 rounded focus:outline-none focus:ring-2 focus:ring-focus-ring"
                aria-label={`Delete ${chapter.title}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-border px-4 py-3 flex flex-col gap-2">
        <button
          onClick={onAddChapter}
          className="w-full rounded bg-accent px-3 py-2 text-sm text-text-inverse hover:bg-accent-hover focus:outline-none focus:ring-2 focus:ring-focus-ring"
        >
          {STRINGS.sidebar.addChapter}
        </button>
        <button
          onClick={onOpenTrash}
          className="w-full text-sm text-text-muted hover:text-text-secondary focus:outline-none focus:ring-2 focus:ring-focus-ring rounded py-1"
        >
          {STRINGS.sidebar.trash}
        </button>
      </div>

      <div aria-live="assertive" className="sr-only">
        {announcement}
      </div>
    </aside>
  );
}
