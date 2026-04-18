import { MAX_TIPTAP_DEPTH } from "./schemas";

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
function extractText(node: TipTapNode, depth: number = 0): string {
  if (depth > MAX_TIPTAP_DEPTH) return "";
  if (node.text) return node.text;
  if (!node.content) return "";
  const parts: string[] = [];
  let endsWithWhitespace = true;
  for (const child of node.content) {
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
