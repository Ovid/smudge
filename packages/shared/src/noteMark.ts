import { Mark, mergeAttributes } from "@tiptap/core";
import { NOTE_MARK_NAME } from "./tiptap-notes";

/**
 * Editor-only annotation mark (Phase 4c.1). The `text` attribute holds a
 * plain-text note about the range it covers.
 *
 * There is deliberately no `id` attribute: a note's identity is its document
 * position, so a note survives text edits the way any other mark does.
 *
 * Editor-only means editor-only: this mark must never reach a rendered surface.
 * renderEditorHtml() in editorExtensions.ts strips it, and it is the single
 * route from TipTap JSON to preview, snapshot view, and every export format.
 */
export const NoteMark = Mark.create({
  // Shared with stripNoteMarks/extractNotes, which match on this string. Import
  // it rather than repeat it: a rename that misses one side would silently turn
  // the strip into a no-op and ship notes into every export, with no test red.
  name: NOTE_MARK_NAME,

  // Typing at a note's boundary must not silently extend the note.
  inclusive: false,

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-note") ?? "",
        // Emitted unconditionally: parseHTML below matches only span[data-note],
        // so omitting the attribute for an empty note makes the mark unparseable
        // — and ProseMirror's clipboard serialization is HTML-based, so an
        // empty note would vanish on copy/paste WITHIN the editor.
        renderHTML: (attrs) => ({ "data-note": String(attrs.text ?? "") }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-note]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["span", mergeAttributes(HTMLAttributes, { class: "note-highlight" }), 0];
  },
});
