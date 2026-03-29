import { useEditor, EditorContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useCallback } from "react";
import { editorExtensions } from "../editorExtensions";
import { STRINGS } from "../strings";

interface EditorProps {
  content: Record<string, unknown> | null;
  onSave: (content: Record<string, unknown>) => void;
  onContentChange?: (content: Record<string, unknown>) => void;
  editorRef?: React.MutableRefObject<{ flushSave: () => void } | null>;
}

const AUTO_SAVE_DEBOUNCE_MS = 1500;

export function Editor({ content, onSave, onContentChange, editorRef }: EditorProps) {
  const onSaveRef = useRef(onSave);
  const onContentChangeRef = useRef(onContentChange);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const editorInstanceRef = useRef<{ getJSON: () => Record<string, unknown> } | null>(null);

  const debouncedSave = useCallback(
    (editorInstance: { getJSON: () => Record<string, unknown> }) => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        onSaveRef.current(editorInstance.getJSON() as Record<string, unknown>);
        dirtyRef.current = false;
        debounceTimerRef.current = null;
      }, AUTO_SAVE_DEBOUNCE_MS);
    },
    [],
  );

  // Warn before closing tab with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (dirtyRef.current && editorInstanceRef.current) {
        onSaveRef.current(editorInstanceRef.current.getJSON() as Record<string, unknown>);
        dirtyRef.current = false;
      }
    };
  }, []);

  const editor = useEditor({
    extensions: [
      ...editorExtensions,
      Placeholder.configure({
        placeholder: STRINGS.editor.placeholder,
      }),
    ],
    content: content ?? { type: "doc", content: [{ type: "paragraph" }] },
    onUpdate: ({ editor: ed }) => {
      dirtyRef.current = true;
      onContentChangeRef.current?.(ed.getJSON() as Record<string, unknown>);
      debouncedSave(ed);
    },
    onBlur: ({ editor: ed }) => {
      if (!dirtyRef.current) return;
      // Immediate save on blur (cancel pending debounce)
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      onSaveRef.current(ed.getJSON() as Record<string, unknown>);
      dirtyRef.current = false;
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
    editorInstanceRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (editorRef && editor) {
      editorRef.current = {
        flushSave: () => {
          if (!dirtyRef.current) return;
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          onSaveRef.current(editor.getJSON() as Record<string, unknown>);
          dirtyRef.current = false;
        },
      };
    }
  }, [editor, editorRef]);

  useEffect(() => {
    if (!editor) return;
    const effectiveContent = content ?? { type: "doc", content: [{ type: "paragraph" }] };
    const currentJSON = JSON.stringify(editor.getJSON());
    const newJSON = JSON.stringify(effectiveContent);
    if (currentJSON !== newJSON) {
      editor.commands.setContent(effectiveContent);
      dirtyRef.current = false;
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
        <button
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          className="rounded px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring text-text-secondary hover:bg-bg-hover"
        >
          HR
        </button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
