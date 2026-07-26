// Imported from the zero-dep tiptap-safety module rather than schemas so
// countWords callers (notably the client bundle) don't pull in Zod just
// to compute word counts.
import { MAX_TIPTAP_DEPTH } from "./tiptap-safety";

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
  if (!node.content) return "";
  const parts: string[] = [];
  let endsWithWhitespace = true;
  for (const child of node.content) {
    // Nested content[] is unvalidated by TipTapDocSchema (it constrains
    // top-level elements only) and DB-read content bypasses Zod entirely, so a
    // null/primitive/array child is reachable; reading .type off one threw.
    // Contributes no text and no separator — treat it as absent.
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
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
