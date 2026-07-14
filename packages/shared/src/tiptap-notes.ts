/**
 * Inline-note helpers over TipTap JSON (Phase 4c.1).
 *
 * A note is a `note` mark carrying a plain-text `text` attribute on the noted
 * range. The mark is editor-only: `stripNoteMarks` removes it before
 * generateHTML() in both preview and export, so neither the highlight nor the
 * note text ever reaches output.
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
 * Collect every note in document order. Display fields only — a note's identity
 * is its document position, which only a live editor knows (see collectNotes on
 * the client). Keeping this helper JSON-only makes it testable without TipTap.
 */
export function extractNotes(doc: unknown): ExtractedNote[] {
  const notes: ExtractedNote[] = [];
  collect(doc as TipTapNode, 0, notes);
  return notes;
}

function collect(node: TipTapNode, depth: number, out: ExtractedNote[]): void {
  if (depth > MAX_TIPTAP_DEPTH || !node || typeof node !== "object") return;
  const marks = Array.isArray(node.marks) ? node.marks : [];
  const noteMark = marks.find((m) => m?.type === NOTE_MARK_NAME);
  if (noteMark && typeof node.text === "string") {
    const text = noteMark.attrs?.text;
    out.push({ note: typeof text === "string" ? text : "", excerpt: node.text });
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collect(child, depth + 1, out);
  }
}
