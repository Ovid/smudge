import { Mark, mergeAttributes } from "@tiptap/core";

/**
 * Editor-only annotation mark (Phase 4c.1). The `text` attribute holds a
 * plain-text note about the range it covers.
 *
 * There is deliberately no `id` attribute: a note's identity is its document
 * position, so a note survives text edits the way any other mark does.
 *
 * The mark is stripped before preview and export via stripNoteMarks() — see
 * CLAUDE.md §Key Architecture Decisions — so neither the `note-highlight`
 * class nor the note text ever reaches rendered output.
 */
export const NoteMark = Mark.create({
  name: "note",

  // Typing at a note's boundary must not silently extend the note.
  inclusive: false,

  addAttributes() {
    return {
      text: {
        default: "",
        parseHTML: (el) => el.getAttribute("data-note") ?? "",
        renderHTML: (attrs) => (attrs.text ? { "data-note": attrs.text } : {}),
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
