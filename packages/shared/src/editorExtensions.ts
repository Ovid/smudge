import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Image from "@tiptap/extension-image";
import { NoteMark } from "./noteMark";

/**
 * The single source of truth for Smudge's TipTap extension configuration.
 *
 * Consumed by the client (Editor component, preview mode, snapshot render)
 * and the server (export's generateHTML) via the
 * `@smudge/shared/editor-extensions` subpath export. Keeping one declaration
 * makes editor display and export rendering structurally impossible to
 * diverge — replacing the parity test that previously enforced it by hand.
 *
 * Exposed only through the subpath, NOT the package barrel (index.ts), so
 * importing `@smudge/shared` for a pure utility does not drag in
 * TipTap/ProseMirror. See design 2026-05-31-tiptap-extension-consolidation.
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
  // Editor-only: stripped before preview/export via stripNoteMarks().
  NoteMark,
];
