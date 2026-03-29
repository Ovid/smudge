import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef } from "react";
import { STRINGS } from "../strings";

interface EditorProps {
  content: Record<string, unknown> | null;
  onSave: (content: Record<string, unknown>) => void;
}

export function Editor({ content, onSave }: EditorProps) {
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
      }),
      Heading.configure({
        levels: [3, 4, 5],
      }),
      Placeholder.configure({
        placeholder: STRINGS.editor.placeholder,
      }),
    ],
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
    onBlur: ({ editor }) => {
      onSaveRef.current(editor.getJSON() as Record<string, unknown>);
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-lg max-w-none font-serif text-text-primary prose-headings:text-text-primary prose-a:text-accent focus:outline-none min-h-[60vh]",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Chapter content",
        spellcheck: "true",
      },
    },
  });

  useEffect(() => {
    if (editor && content) {
      const currentJSON = JSON.stringify(editor.getJSON());
      const newJSON = JSON.stringify(content);
      if (currentJSON !== newJSON) {
        editor.commands.setContent(content);
      }
    }
  }, [editor, content]);

  if (!editor) return null;

  return (
    <div className="mx-auto max-w-[720px]">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="mb-4 flex gap-1 border-b border-border pb-2"
      >
        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
          aria-pressed={editor.isActive("bold")}
          className={`rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring ${
            editor.isActive("bold")
              ? "bg-accent-light text-text-primary font-bold"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          Bold
        </button>
        <button
          onClick={() => editor.chain().focus().toggleItalic().run()}
          aria-pressed={editor.isActive("italic")}
          className={`rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring ${
            editor.isActive("italic")
              ? "bg-accent-light text-text-primary italic"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          Italic
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          aria-pressed={editor.isActive("heading", { level: 3 })}
          className={`rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring ${
            editor.isActive("heading", { level: 3 })
              ? "bg-accent-light text-text-primary"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          H1
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}
          aria-pressed={editor.isActive("heading", { level: 4 })}
          className={`rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring ${
            editor.isActive("heading", { level: 4 })
              ? "bg-accent-light text-text-primary"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          H2
        </button>
        <button
          onClick={() => editor.chain().focus().toggleHeading({ level: 5 }).run()}
          aria-pressed={editor.isActive("heading", { level: 5 })}
          className={`rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring ${
            editor.isActive("heading", { level: 5 })
              ? "bg-accent-light text-text-primary"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          H3
        </button>
        <button
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          aria-pressed={editor.isActive("blockquote")}
          className={`rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring ${
            editor.isActive("blockquote")
              ? "bg-accent-light text-text-primary"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          Quote
        </button>
        <button
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          aria-pressed={editor.isActive("bulletList")}
          className={`rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring ${
            editor.isActive("bulletList")
              ? "bg-accent-light text-text-primary"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          List
        </button>
        <button
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          aria-pressed={editor.isActive("orderedList")}
          className={`rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring ${
            editor.isActive("orderedList")
              ? "bg-accent-light text-text-primary"
              : "text-text-secondary hover:bg-bg-hover"
          }`}
        >
          Numbered
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
