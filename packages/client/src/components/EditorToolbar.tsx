import type { Editor } from "@tiptap/react";
import { STRINGS } from "../strings";

interface EditorToolbarProps {
  editor: Editor;
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  return (
    <div
      role="toolbar"
      aria-label={STRINGS.a11y.formattingToolbar}
      className="toolbar-breathe flex gap-0.5 items-center"
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
    </div>
  );
}
