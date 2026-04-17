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
  /**
   * Absolute Date.now() value at which the operation must abort with
   * RegExpTimeoutError. Defense-in-depth against patterns that sail
   * through assertSafeRegexPattern but still cause exponential
   * backtracking on specific inputs.
   */
  deadline?: number;
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

/**
 * Manually expand `String.prototype.replace`-style backreferences
 * ($&, $1..$99, $`, $', $$) against a captured match. Used so we don't
 * have to re-execute the regex on a sliced match string — re-execution
 * loses lookbehind/lookahead context and would silently produce a
 * no-op replacement for patterns like `(?<=foo)bar`.
 */
function expandReplacement(template: string, match: RegExpExecArray, regex: boolean): string {
  if (!regex) return template;
  return template.replace(/\$([&'`$]|\d{1,2})/g, (full, key: string) => {
    if (key === "$") return "$";
    if (key === "&") return match[0];
    if (key === "`") return match.input.slice(0, match.index);
    if (key === "'") return match.input.slice(match.index + match[0].length);
    const idx = parseInt(key, 10);
    // Out-of-range backref: preserve the literal `$NN` to match the native
    // String.prototype.replace contract. Users who write `$99` when there
    // are only 2 groups usually want the literal text, not silent deletion.
    if (Number.isFinite(idx) && idx >= 1 && idx <= 99) {
      if (idx >= match.length) return full;
      return match[idx] ?? "";
    }
    return full;
  });
}

export function buildRegex(query: string, opts: SearchOptions): RegExp {
  let pattern = opts.regex ? query : escapeRegex(query);
  if (opts.whole_word) {
    // Unicode-aware word boundary. JS's \b is ASCII-only, so CJK and
    // accented-Latin "whole word" searches would never match user-visible
    // words. Require that the character adjacent to the match is NOT a
    // Unicode letter, number, or underscore.
    pattern = `(?<![\\p{L}\\p{N}_])${pattern}(?![\\p{L}\\p{N}_])`;
  }
  const flags = (opts.case_sensitive ? "g" : "gi") + "u";
  return new RegExp(pattern, flags);
}

/**
 * Step the regex cursor past a zero-length match without splitting
 * surrogate pairs. With the /u flag a zero-length step can land mid-
 * surrogate, corrupting subsequent matches.
 */
function advancePastZeroLengthMatch(re: RegExp, str: string): void {
  const code = str.codePointAt(re.lastIndex) ?? 0;
  re.lastIndex += code > 0xffff ? 2 : 1;
}

/**
 * Reject patterns with shapes known to cause catastrophic backtracking
 * (ReDoS) in V8's regex engine. This is a best-effort heuristic, not a
 * complete analysis — a complete check would require a real regex parser
 * or a linear-time engine (node-re2). Combined with a per-request wall-
 * clock budget on the exec loop (REGEX_DEADLINE_MS in the caller), the
 * heuristic is defense-in-depth, not the sole line of defense.
 */
export function assertSafeRegexPattern(pattern: string): void {
  // Normalize `?:` (non-capturing marker) so the `?` inside it doesn't
  // trip the nested-quantifier heuristic for benign `(?:...)` groups.
  const normalized = pattern.replace(/\?:/g, "");

  // (1) Alternation-with-overlap inside a quantified group: `(x|x)+`,
  // `(x|x)*`. The two branches are textually identical, making the engine
  // try both for every position. Best-effort: parsing properly would
  // require a real regex parser. Run before (2) so the more specific
  // message wins.
  const alternationOverlap = /\(\s*([^()|]+?)\s*\|\s*\1\s*\)\s*[+*?{]/;
  if (alternationOverlap.test(normalized)) {
    throw new RegExpSafetyError(
      "Pattern contains overlapping alternation that can cause slowdowns.",
    );
  }

  // (2) Nested quantifier with no inner parens: `(...[+*?]...)[+*?{]` —
  // catches `(a+)+`, `(a*)*`, `(.?)*`, etc.
  const nestedQuantifierFlat = /\([^()]*[+*?][^()]*\)\s*[+*?{]/;
  if (nestedQuantifierFlat.test(normalized)) {
    throw new RegExpSafetyError("Pattern contains nested quantifiers that can cause slowdowns.");
  }

  // (3) Outer-quantified group containing any nested group: `(...(...)...)[+*?{]`.
  // Catches `((a+))+`, `(?:(a+))+`, `((a|b)+)+` — shapes the flat check
  // can't see because `[^()]*` cannot span nested parens.
  const nestedQuantifierWithSubgroup = /\([^()]*\([^()]*\)[^()]*\)\s*[+*?{]/;
  if (nestedQuantifierWithSubgroup.test(pattern)) {
    throw new RegExpSafetyError("Pattern contains nested quantifiers that can cause slowdowns.");
  }

  // (4) Adjacent unbounded quantifiers on overlapping atoms outside a
  // character class: `a*a*`, `\w+\w+`, `.*.+`. The engine can distribute
  // a run of "a"s across the two atoms in ~n ways per additional quantifier,
  // causing polynomial backtracking when a later anchor fails. Detect by
  // scanning for two quantifiers (+, *, {n,}) outside square brackets,
  // separated only by a single-char atom / class / group.
  //
  // We strip character-class contents first so quantifiers inside `[...]`
  // (which are literal) don't trip the scan.
  const withoutCharClasses = pattern.replace(/\[[^\]]*\]/g, "[]");
  // Matches: atom-then-quant, another-atom-then-quant, in sequence.
  // atom = escaped char | . | \w | \s | \d | (...) | [] | bare char
  const adjacentUnboundedQuantifier =
    /(?:\\.|\[\]|\([^()]*\)|[^\\(){}|])(?:[+*]|\{\d+,\d*\})(?:\\.|\[\]|\([^()]*\)|[^\\(){}|])(?:[+*]|\{\d+,\d*\})/;
  if (adjacentUnboundedQuantifier.test(withoutCharClasses)) {
    throw new RegExpSafetyError(
      "Pattern contains adjacent unbounded quantifiers that can cause slowdowns.",
    );
  }
}

export class RegExpTimeoutError extends Error {
  /**
   * The budget that was exceeded, in milliseconds, when known. Walker-level
   * throws (which only see an absolute deadline) omit this so the message
   * doesn't claim "0ms"; the service layer re-throws with the real budget.
   */
  constructor(ms?: number) {
    super(
      typeof ms === "number"
        ? `Search timed out after ${ms}ms; refine your pattern.`
        : "Search timed out; refine your pattern.",
    );
    this.name = "RegExpTimeoutError";
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

/**
 * Number of code units of context returned on either side of a match.
 * Exported so the client highlighter can compute the same offset
 * relationship without re-deriving (drift would mis-align highlights).
 */
export const CONTEXT_RADIUS = 40;

function extractContext(flat: string, offset: number, length: number): string {
  const start = Math.max(0, offset - CONTEXT_RADIUS);
  const end = Math.min(flat.length, offset + length + CONTEXT_RADIUS);
  return flat.slice(start, end);
}

/**
 * Recursively serialize a value with sorted object keys so two objects
 * with the same content but different key insertion order compare equal.
 * Used for marks comparison below.
 */
function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJSON).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k])).join(",") + "}";
}

function marksEqual(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  const ma = a ?? [];
  const mb = b ?? [];
  if (ma.length !== mb.length) return false;
  // Canonicalize key order so marks with the same attrs in different
  // insertion orders still compare equal. Without this, cleanupTextNodes
  // fails to merge semantically-identical adjacent runs, fragmenting the
  // document and causing countWords to drift from the editor's live count.
  return canonicalJSON(ma) === canonicalJSON(mb);
}

function makeTextNode(text: string, marks?: Mark[]): TipTapNode {
  const node: TipTapNode = { type: "text", text };
  if (marks && marks.length > 0) {
    node.marks = JSON.parse(JSON.stringify(marks));
  }
  return node;
}

/**
 * Remove empty text nodes and merge adjacent nodes with identical marks.
 * Callers only ever pass lists of text nodes (from appendWithMarks /
 * makeTextNode), so we don't need to handle non-text entries here.
 */
function cleanupTextNodes(nodes: TipTapNode[]): TipTapNode[] {
  const nonEmpty = nodes.filter((n) => n.text != null && n.text !== "");
  const merged: TipTapNode[] = [];
  for (const node of nonEmpty) {
    const prev = merged[merged.length - 1];
    if (prev && marksEqual(prev.marks, node.marks)) {
      prev.text = (prev.text ?? "") + (node.text ?? "");
    } else {
      merged.push({ ...node, marks: node.marks ? [...node.marks] : undefined });
    }
  }
  return merged;
}

/**
 * Get marks for a given offset in the original flat string. Callers only
 * pass offsets within [0, flat.length), which is covered by segments, so
 * the fallback cases past segments.end aren't needed.
 */
function marksAtOffset(segments: TextSegment[], offset: number): Mark[] | undefined {
  for (const seg of segments) {
    if (offset >= seg.start && offset < seg.end) return seg.marks;
  }
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
  // Hoist: the compiled regex is identical across every run. Re-creating
  // it per-run allocates and wastes time on large docs.
  const re = buildRegex(query, opts);

  for (let blockIndex = 0; blockIndex < leafBlocks.length; blockIndex++) {
    const block = leafBlocks[blockIndex];
    if (!block) continue;
    const { runs } = splitBlockRuns(block);

    for (const run of runs) {
      if (!run.flat) continue;
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(run.flat)) !== null) {
        if (matches.length >= MAX_MATCHES_PER_REQUEST) {
          // Bound memory & event-loop time. Without an internal cap, a
          // pathological pattern can balloon the matches array before the
          // service-level total check fires.
          throw new MatchCapExceededError(MAX_MATCHES_PER_REQUEST);
        }
        if (opts.deadline !== undefined && Date.now() > opts.deadline) {
          throw new RegExpTimeoutError();
        }
        matches.push({
          index: matchIndex++,
          context: extractContext(run.flat, m.index, m[0].length),
          blockIndex,
          offset: m.index,
          length: m[0].length,
        });
        if (m[0].length === 0) advancePastZeroLengthMatch(re, run.flat);
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
  // Hoist: the compiled regex is identical across every run. Re-creating
  // it per-run allocates and wastes time on large docs.
  const re = buildRegex(query, opts);
  const isMatchIndexMode = typeof opts.match_index === "number";
  // Once the match_index target is replaced, later runs/blocks must not
  // enumerate further matches or the match-cap could fire for a single-
  // match request on a broad pattern.
  let targetFound = false;

  // expandReplacement interprets `$&`/`$1`/etc. only in regex mode, so the
  // raw replacement is passed through verbatim in literal mode.
  const effectiveReplacement = replacement;

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

      // Once the target has been replaced, leave remaining runs untouched.
      if (isMatchIndexMode && targetFound) {
        rebuiltRuns.push(cloneTextNodes(segments, flat));
        continue;
      }

      re.lastIndex = 0;
      const localTarget = isMatchIndexMode ? (opts.match_index as number) - globalMatchCursor : -1;

      // Capture each match's full RegExpExecArray so we can expand the
      // replacement template against the captures later — re-running the
      // regex on a sliced match string loses lookbehind/lookahead context
      // and silently produces no-op replacements.
      const allMatches: { start: number; end: number; m: RegExpExecArray }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(flat)) !== null) {
        // Skip the global match cap in match_index mode: the caller wants
        // a single replacement, and enumerating every match just to reject
        // the request defeats the point. We still bound enumeration via the
        // early break below.
        if (!isMatchIndexMode && totalCount + allMatches.length >= MAX_MATCHES_PER_REQUEST) {
          throw new MatchCapExceededError(MAX_MATCHES_PER_REQUEST);
        }
        if (opts.deadline !== undefined && Date.now() > opts.deadline) {
          throw new RegExpTimeoutError();
        }
        allMatches.push({ start: m.index, end: m.index + m[0].length, m });
        if (m[0].length === 0) advancePastZeroLengthMatch(re, flat);
        // Stop as soon as we have enumerated past the target index. Works
        // when localTarget is negative (target was in an earlier run):
        // breaks after the first match, which we don't use.
        if (isMatchIndexMode && allMatches.length > localTarget) break;
      }

      if (allMatches.length === 0) {
        rebuiltRuns.push(cloneTextNodes(segments, flat));
        continue;
      }

      let matches = allMatches;
      if (isMatchIndexMode) {
        const selected = allMatches[localTarget];
        if (!selected) {
          globalMatchCursor += allMatches.length;
          rebuiltRuns.push(cloneTextNodes(segments, flat));
          continue;
        }
        matches = [selected];
        targetFound = true;
      }
      globalMatchCursor += allMatches.length;
      totalCount += matches.length;
      blockChanged = true;

      const newNodes: TipTapNode[] = [];
      let oldCursor = 0;
      for (const match of matches) {
        if (oldCursor < match.start) {
          appendWithMarks(newNodes, flat.slice(oldCursor, match.start), segments, oldCursor);
        }
        const repText = expandReplacement(effectiveReplacement, match.m, !!opts.regex);
        if (repText.length > 0) {
          const marks = marksAtOffset(segments, match.start);
          newNodes.push(makeTextNode(repText, marks));
        }
        oldCursor = match.end;
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
