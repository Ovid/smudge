import { useEditor, EditorContent, type Editor as TipTapEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Placeholder from "@tiptap/extension-placeholder";
import { useEffect, useRef, useCallback } from "react";
import { editorExtensions } from "../editorExtensions";
import { STRINGS } from "../strings";
import { api } from "../api/client";

export interface EditorHandle {
  flushSave: () => Promise<boolean>;
  editor: TipTapEditor | null;
  insertImage: (src: string, alt: string) => void;
  /**
   * Mark the editor as clean and cancel any pending debounced save.
   * Orchestration paths that mutate chapter content server-side (snapshot
   * restore, project-wide replace, chapter switch) call this before
   * triggering a remount so the unmount cleanup does not fire a stale
   * fire-and-forget save that would clobber the just-committed content.
   */
  markClean: () => void;
}

interface EditorProps {
  content: Record<string, unknown> | null;
  onSave: (content: Record<string, unknown>) => Promise<boolean>;
  onContentChange?: (content: Record<string, unknown>) => void;
  editorRef?: React.MutableRefObject<EditorHandle | null>;
  onEditorReady?: (editor: TipTapEditor | null) => void;
  projectId: string;
  onImageAnnouncement?: (message: string) => void;
}

const AUTO_SAVE_DEBOUNCE_MS = 1500;

// Module-level map from editor instance ID to upload handler.
// Each Editor component registers its own handler keyed by a unique ID,
// so multiple instances don't overwrite each other.
let nextEditorId = 0;
const imageUploadHandlers = new Map<number, (file: File) => void>();

// The extension is module-level (ProseMirror plugins are created once).
// At event time it looks up the handler for the most recently focused editor.
let activeEditorId = -1;

const imagePasteExtension = Extension.create({
  name: "imagePaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("imagePaste"),
        props: {
          handlePaste(_view, event) {
            const items = event.clipboardData?.items;
            if (!items) return false;
            const images = Array.from(items).filter((i) => i.type.startsWith("image/"));
            if (images.length === 0) return false;
            event.preventDefault();
            const file = images[0]?.getAsFile();
            if (file) {
              const handler = imageUploadHandlers.get(activeEditorId);
              handler?.(file);
            }
            return true;
          },
          handleDrop(_view, event) {
            if (!event.dataTransfer?.files) return false;
            const images = Array.from(event.dataTransfer.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (images.length === 0) return false;
            event.preventDefault();
            const handler = imageUploadHandlers.get(activeEditorId);
            const first = images[0];
            if (first) handler?.(first);
            return true;
          },
        },
      }),
    ];
  },
});

export function Editor({
  content,
  onSave,
  onContentChange,
  editorRef,
  onEditorReady,
  projectId,
  onImageAnnouncement,
}: EditorProps) {
  const onSaveRef = useRef(onSave);
  const onContentChangeRef = useRef(onContentChange);
  const projectIdRef = useRef(projectId);
  const onImageAnnouncementRef = useRef(onImageAnnouncement);
  const editorIdRef = useRef(nextEditorId++);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    onContentChangeRef.current = onContentChange;
  }, [onContentChange]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    onImageAnnouncementRef.current = onImageAnnouncement;
  }, [onImageAnnouncement]);
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
      imagePasteExtension,
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
    onFocus: () => {
      activeEditorId = editorIdRef.current;
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

  // Register instance-scoped image upload handler
  useEffect(() => {
    const id = editorIdRef.current;
    activeEditorId = id;
    imageUploadHandlers.set(id, async (file: File) => {
      try {
        const image = await api.images.upload(projectIdRef.current, file);
        if (editor && !editor.isDestroyed) {
          editor
            .chain()
            .focus()
            .setImage({ src: `/api/images/${image.id}`, alt: image.alt_text })
            .run();
          onImageAnnouncementRef.current?.(STRINGS.imageGallery.insertSuccess(image.filename));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        onImageAnnouncementRef.current?.(STRINGS.imageGallery.uploadFailed(message));
      }
    });
    return () => {
      imageUploadHandlers.delete(id);
      if (activeEditorId === id) activeEditorId = -1;
    };
  }, [editor]);

  useEffect(() => {
    if (editorRef) {
      editorRef.current = {
        flushSave: () => {
          if (!dirtyRef.current || !editor) return Promise.resolve(true);
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          return onSaveRef
            .current(editor.getJSON() as Record<string, unknown>)
            .then((ok) => {
              dirtyRef.current = !ok;
              return ok;
            })
            .catch(() => {
              dirtyRef.current = true;
              return false;
            });
        },
        editor: editor,
        insertImage: (src: string, alt: string) => {
          if (editor) {
            editor.chain().focus().setImage({ src, alt }).run();
          }
        },
        markClean: () => {
          dirtyRef.current = false;
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
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
