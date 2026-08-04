// Imported from the zero-dep tiptap-safety module rather than schemas so
// countWords callers (notably the client bundle) don't pull in Zod just
// to compute word counts.
import { MAX_TIPTAP_DEPTH, isTipTapNode } from "./tiptap-safety";

type TipTapNode = {
  type: string;
  text?: string;
  content?: TipTapNode[];
};

/**
 * Walk TipTap JSON extracting text. Adjacent text siblings (e.g. text nodes
 * split by differing marks) concatenate without a separator so "<b>foo</b><i>bar</i>"
 * counts as one word — matching how TipTap renders it and how tiptap-text.ts
 * flattens runs for find-and-replace. Non-text children (block boundaries,
 * hardBreak, image, etc.) act as word separators so paragraphs and line breaks
 * don't silently merge adjacent words.
 *
 * Depth is capped at MAX_TIPTAP_DEPTH to match the schema's write-side
 * invariant. Every current caller feeds schema-validated content, so the cap
 * is defensive — protects against legacy rows or test fixtures that bypass
 * validation from stack-overflowing the walker.
 */
// S9: the third "what separates text" encoding, and the only type-agnostic
// one (any non-text child separates). See the cross-reference comment above
// BLOCK_TYPES in tiptap-plaintext.ts before registering a new node type.
function extractText(node: TipTapNode, depth: number = 0): string {
  if (depth > MAX_TIPTAP_DEPTH) return "";
  if (node.text) return node.text;
  // Array.isArray, not a truthiness check: `content` is unvalidated in exactly
  // the same way its children are (TipTapDocSchema types top-level elements
  // only; DB reads bypass Zod), so `{"type":"paragraph","content":5}` reaches
  // here and `for…of` a truthy non-iterable throws. countWords runs before the
  // transaction on `PATCH /api/chapters/:id` — a throw there is a 500 where the
  // contract says 400 — and inside OuttakeCard's render, where a persisted row
  // of that shape made the drawer unrenderable and therefore undeletable.
  if (!Array.isArray(node.content)) return "";
  const parts: string[] = [];
  let endsWithWhitespace = true;
  for (const child of node.content) {
    // Nested content[] is unvalidated by TipTapDocSchema (it constrains
    // top-level elements only) and DB-read content bypasses Zod entirely, so a
    // null/primitive/array child is reachable; reading .type off one threw.
    // Contributes no text and no separator — treat it as absent.
    if (!isTipTapNode(child)) continue;
    if (child.type !== "text" && !endsWithWhitespace) {
      parts.push(" ");
      endsWithWhitespace = true;
    }
    const piece = extractText(child, depth + 1);
    if (!piece) continue;
    parts.push(piece);
    endsWithWhitespace = /\s$/.test(piece);
  }
  return parts.join("");
}

export function countWords(doc: Record<string, unknown> | null): number {
  if (!doc) return 0;

  const text = extractText(doc as TipTapNode).trim();
  if (!text) return 0;

  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  let count = 0;
  for (const segment of segmenter.segment(text)) {
    if (segment.isWordLike) count++;
  }
  return count;
}
