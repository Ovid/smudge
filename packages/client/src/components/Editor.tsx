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
  /**
   * Toggle the editor's editable state. Orchestration paths that mutate
   * chapter content server-side (project-wide replace) disable editing
   * for the duration of the round trip so typing during the request
   * can't dirty the editor and cause the unmount cleanup to PATCH
   * pre-replace content over the server's replaced content. Safe to
   * call on a destroyed editor (no-op).
   */
  setEditable: (editable: boolean) => void;
}

interface EditorProps {
  content: Record<string, unknown> | null;
  /**
   * chapterId is captured at mount and threaded through every save so that the
   * unmount cleanup targets the chapter this Editor was created for — not
   * whichever chapter is active at the moment cleanup fires. Without this,
   * unmount-after-failed-flush would clobber the new chapter with old content.
   */
  chapterId?: string;
  onSave: (content: Record<string, unknown>, chapterId?: string) => Promise<boolean>;
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
  chapterId,
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
  // Captured at mount. The Editor is keyed on chapter id so the prop never
  // changes during the instance's lifetime; this ref is the canonical target
  // for every save fired by this Editor, including fire-and-forget unmount
  // cleanup where activeChapterRef has already moved to a different chapter.
  const chapterIdRef = useRef(chapterId);

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
        const ok = await onSaveRef.current(
          editorInstance.getJSON() as Record<string, unknown>,
          chapterIdRef.current,
        );
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
    // Capture the chapter id here at mount so the cleanup closure holds a
    // stable value. The ref never changes during the Editor's lifetime
    // (the component is keyed per chapter), but the react-hooks lint
    // rule flags reading `.current` in cleanup — legitimately in general,
    // since a ref assigned during render wouldn't reflect the mount-time
    // value at cleanup.
    const mountChapterId = chapterIdRef.current;
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (dirtyRef.current && editorInstanceRef.current) {
        // Fire-and-forget: don't set dirtyRef=false here since the save is async.
        // The content cache persists the data until save succeeds.
        // mountChapterId is captured above so this cleanup targets THIS
        // chapter, not whatever chapter is active by the time the save
        // fires (C1).
        onSaveRef
          .current(editorInstanceRef.current.getJSON() as Record<string, unknown>, mountChapterId)
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
        .current(ed.getJSON() as Record<string, unknown>, chapterIdRef.current)
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
            .current(editor.getJSON() as Record<string, unknown>, chapterIdRef.current)
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
        setEditable: (editable: boolean) => {
          // Pass emitUpdate=false — TipTap's default behaviour is to fire
          // onUpdate even though setEditable does not change the doc,
          // which would set dirtyRef=true and trigger a save with the
          // current (pre-replace) content. That is exactly the race we
          // are trying to prevent.
          if (editor && !editor.isDestroyed) editor.setEditable(editable, false);
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
