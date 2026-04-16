/**
 * TipTap Text Walker — search and replace within TipTap JSON documents.
 *
 * Handles text that spans multiple text nodes with different marks (formatting).
 */

type Mark = { type: string; attrs?: Record<string, unknown> };

type TipTapNode = {
  type: string;
  text?: string;
  marks?: Mark[];
  content?: TipTapNode[];
  attrs?: Record<string, unknown>;
};

export interface SearchMatch {
  index: number;
  context: string;
  blockIndex: number;
  offset: number;
  length: number;
}

export interface SearchOptions {
  case_sensitive?: boolean;
  whole_word?: boolean;
  regex?: boolean;
}

// --- Internal helpers ---

const LEAF_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/** Collect leaf block nodes that directly contain text/inline nodes. */
function collectLeafBlocks(node: TipTapNode): TipTapNode[] {
  if (LEAF_BLOCKS.has(node.type)) return [node];
  if (!node.content) return [];
  const result: TipTapNode[] = [];
  for (const child of node.content) {
    result.push(...collectLeafBlocks(child));
  }
  return result;
}

interface TextSegment {
  start: number;
  end: number;
  marks: Mark[] | undefined;
}

/** Flatten a leaf block's text nodes into a string with segment info. */
function flattenBlock(block: TipTapNode): { flat: string; segments: TextSegment[] } {
  const segments: TextSegment[] = [];
  let flat = "";
  let offset = 0;
  if (block.content) {
    for (const child of block.content) {
      if (child.type === "text" && child.text != null) {
        const len = child.text.length;
        segments.push({ start: offset, end: offset + len, marks: child.marks });
        flat += child.text;
        offset += len;
      }
    }
  }
  return { flat, segments };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegex(query: string, opts: SearchOptions): RegExp {
  let pattern = opts.regex ? query : escapeRegex(query);
  if (opts.whole_word) pattern = `\\b${pattern}\\b`;
  const flags = opts.case_sensitive ? "g" : "gi";
  return new RegExp(pattern, flags);
}

function extractContext(flat: string, offset: number, length: number): string {
  const r = 40;
  const start = Math.max(0, offset - r);
  const end = Math.min(flat.length, offset + length + r);
  return flat.slice(start, end);
}

function marksEqual(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const ma = a ?? [];
  const mb = b ?? [];
  if (ma.length !== mb.length) return false;
  return JSON.stringify(ma) === JSON.stringify(mb);
}

function makeTextNode(text: string, marks?: Mark[]): TipTapNode {
  const node: TipTapNode = { type: "text", text };
  if (marks && marks.length > 0) {
    node.marks = JSON.parse(JSON.stringify(marks));
  }
  return node;
}

/** Remove empty text nodes and merge adjacent nodes with identical marks. */
function cleanupTextNodes(nodes: TipTapNode[]): TipTapNode[] {
  const nonEmpty = nodes.filter((n) => n.type !== "text" || (n.text != null && n.text !== ""));
  const merged: TipTapNode[] = [];
  for (const node of nonEmpty) {
    if (node.type !== "text") {
      merged.push(node);
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev && prev.type === "text" && marksEqual(prev.marks, node.marks)) {
      prev.text = (prev.text ?? "") + (node.text ?? "");
    } else {
      merged.push({ ...node, marks: node.marks ? [...node.marks] : undefined });
    }
  }
  return merged;
}

/** Get marks for a given offset in the original flat string. */
function marksAtOffset(segments: TextSegment[], offset: number): Mark[] | undefined {
  for (const seg of segments) {
    if (offset >= seg.start && offset < seg.end) return seg.marks;
  }
  // Past end — use last segment
  if (segments.length > 0) return segments[segments.length - 1]!.marks;
  return undefined;
}

// --- Public API ---

export function searchInDoc(
  doc: Record<string, unknown>,
  query: string,
  options?: SearchOptions,
): SearchMatch[] {
  const opts: SearchOptions = {
    case_sensitive: false,
    whole_word: false,
    regex: false,
    ...options,
  };

  const root = doc as unknown as TipTapNode;
  const leafBlocks = collectLeafBlocks(root);
  const matches: SearchMatch[] = [];
  let matchIndex = 0;

  for (let blockIndex = 0; blockIndex < leafBlocks.length; blockIndex++) {
    const { flat } = flattenBlock(leafBlocks[blockIndex]!);
    if (!flat) continue;

    const re = buildRegex(query, opts);
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) !== null) {
      matches.push({
        index: matchIndex++,
        context: extractContext(flat, m.index, m[0].length),
        blockIndex,
        offset: m.index,
        length: m[0].length,
      });
      if (m[0].length === 0) re.lastIndex++;
    }
  }

  return matches;
}

export function replaceInDoc(
  doc: Record<string, unknown>,
  query: string,
  replacement: string,
  options?: SearchOptions,
): { doc: Record<string, unknown>; count: number } {
  const opts: SearchOptions = {
    case_sensitive: false,
    whole_word: false,
    regex: false,
    ...options,
  };

  const cloned = JSON.parse(JSON.stringify(doc)) as TipTapNode;
  const leafBlocks = collectLeafBlocks(cloned);
  let totalCount = 0;

  for (const block of leafBlocks) {
    const { flat, segments } = flattenBlock(block);
    if (!flat || segments.length === 0) continue;

    const re = buildRegex(query, opts);

    // Count matches
    const matchPositions: { start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(flat)) !== null) {
      matchPositions.push({ start: m.index, end: m.index + m[0].length });
      if (m[0].length === 0) re.lastIndex++;
    }

    if (matchPositions.length === 0) continue;
    totalCount += matchPositions.length;

    // Build a mapping from new string positions to original offsets.
    // Strategy: walk through old and new strings in parallel using match positions.
    // For non-replaced regions, mapping is 1:1.
    // For replaced regions, all chars map to the start of the original match.

    // First compute replacement text lengths by doing per-match replacements
    const repTexts: string[] = [];
    const re3 = buildRegex(query, opts);
    let mm: RegExpExecArray | null;
    while ((mm = re3.exec(flat)) !== null) {
      const matchStr = mm[0];
      // Apply the replacement pattern to just this match
      const replaced = matchStr.replace(buildRegex(query, opts), replacement);
      repTexts.push(replaced);
      if (mm[0].length === 0) re3.lastIndex++;
    }

    // Now build the new text nodes by walking through the new string
    // and determining marks for each character.
    const newNodes: TipTapNode[] = [];
    let oldCursor = 0;

    for (let i = 0; i < matchPositions.length; i++) {
      const mp = matchPositions[i]!;
      const repText = repTexts[i]!;

      // Non-replaced text before this match: character-by-character mark mapping
      if (oldCursor < mp.start) {
        const beforeText = flat.slice(oldCursor, mp.start);
        appendWithMarks(newNodes, beforeText, segments, oldCursor);
        oldCursor = mp.start;
      }

      // Replacement text: inherits marks from the first character of the match
      if (repText.length > 0) {
        const marks = marksAtOffset(segments, mp.start);
        newNodes.push(makeTextNode(repText, marks));
      }
      oldCursor = mp.end;
    }

    // Trailing non-replaced text
    if (oldCursor < flat.length) {
      const trailingText = flat.slice(oldCursor);
      appendWithMarks(newNodes, trailingText, segments, oldCursor);
    }

    block.content = cleanupTextNodes(newNodes);
  }

  return { doc: cloned as unknown as Record<string, unknown>, count: totalCount };
}

/** Append text character by character, grouping by marks from original segments. */
function appendWithMarks(
  nodes: TipTapNode[],
  text: string,
  segments: TextSegment[],
  startOffset: number,
): void {
  if (text.length === 0) return;

  let currentMarks = marksAtOffset(segments, startOffset);
  let currentText = "";

  for (let i = 0; i < text.length; i++) {
    const marks = marksAtOffset(segments, startOffset + i);
    if (marksEqual(marks, currentMarks)) {
      currentText += text[i]!;
    } else {
      if (currentText) {
        nodes.push(makeTextNode(currentText, currentMarks));
      }
      currentMarks = marks;
      currentText = text[i]!;
    }
  }
  if (currentText) {
    nodes.push(makeTextNode(currentText, currentMarks));
  }
}
