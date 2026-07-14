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
 * Remove every `note` mark, preserving the text it annotated. Returns a new
 * doc; the input is untouched. Depth-capped at MAX_TIPTAP_DEPTH per the Phase
 * 4b.13 depth-guard contract — an over-deep subtree is returned as-is rather
 * than blowing the stack.
 */
export function stripNoteMarks<T>(doc: T): T {
  return strip(doc as unknown as TipTapNode, 0) as unknown as T;
}

function strip(node: TipTapNode, depth: number): TipTapNode {
  if (depth > MAX_TIPTAP_DEPTH) return node;
  const next: TipTapNode = { ...node };
  if (node.marks) {
    const kept = node.marks.filter((m) => m.type !== NOTE_MARK_NAME);
    if (kept.length) next.marks = kept;
    else delete next.marks;
  }
  if (node.content) next.content = node.content.map((child) => strip(child, depth + 1));
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
  const noteMark = node.marks?.find((m) => m.type === NOTE_MARK_NAME);
  if (noteMark && typeof node.text === "string") {
    const text = noteMark.attrs?.text;
    out.push({ note: typeof text === "string" ? text : "", excerpt: node.text });
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collect(child, depth + 1, out);
  }
}
