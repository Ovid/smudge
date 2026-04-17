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

export interface ReplaceOptions extends SearchOptions {
  /**
   * When set, replace only the Nth match (0-based, counting across all
   * blocks in the document). When undefined, replace every match.
   */
  match_index?: number;
}

// --- Internal helpers ---

/** Maximum matches allowed in a single search/replace request. */
export const MAX_MATCHES_PER_REQUEST = 10_000;

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

/**
 * A contiguous run of text nodes. Non-text inline nodes (e.g. hardBreak)
 * split a block into multiple runs so search/replace never crosses them
 * and so they survive replacement.
 */
interface TextRun {
  flat: string;
  segments: TextSegment[];
}

/**
 * Split a leaf block's inline content into alternating text-runs and
 * non-text inline nodes. Rebuilding in order (run, node, run, node, …)
 * reproduces the original inline sequence. Non-text inline nodes act as
 * hard boundaries for search/replace.
 */
function splitBlockRuns(block: TipTapNode): { runs: TextRun[]; separators: TipTapNode[] } {
  const runs: TextRun[] = [];
  const separators: TipTapNode[] = [];
  let currentFlat = "";
  let currentSegments: TextSegment[] = [];
  let offset = 0;

  const flushRun = () => {
    runs.push({ flat: currentFlat, segments: currentSegments });
    currentFlat = "";
    currentSegments = [];
    offset = 0;
  };

  if (block.content) {
    for (const child of block.content) {
      if (child.type === "text" && child.text != null) {
        const len = child.text.length;
        currentSegments.push({ start: offset, end: offset + len, marks: child.marks });
        currentFlat += child.text;
        offset += len;
      } else {
        flushRun();
        separators.push(child);
      }
    }
  }
  flushRun();
  return { runs, separators };
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

/**
 * Reject patterns with shapes known to cause catastrophic backtracking
 * (ReDoS) in V8's regex engine. This is a best-effort heuristic, not a
 * complete analysis — it catches common cases like `(a+)+`, `(a*)*`, and
 * `(a|a)+`. Linear-time engines would make this unnecessary.
 */
export function assertSafeRegexPattern(pattern: string): void {
  // Nested quantifier: a group that contains + * ? or {n,m} and is itself
  // followed by one of those quantifiers.
  // This conservatively matches `( ... [+*?] ... ) [+*?{]`.
  const nestedQuantifier = /\([^()]*[+*?][^()]*\)\s*[+*?{]/;
  if (nestedQuantifier.test(pattern)) {
    throw new RegExpSafetyError("Pattern contains nested quantifiers that can cause slowdowns.");
  }
}

export class RegExpSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegExpSafetyError";
  }
}

export class MatchCapExceededError extends Error {
  constructor(cap: number) {
    super(`Too many matches (>${cap}); refine your search.`);
    this.name = "MatchCapExceededError";
  }
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
  const last = segments[segments.length - 1];
  if (last) return last.marks;
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
    const block = leafBlocks[blockIndex];
    if (!block) continue;
    const { runs } = splitBlockRuns(block);

    for (const run of runs) {
      if (!run.flat) continue;
      const re = buildRegex(query, opts);
      let m: RegExpExecArray | null;
      while ((m = re.exec(run.flat)) !== null) {
        matches.push({
          index: matchIndex++,
          context: extractContext(run.flat, m.index, m[0].length),
          blockIndex,
          offset: m.index,
          length: m[0].length,
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  }

  return matches;
}

export function replaceInDoc(
  doc: Record<string, unknown>,
  query: string,
  replacement: string,
  options?: ReplaceOptions,
): { doc: Record<string, unknown>; count: number } {
  const opts: ReplaceOptions = {
    case_sensitive: false,
    whole_word: false,
    regex: false,
    ...options,
  };

  const cloned = JSON.parse(JSON.stringify(doc)) as TipTapNode;
  const leafBlocks = collectLeafBlocks(cloned);
  let totalCount = 0;
  // Tracks the global match index across blocks so match_index can select
  // a single occurrence.
  let globalMatchCursor = 0;

  // In literal (non-regex) mode, escape `$` so `String.prototype.replace`
  // does not interpret `$&`, `$1`, `$$`, etc. as replacement patterns.
  const effectiveReplacement = opts.regex ? replacement : replacement.replace(/\$/g, "$$$$");

  for (const block of leafBlocks) {
    const { runs, separators } = splitBlockRuns(block);
    if (runs.length === 0) continue;

    // Rewrite each run independently, then re-weave text-runs with the
    // non-text inline separators (hardBreak etc) so they survive replace.
    const rebuiltRuns: TipTapNode[][] = [];
    let blockChanged = false;

    for (const run of runs) {
      const { flat, segments } = run;
      if (!flat || segments.length === 0) {
        rebuiltRuns.push([]);
        continue;
      }

      const re = buildRegex(query, opts);

      const allPositions: { start: number; end: number }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null) {
        allPositions.push({ start: m.index, end: m.index + m[0].length });
        if (m[0].length === 0) re.lastIndex++;
      }

      if (allPositions.length === 0) {
        rebuiltRuns.push(cloneTextNodes(segments, flat));
        continue;
      }

      let matchPositions = allPositions;
      if (typeof opts.match_index === "number") {
        const localIndex = opts.match_index - globalMatchCursor;
        const selected = allPositions[localIndex];
        if (!selected) {
          globalMatchCursor += allPositions.length;
          rebuiltRuns.push(cloneTextNodes(segments, flat));
          continue;
        }
        matchPositions = [selected];
      }
      globalMatchCursor += allPositions.length;
      totalCount += matchPositions.length;
      blockChanged = true;

      const repTexts = matchPositions.map((mp) => {
        const matchStr = flat.slice(mp.start, mp.end);
        return matchStr.replace(buildRegex(query, opts), effectiveReplacement);
      });

      const newNodes: TipTapNode[] = [];
      let oldCursor = 0;
      for (let i = 0; i < matchPositions.length; i++) {
        const mp = matchPositions[i];
        const repText = repTexts[i];
        if (!mp || repText === undefined) continue;
        if (oldCursor < mp.start) {
          appendWithMarks(newNodes, flat.slice(oldCursor, mp.start), segments, oldCursor);
        }
        if (repText.length > 0) {
          const marks = marksAtOffset(segments, mp.start);
          newNodes.push(makeTextNode(repText, marks));
        }
        oldCursor = mp.end;
      }
      if (oldCursor < flat.length) {
        appendWithMarks(newNodes, flat.slice(oldCursor), segments, oldCursor);
      }
      rebuiltRuns.push(cleanupTextNodes(newNodes));
    }

    if (!blockChanged) continue;

    // Weave runs and separators back together.
    const interleaved: TipTapNode[] = [];
    for (let i = 0; i < rebuiltRuns.length; i++) {
      interleaved.push(...(rebuiltRuns[i] ?? []));
      if (i < separators.length) {
        const sep = separators[i];
        if (sep) interleaved.push(sep);
      }
    }
    block.content = interleaved;
  }

  return { doc: cloned as unknown as Record<string, unknown>, count: totalCount };
}

/** Rebuild original text-run nodes from segments (used when no matches). */
function cloneTextNodes(segments: TextSegment[], flat: string): TipTapNode[] {
  return segments.map((seg) => makeTextNode(flat.slice(seg.start, seg.end), seg.marks));
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
      currentText += text[i] ?? "";
    } else {
      if (currentText) {
        nodes.push(makeTextNode(currentText, currentMarks));
      }
      currentMarks = marks;
      currentText = text[i] ?? "";
    }
  }
  if (currentText) {
    nodes.push(makeTextNode(currentText, currentMarks));
  }
}
