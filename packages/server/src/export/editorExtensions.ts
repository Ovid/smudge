import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";

/**
 * Server-side TipTap extension list for generateHTML().
 * Must match the client's editorExtensions.ts — a test verifies
 * both produce identical output for a reference document.
 */
export const serverEditorExtensions = [
  StarterKit.configure({
    heading: false,
  }),
  Heading.configure({
    levels: [3, 4, 5],
  }),
];
