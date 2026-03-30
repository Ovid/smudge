import { useState, useRef, useEffect, useCallback } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { CSS } from "@dnd-kit/utilities";
import type { ProjectWithChapters, Chapter, ChapterStatusRow } from "@smudge/shared";
import { STRINGS } from "../strings";
import { STATUS_COLORS } from "../statusColors";

interface StatusBadgeProps {
  chapter: Chapter;
  statuses: ChapterStatusRow[];
  onStatusChange: (chapterId: string, status: string) => void;
  onAnnounce: (message: string) => void;
}

function StatusBadge({ chapter, statuses, onStatusChange, onAnnounce }: StatusBadgeProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listboxRef = useRef<HTMLUListElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const currentStatus = chapter.status || "outline";
  const currentStatusRow = statuses.find((s) => s.status === currentStatus);
  const label = currentStatusRow?.label ?? currentStatus;
  const color = STATUS_COLORS[currentStatus] || STATUS_COLORS.outline;

  useEffect(() => {
    if (!open) return;
    // Focus the currently-selected option when the dropdown opens
    const selected = listboxRef.current?.querySelector('[aria-selected="true"]') as HTMLElement | null;
    selected?.focus();

    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      toggleRef.current?.focus();
    }
  }, []);

  function selectStatus(status: string) {
    onStatusChange(chapter.id, status);
    const newStatusRow = statuses.find((s) => s.status === status);
    const newLabel = newStatusRow?.label ?? status;
    onAnnounce(STRINGS.sidebar.statusChanged(newLabel));
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={toggleRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            e.stopPropagation();
            if (!open) setOpen(true);
          } else {
            handleKeyDown(e);
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={STRINGS.sidebar.statusLabel(label)}
        className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs text-text-secondary bg-bg-hover hover:bg-border focus:outline-none focus:ring-2 focus:ring-focus-ring"
      >
        <span
          style={{ backgroundColor: color }}
          className="inline-block w-2 h-2 rounded-full"
          aria-hidden="true"
        />
        <span>{label}</span>
      </button>
      {open && (
        <ul
          ref={listboxRef}
          role="listbox"
          aria-label={STRINGS.sidebar.statusLabel(label)}
          className="absolute left-0 top-full mt-1 z-50 bg-bg-primary border border-border rounded shadow-lg py-1 min-w-[120px]"
          onKeyDown={handleKeyDown}
        >
          {statuses.map((s) => {
            const sLabel = s.label ?? s.status;
            const sColor = STATUS_COLORS[s.status] || STATUS_COLORS.outline;
            return (
              <li
                key={s.status}
                role="option"
                aria-selected={s.status === currentStatus}
                tabIndex={s.status === currentStatus ? 0 : -1}
                onClick={(e) => {
                  e.stopPropagation();
                  selectStatus(s.status);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus();
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus();
                    return;
                  }
                  if (e.key === "Home") {
                    e.preventDefault();
                    (
                      e.currentTarget.parentElement?.firstElementChild as HTMLElement | null
                    )?.focus();
                    return;
                  }
                  if (e.key === "End") {
                    e.preventDefault();
                    (
                      e.currentTarget.parentElement?.lastElementChild as HTMLElement | null
                    )?.focus();
                    return;
                  }
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    selectStatus(s.status);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setOpen(false);
                    toggleRef.current?.focus();
                  }
                }}
                className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-bg-hover focus:outline-none focus:ring-2 focus:ring-focus-ring ${
                  s.status === currentStatus ? "bg-bg-hover font-semibold" : ""
                }`}
              >
                <span
                  style={{ backgroundColor: sColor }}
                  className="inline-block w-2 h-2 rounded-full"
                  aria-hidden="true"
                />
                <span>{sLabel}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface SidebarProps {
  project: ProjectWithChapters;
  activeChapterId: string | null;
  onSelectChapter: (id: string) => void;
  onAddChapter: () => void;
  onDeleteChapter: (chapter: Chapter) => void;
  onReorderChapters: (orderedIds: string[]) => void;
  onRenameChapter: (chapterId: string, title: string) => void;
  onOpenTrash: () => void;
  statuses: ChapterStatusRow[];
  onStatusChange: (chapterId: string, status: string) => void;
  width: number;
  onResize: (width: number) => void;
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
  statuses: ChapterStatusRow[];
  onStatusChange: (chapterId: string, status: string) => void;
  onAnnounce: (message: string) => void;
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
  statuses,
  onStatusChange,
  onAnnounce,
}: SortableChapterItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: chapter.id,
  });

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
        isDragging
          ? "opacity-50 bg-accent-light"
          : isActive
            ? "bg-accent-light"
            : "hover:bg-bg-hover"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={STRINGS.sidebar.dragHandle}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted cursor-grab active:cursor-grabbing text-sm select-none focus:outline-none focus:ring-2 focus:ring-focus-ring rounded border-none bg-transparent p-0"
      >
        ⠿
      </button>
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
          aria-label={STRINGS.a11y.chapterTitleInput}
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
      <StatusBadge
        chapter={chapter}
        statuses={statuses}
        onStatusChange={onStatusChange}
        onAnnounce={onAnnounce}
      />
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDeleteChapter(chapter);
        }}
        className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-text-muted hover:text-status-error text-xs p-1 rounded focus:outline-none focus:ring-2 focus:ring-focus-ring"
        aria-label={STRINGS.delete.deleteChapterAriaLabel(chapter.title)}
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
  statuses,
  onStatusChange,
  width,
  onResize,
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
      className="border-r border-border bg-bg-sidebar flex flex-col h-full overflow-hidden relative"
      style={{ width: `${width}px`, minWidth: `${width}px` }}
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
                  statuses={statuses}
                  onStatusChange={onStatusChange}
                  onAnnounce={setAnnouncement}
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

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={STRINGS.sidebar.resizeHandle}
        aria-valuenow={width}
        aria-valuemin={180}
        aria-valuemax={480}
        tabIndex={0}
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent-light focus:bg-accent-light focus:outline-none"
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = width;
          function onMouseMove(ev: MouseEvent) {
            const newWidth = Math.min(480, Math.max(180, startWidth + ev.clientX - startX));
            onResize(newWidth);
          }
          function onMouseUp() {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
          }
          document.addEventListener("mousemove", onMouseMove);
          document.addEventListener("mouseup", onMouseUp);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") {
            e.preventDefault();
            onResize(Math.min(480, width + 10));
          }
          if (e.key === "ArrowLeft") {
            e.preventDefault();
            onResize(Math.max(180, width - 10));
          }
        }}
      />
    </aside>
  );
}
