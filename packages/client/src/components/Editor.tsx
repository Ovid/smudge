import { useEditor, EditorContent, type Editor as TipTapEditor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useCallback } from "react";
import { editorExtensions } from "../editorExtensions";
import { STRINGS } from "../strings";

export interface EditorHandle {
  flushSave: () => Promise<void>;
  editor: TipTapEditor | null;
  insertImage: (src: string, alt: string) => void;
}

interface EditorProps {
  content: Record<string, unknown> | null;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
  onContentChange?: (content: Record<string, unknown>) => void;
  editorRef?: React.MutableRefObject<EditorHandle | null>;
  onEditorReady?: (editor: TipTapEditor | null) => void;
}

const AUTO_SAVE_DEBOUNCE_MS = 1500;

export function Editor({
  content,
  onSave,
  onContentChange,
  editorRef,
  onEditorReady,
}: EditorProps) {
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
      debounceTimerRef.current = setTimeout(async () => {
        debounceTimerRef.current = null; // Clear before async work so flushSave knows the timer fired
        const ok = await onSaveRef.current(editorInstance.getJSON() as Record<string, unknown>);
        dirtyRef.current = !ok;
      }, AUTO_SAVE_DEBOUNCE_MS);
    },
    [],
  );

  // Warn before closing tab with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
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
        // Fire-and-forget: don't set dirtyRef=false here since the save is async.
        // The content cache persists the data until save succeeds.
        onSaveRef
          .current(editorInstanceRef.current.getJSON() as Record<string, unknown>)
          .catch(() => {});
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
      onSaveRef
        .current(ed.getJSON() as Record<string, unknown>)
        .then((ok) => {
          dirtyRef.current = !ok;
        })
        .catch(() => {
          dirtyRef.current = true;
        });
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-lg max-w-none font-serif text-text-primary prose-headings:text-text-primary prose-a:text-accent focus:outline-none min-h-[60vh]",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": STRINGS.a11y.editorContent,
        spellcheck: "true",
      },
    },
  });

  useEffect(() => {
    editorInstanceRef.current = editor;
  }, [editor]);

  useEffect(() => {
    if (editorRef) {
      editorRef.current = {
        flushSave: () => {
          if (!dirtyRef.current || !editor) return Promise.resolve();
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          return onSaveRef
            .current(editor.getJSON() as Record<string, unknown>)
            .then((ok) => {
              dirtyRef.current = !ok;
            })
            .catch(() => {
              dirtyRef.current = true;
            });
        },
        editor: editor,
        insertImage: (src: string, alt: string) => {
          if (editor) {
            editor.chain().focus().setImage({ src, alt }).run();
          }
        },
      };
    }
  }, [editor, editorRef]);

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  if (!editor) return null;

  return (
    <div className="mx-auto max-w-[720px]">
      <EditorContent editor={editor} />
    </div>
  );
}
