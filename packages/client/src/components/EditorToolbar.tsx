import type { Editor } from "@tiptap/react";
import { STRINGS } from "../strings";

interface EditorToolbarProps {
  editor: Editor;
  snapshotCount?: number;
  onToggleSnapshots?: () => void;
  onToggleFindReplace?: () => void;
}

export function EditorToolbar({ editor, snapshotCount, onToggleSnapshots, onToggleFindReplace }: EditorToolbarProps) {
  const snapshotLabel = `Snapshots${snapshotCount != null && snapshotCount > 0 ? ` (${snapshotCount})` : ""}`;
  return (
    <div
      role="toolbar"
      aria-label={STRINGS.a11y.formattingToolbar}
      className="flex gap-0.5 items-center"
    >
      <button
        onClick={() => editor.chain().focus().toggleBold().run()}
        aria-pressed={editor.isActive("bold")}
        className={`rounded-md px-2.5 py-1 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-focus-ring ${
          editor.isActive("bold")
            ? "bg-accent-light text-accent"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {STRINGS.toolbar.bold}
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        aria-pressed={editor.isActive("italic")}
        className={`rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring ${
          editor.isActive("italic")
            ? "bg-accent-light text-accent italic"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {STRINGS.toolbar.italic}
      </button>
      <span className="mx-0.5 self-stretch w-px bg-border/40" aria-hidden="true" />
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        aria-pressed={editor.isActive("heading", { level: 3 })}
        className={`rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring ${
          editor.isActive("heading", { level: 3 })
            ? "bg-accent-light text-accent"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {STRINGS.toolbar.heading1}
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
        aria-pressed={editor.isActive("heading", { level: 4 })}
        className={`rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring ${
          editor.isActive("heading", { level: 4 })
            ? "bg-accent-light text-accent"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {STRINGS.toolbar.heading2}
      </button>
      <button
        onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
        aria-pressed={editor.isActive("heading", { level: 5 })}
        className={`rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring ${
          editor.isActive("heading", { level: 5 })
            ? "bg-accent-light text-accent"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {STRINGS.toolbar.heading3}
      </button>
      <span className="mx-0.5 self-stretch w-px bg-border/40" aria-hidden="true" />
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        aria-pressed={editor.isActive("blockquote")}
        className={`rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring ${
          editor.isActive("blockquote")
            ? "bg-accent-light text-accent"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {STRINGS.toolbar.quote}
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        aria-pressed={editor.isActive("bulletList")}
        className={`rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring ${
          editor.isActive("bulletList")
            ? "bg-accent-light text-accent"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {STRINGS.toolbar.bulletList}
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        aria-pressed={editor.isActive("orderedList")}
        className={`rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring ${
          editor.isActive("orderedList")
            ? "bg-accent-light text-accent"
            : "text-text-muted hover:text-text-secondary hover:bg-bg-hover"
        }`}
      >
        {STRINGS.toolbar.numberedList}
      </button>
      <button
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        className="rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring text-text-muted hover:text-text-secondary hover:bg-bg-hover"
      >
        {STRINGS.toolbar.horizontalRule}
      </button>
      {onToggleSnapshots && (
        <>
          <span className="mx-0.5 self-stretch w-px bg-border/40" aria-hidden="true" />
          <button
            onClick={onToggleSnapshots}
            aria-label={snapshotLabel}
            title={snapshotLabel}
            className="relative rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring text-text-muted hover:text-text-secondary hover:bg-bg-hover"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {snapshotCount != null && snapshotCount > 0 && (
              <span
                className="absolute -top-1 -right-0.5 bg-accent text-white text-[9px] font-bold rounded-full min-w-[14px] h-[14px] flex items-center justify-center leading-none px-0.5"
                aria-hidden="true"
              >
                {snapshotCount}
              </span>
            )}
          </button>
        </>
      )}
      {onToggleFindReplace && (
        <>
          <span className="mx-0.5 self-stretch w-px bg-border/40" aria-hidden="true" />
          <button
            onClick={onToggleFindReplace}
            aria-label={STRINGS.findReplace.toggleTooltip}
            title={STRINGS.findReplace.toggleTooltip}
            className="rounded-md px-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-focus-ring text-text-muted hover:text-text-secondary hover:bg-bg-hover"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
