/**
 * TipTap Text Walker — search and replace within TipTap JSON documents.
 *
 * Handles text that spans multiple text nodes with different marks (formatting).
 */

// Depth cap for walkers — pulled from the zero-dependency tiptap-depth
// module directly (NOT via the shared barrel) so a future edit to the
// cap propagates automatically instead of silently drifting from the
// schema-side value.
import { MAX_TIPTAP_DEPTH as MAX_WALK_DEPTH } from "./tiptap-depth";

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
  /**
   * Upper bound on total output text characters across all replacement
   * expansions. Enforced incrementally so a pathological `$'` / `` $` `` /
   * `$&` template that splices the match context cannot balloon to
   * gigabytes before the post-hoc JSON byte-length check fires. Throws
   * ReplacementTooLargeError on exceed.
   */
  max_output_chars?: number;
}

// --- Internal helpers ---

/** Maximum matches allowed in a single search/replace request. */
export const MAX_MATCHES_PER_REQUEST = 10_000;

const LEAF_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/**
 * Collect leaf block nodes that directly contain text/inline nodes.
 * Defensively guards against:
 *   - primitive/null children slipped into stored content (walkers
 *     can't rely on the TipTap schema because chapters read from the
 *     DB bypass Zod; see images.references.ts for the same pattern);
 *   - pathologically-nested content exceeding the shared depth cap,
 *     which would otherwise stack-overflow this recursive walker on
 *     a legacy row that predates MAX_TIPTAP_DEPTH enforcement.
 */
function collectLeafBlocks(node: TipTapNode, depth: number = 0): TipTapNode[] {
  if (depth > MAX_WALK_DEPTH) return [];
  if (!node || typeof node !== "object") return [];
  if (LEAF_BLOCKS.has(node.type)) return [node];
  if (!Array.isArray(node.content)) return [];
  const result: TipTapNode[] = [];
  for (const child of node.content) {
    if (!child || typeof child !== "object") continue;
    result.push(...collectLeafBlocks(child, depth + 1));
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

  if (Array.isArray(block.content)) {
    for (const child of block.content) {
      if (!child || typeof child !== "object") continue;
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
    if (!Number.isFinite(idx) || idx < 1) return full;
    if (idx < match.length) return match[idx] ?? "";
    // Two-digit index out of range: mirror native String.prototype.replace,
    // which falls back to the single-digit group + remaining digit as
    // literal text (`$12` with 1 group → <group1>"2", not literal "$12").
    if (key.length === 2) {
      const firstChar = key[0];
      const secondChar = key[1];
      if (firstChar !== undefined && secondChar !== undefined) {
        const single = parseInt(firstChar, 10);
        if (single >= 1 && single < match.length) {
          return (match[single] ?? "") + secondChar;
        }
      }
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
    // Wrap in a non-capturing group so top-level alternation in the user's
    // regex (e.g. `foo|bar`) doesn't split the boundary wrappers.
    pattern = `(?<![\\p{L}\\p{N}_])(?:${pattern})(?![\\p{L}\\p{N}_])`;
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
  // Normalize group introducers so the `?` inside them doesn't trip the
  // nested-quantifier heuristic for benign non-capturing / lookaround /
  // named-group constructs. Covers: `(?:...)`, `(?=...)`, `(?!...)`,
  // `(?<=...)`, `(?<!...)`, and `(?<name>...)`.
  const normalized = pattern
    .replace(/\?:/g, "")
    .replace(/\?=/g, "")
    .replace(/\?!/g, "")
    .replace(/\?<=/g, "")
    .replace(/\?<!/g, "")
    .replace(/\?<[a-zA-Z_][a-zA-Z0-9_]*>/g, "");

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
  // separated only by a single-char atom / class / group — then skip the
  // warning when the two atoms are *provably disjoint* character classes
  // (e.g. `\w+\s+\w+`, `\d+\s+`). Disjoint atoms cannot both consume the
  // same char, so the polynomial-backtracking path is unreachable.
  //
  // We strip character-class contents first so quantifiers inside `[...]`
  // (which are literal) don't trip the scan.
  const withoutCharClasses = pattern.replace(/\[[^\]]*\]/g, "[]");
  // Matches: atom-then-quant, another-atom-then-quant, in sequence. Capture
  // each atom so we can test for provable disjointness below.
  // atom = escaped char | . | \w | \s | \d | (...) | [] | bare char
  const adjacentUnboundedQuantifier =
    /(\\.|\[\]|\([^()]*\)|[^\\(){}|])(?:[+*]|\{\d+,\d*\})(\\.|\[\]|\([^()]*\)|[^\\(){}|])(?:[+*]|\{\d+,\d*\})/g;
  for (const m of withoutCharClasses.matchAll(adjacentUnboundedQuantifier)) {
    const [, a1, a2] = m;
    if (a1 === undefined || a2 === undefined) continue;
    if (!areAtomsProvablyDisjoint(a1, a2)) {
      throw new RegExpSafetyError(
        "Pattern contains adjacent unbounded quantifiers that can cause slowdowns.",
      );
    }
  }
}

/**
 * Returns true when two regex atoms match disjoint character sets — i.e.,
 * no single character can be consumed by both. When this holds, adjacent
 * unbounded quantifiers on the two atoms cannot produce the exponential
 * distribution path that the safety check guards against. False is
 * conservative: unknown atoms fall through to the "potentially unsafe"
 * branch.
 *
 * Handles the shorthand character classes `\d`, `\D`, `\w`, `\W`, `\s`,
 * `\S`. Literal character-class ranges (e.g. `[A-Z]+[a-z]+`) are stripped
 * to `[]` by the caller and thus treated as unknown — a documented
 * follow-up limitation.
 */
function areAtomsProvablyDisjoint(atomA: string, atomB: string): boolean {
  const ca = shorthandClass(atomA);
  const cb = shorthandClass(atomB);
  if (ca === null || cb === null) return false;
  // Complement pairs and the provably-disjoint cross-family pairs.
  const key = [ca, cb].sort().join(",");
  // Complements: d/D, w/W, s/S.
  // Cross-family: \d is disjoint with \s and \W (digits ⊂ \w, so digits ∩ non-word = ∅).
  //               \w is disjoint with \s (word chars are [A-Za-z0-9_], no whitespace).
  //               \s is disjoint with \d and \w (mirror of the above).
  // Deliberately NOT listed (not disjoint): \w ∩ \D = letters+underscore ≠ ∅,
  // \s ∩ \D = \s, \s ∩ \W = \s.
  return (
    key === "D,d" ||
    key === "W,w" ||
    key === "S,s" ||
    key === "d,s" ||
    key === "W,d" ||
    key === "s,w"
  );
}

function shorthandClass(atom: string): "d" | "D" | "w" | "W" | "s" | "S" | null {
  if (atom === "\\d") return "d";
  if (atom === "\\D") return "D";
  if (atom === "\\w") return "w";
  if (atom === "\\W") return "W";
  if (atom === "\\s") return "s";
  if (atom === "\\S") return "S";
  return null;
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
 * Thrown when the running sum of expanded replacement characters exceeds
 * ReplaceOptions.max_output_chars. Guards against amplification by `$'` /
 * `` $` `` / `$&` in regex-mode templates that splice the full match
 * context on every match — without the running check, peak memory can
 * reach many gigabytes before the post-hoc JSON size check rejects.
 */
export class ReplacementTooLargeError extends Error {
  constructor() {
    super("Replacement would produce output over the size limit.");
    this.name = "ReplacementTooLargeError";
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
 * Used for marks comparison below. Mirrors the UNSAFE_KEYS filter and
 * depth cap from content-hash.ts so prototype-pollution keys in
 * user-supplied mark attrs can't surprise this path, and a pathologically
 * nested attrs structure cannot stack-overflow the walker.
 */
const CANONICAL_UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function canonicalJSON(value: unknown, depth: number = 0): string {
  if (depth > MAX_WALK_DEPTH) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map((v) => canonicalJSON(v, depth + 1)).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => !CANONICAL_UNSAFE_KEYS.has(k))
    .sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalJSON(obj[k], depth + 1)).join(",") +
    "}"
  );
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
  // Tracks how many matches have been *enumerated* across prior runs, so
  // match_index can select a single occurrence without re-scanning.
  //
  // Note on semantics: in match_index mode, we break out of the inner
  // enumeration loop as soon as allMatches.length > localTarget — so in
  // the run containing the target, this cursor advances by
  // (localTarget + 1), not by the true total matches in the run. After
  // targetFound flips true, every subsequent run/block short-circuits and
  // does not read the cursor, so the imprecision is not observable today.
  // Treat this as "total enumerated up to and including the found match",
  // not "true running match index" — any future reader that needs the
  // real count in match_index mode must enumerate without the early break.
  let globalMatchCursor = 0;
  // Running sum of characters emitted by every expanded replacement. Checked
  // against opts.max_output_chars after each match so pathological templates
  // (`$'`, `` $` ``, `$&`) that splice the match context can't balloon to GBs
  // before the post-hoc JSON size guard rejects.
  let outputChars = 0;
  const outputCap = opts.max_output_chars;
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
        if (outputCap !== undefined) {
          outputChars += repText.length;
          if (outputChars > outputCap) throw new ReplacementTooLargeError();
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
