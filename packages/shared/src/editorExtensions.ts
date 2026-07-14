import StarterKit from "@tiptap/starter-kit";
import Heading from "@tiptap/extension-heading";
import Image from "@tiptap/extension-image";
import { generateHTML } from "@tiptap/html";
import { NoteMark } from "./noteMark";
import { stripNoteMarks } from "./tiptap-notes";

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
  // Editor-only: never rendered to output — renderEditorHtml() strips it.
  NoteMark,
];

/**
 * The one route from TipTap JSON to rendered HTML: preview, snapshot view, and
 * every export format (all five go through the server's chapterContentToHtml).
 * The live editor is the only surface that renders TipTap JSON *without* this
 * function — because the editor is the only surface allowed to show
 * editor-only marks.
 *
 * Editor-only marks are stripped here rather than at each call site. That is
 * the whole point: registering a mark in `editorExtensions` above is what makes
 * it renderable, so the strip has to live where the extensions do, or a new
 * render site silently ships private content. Notes are the first such mark
 * (Phase 4c.1) — a note's text is the writer's private commentary, and HTML is
 * the format you hand to a beta reader. A future editor-only mark (Phase 4c.3
 * tags) strips here too; do not add a fourth bare generateHTML() call site.
 *
 * Callers keep their own error handling and post-processing (the server's
 * image-src allowlist, the client's DOMPurify pass) — this function only
 * renders.
 */
export function renderEditorHtml(content: Record<string, unknown>): string {
  return generateHTML(
    stripNoteMarks(content) as Parameters<typeof generateHTML>[0],
    editorExtensions,
  );
}
