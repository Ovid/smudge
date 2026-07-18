/**
 * Inline-note helpers over TipTap JSON (Phase 4c.1).
 *
 * A note is a `note` mark carrying a plain-text `text` attribute on the noted
 * range. The mark is editor-only. Every rendered surface strips it via
 * `stripNoteMarks`: `renderEditorHtml` (editorExtensions.ts) calls it before
 * generateHTML for preview, snapshot view, and four of the five export formats
 * (HTML, EPUB, markdown, plaintext all funnel through `chapterContentToHtml`).
 * DOCX walks TipTap JSON directly rather than rendering HTML, so it calls
 * `stripNoteMarks` at its own walker entry (docx.renderer.ts `tipTapToParagraphs`)
 * — a separate route to the same guarantee. Either way, neither the highlight
 * nor the note text reaches a rendered surface.
 *
 * Pure JSON walkers — no TipTap import — so they live in the package barrel
 * (the mark itself lives in editorExtensions, behind the subpath export).
 */

// Depth cap pulled from the zero-dependency safety module directly (NOT via the
// barrel), matching tiptap-text.ts, so a future edit to the cap propagates.
import { MAX_TIPTAP_DEPTH } from "./tiptap-safety";

export const NOTE_MARK_NAME = "note";

type Mark = { type: string; attrs?: Record<string, unknown> };

type TipTapNode = {
  type?: string;
  text?: string;
  marks?: Mark[];
  content?: TipTapNode[];
};

/** A note as the panel renders it: the note body plus the text it annotates. */
export interface ExtractedNote {
  note: string;
  excerpt: string;
}

/**
 * Remove every `note` mark, preserving the text it annotated. The input is
 * untouched: every node on the path to a mark is copied. The copy is shallow
 * below that — leaf `attrs` and surviving mark objects are shared by reference
 * with the input, which is safe because nothing here mutates them, but means
 * the result is not a deep clone. Depth-capped at MAX_TIPTAP_DEPTH: an
 * over-deep subtree is DROPPED (see strip()), not returned as-is.
 */
export function stripNoteMarks<T>(doc: T): T {
  // depth 0 is never over the cap, so the top-level node always survives.
  return strip(doc as unknown as TipTapNode, 0) as unknown as T;
}

function strip(node: TipTapNode, depth: number): TipTapNode | undefined {
  // Chapters read from the DB bypass Zod, so a walker cannot rely on the shape
  // the schema promises (see tiptap-text.ts:70-76). A non-object node is passed
  // through untouched — spreading a string would corrupt it into a character map.
  if (!node || typeof node !== "object") return node;
  // Fail CLOSED at the depth cap: drop the over-deep subtree rather than return
  // it verbatim. Returning it would ship its note marks straight into export —
  // strip() is the one walker whose failing open is a confidentiality leak, and
  // extractNotes() already reports 0 notes down there, so the writer would be
  // told there is nothing to hide while the export carries it. Every sibling
  // walker fails closed too (collectLeafBlocks → [], validateTipTapDepth →
  // false). Unreachable via the API (Zod rejects depth > MAX_TIPTAP_DEPTH);
  // reachable from a hand-edited DB or a restored backup.
  if (depth > MAX_TIPTAP_DEPTH) return undefined;
  const next: TipTapNode = { ...node };
  if (Array.isArray(node.marks)) {
    const kept = node.marks.filter((m) => m?.type !== NOTE_MARK_NAME);
    if (kept.length) next.marks = kept;
    else delete next.marks;
  }
  if (Array.isArray(node.content)) {
    next.content = node.content.flatMap((child) => strip(child, depth + 1) ?? []);
  }
  return next;
}

/**
 * Collect every note in document order — one entry per note, not per text node.
 * Display fields only: a note's identity is its document position, which only a
 * live editor knows (see collectNotes on the client). Keeping this helper
 * JSON-only makes it testable without TipTap.
 */
export function extractNotes(doc: unknown): ExtractedNote[] {
  const notes: ExtractedNote[] = [];
  collect(doc as TipTapNode, 0, notes);
  return notes;
}

/** The note text carried by this node, or null if it carries no note mark. */
function noteTextOf(node: TipTapNode): string | null {
  if (!node || typeof node !== "object") return null;
  const marks = Array.isArray(node.marks) ? node.marks : [];
  const mark = marks.find((m) => m?.type === NOTE_MARK_NAME);
  if (!mark) return null;
  const text = mark.attrs?.text;
  return typeof text === "string" ? text : "";
}

function collect(node: TipTapNode, depth: number, out: ExtractedNote[]): void {
  if (depth > MAX_TIPTAP_DEPTH || !node || typeof node !== "object") return;
  if (!Array.isArray(node.content)) return;

  // ProseMirror splits a text run on every mark change, so one note over
  // "Marcus **drew** his sword" is stored as three adjacent text nodes. Walk
  // siblings and merge a run of them carrying an equal note into one entry —
  // the panel counts notes, not nodes. Adjacency is required: two equal notes
  // separated by un-noted text, or sitting in different blocks, stay distinct.
  //
  // Two genuinely separate notes that happen to carry identical text AND end up
  // adjacent do fuse into one. That is inherent to the design's decision to give
  // notes no `id` (identity is document position) — the same reason
  // find-and-replace's cleanupTextNodes already merges them structurally. The
  // information lost is a duplicate.
  let run: ExtractedNote | null = null;
  for (const child of node.content) {
    const noteText = noteTextOf(child);
    if (noteText !== null && typeof child.text === "string") {
      if (run && run.note === noteText) run.excerpt += child.text;
      else out.push((run = { note: noteText, excerpt: child.text }));
      continue;
    }
    // A content-less inline leaf (e.g. hardBreak) is not a note boundary: a note
    // applied across a line break is stored as text(note), hardBreak, text(note),
    // so skipping the break without resetting `run` keeps the two halves one
    // entry. Un-noted text (which has a string `text`) and block nodes (which
    // have `content`) still fall through below and break the run.
    if (
      child &&
      typeof child === "object" &&
      !Array.isArray(child.content) &&
      typeof child.text !== "string"
    )
      continue;
    run = null;
    collect(child, depth + 1, out);
  }
}
