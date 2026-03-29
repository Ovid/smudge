type TipTapNode = {
  type: string;
  text?: string;
  content?: TipTapNode[];
};

function extractText(node: TipTapNode): string {
  if (node.text) return node.text;
  if (!node.content) return "";
  return node.content.map(extractText).join(" ");
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
