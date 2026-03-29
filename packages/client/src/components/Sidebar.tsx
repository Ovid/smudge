import { useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
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

interface SortableChapterItemProps {
  chapter: Chapter;
  index: number;
  isActive: boolean;
  isEditing: boolean;
  editDraft: string;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onEditDraftChange: (value: string) => void;
  onCommitRename: () => void;
  onCancelRename: () => void;
  onSelectChapter: (id: string) => void;
  onStartRename: (chapter: Chapter) => void;
  onKeyReorder: (e: React.KeyboardEvent, index: number) => void;
  onDeleteChapter: (chapter: Chapter) => void;
}

function SortableChapterItem({
  chapter,
  index,
  isActive,
  isEditing,
  editDraft,
  editInputRef,
  onEditDraftChange,
  onCommitRename,
  onCancelRename,
  onSelectChapter,
  onStartRename,
  onKeyReorder,
  onDeleteChapter,
}: SortableChapterItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: chapter.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      aria-current={isActive ? "true" : undefined}
      className={`flex items-center gap-2 px-4 py-2 cursor-pointer group ${
        isDragging ? "opacity-50 bg-accent-light" : isActive ? "bg-accent-light" : "hover:bg-bg-hover"
      }`}
    >
      <span
        {...attributes}
        {...listeners}
        aria-label={STRINGS.sidebar.dragHandle}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted cursor-grab active:cursor-grabbing text-sm select-none focus:outline-none focus:ring-2 focus:ring-focus-ring rounded"
      >
        ⠿
      </span>
      {isEditing ? (
        <input
          ref={editInputRef}
          value={editDraft}
          onChange={(e) => onEditDraftChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommitRename();
            if (e.key === "Escape") onCancelRename();
          }}
          className="flex-1 text-sm text-text-primary bg-bg-input border border-border rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-focus-ring"
          aria-label="Chapter title"
        />
      ) : (
        <button
          onClick={() => onSelectChapter(chapter.id)}
          onDoubleClick={() => onStartRename(chapter)}
          onKeyDown={(e) => onKeyReorder(e, index)}
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
  );
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

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = project.chapters.findIndex((c) => c.id === active.id);
    const newIndex = project.chapters.findIndex((c) => c.id === over.id);
    const reorderedIds = arrayMove(
      project.chapters.map((c) => c.id),
      oldIndex,
      newIndex,
    );
    onReorderChapters(reorderedIds);
  }

  const chapterIds = project.chapters.map((c) => c.id);

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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={chapterIds} strategy={verticalListSortingStrategy}>
            <ul role="list">
              {project.chapters.map((chapter, index) => (
                <SortableChapterItem
                  key={chapter.id}
                  chapter={chapter}
                  index={index}
                  isActive={chapter.id === activeChapterId}
                  isEditing={editingId === chapter.id}
                  editDraft={editDraft}
                  editInputRef={editInputRef}
                  onEditDraftChange={setEditDraft}
                  onCommitRename={commitRename}
                  onCancelRename={() => setEditingId(null)}
                  onSelectChapter={onSelectChapter}
                  onStartRename={startRename}
                  onKeyReorder={handleKeyReorder}
                  onDeleteChapter={onDeleteChapter}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
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
