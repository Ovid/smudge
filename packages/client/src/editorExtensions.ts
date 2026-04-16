import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Image from "@tiptap/extension-image";

/**
 * Shared TipTap extension configuration used by both the Editor component
 * and preview mode's generateHTML(). Keeping these in sync prevents
 * silent rendering divergence.
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: false,
  }),
  Heading.configure({
    levels: [3, 4, 5],
  }),
  Image.configure({
    inline: false,
    allowBase64: false,
  }),
];
