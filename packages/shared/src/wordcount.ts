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
 */
function extractText(node: TipTapNode): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  let out = "";
  for (const child of node.content) {
    if (child.type === "text") {
      out += extractText(child);
    } else {
      if (out && !/\s$/.test(out)) out += " ";
      out += extractText(child);
    }
  }
  return out;
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
