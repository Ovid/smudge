/**
 * Cross-cutting depth-guard contract for TipTap-JSON walkers.
 *
 * Six walkers each implement their own depth-counted recursion capped at the
 * shared MAX_TIPTAP_DEPTH (64). This test pins that contract: each walker is
 * driven through its PUBLIC entry point with an assertion that flips if the
 * walker's `if (depth > MAX_TIPTAP_DEPTH)` bail is removed.
 *
 * ┌─ NEW WALKER? ────────────────────────────────────────────────────────────┐
 * │ Any new function that recurses TipTap JSON content MUST:                  │
 * │  1. import MAX_TIPTAP_DEPTH from "@smudge/shared" and bail when exceeded; │
 * │  2. be added to THIS test via its public entry point, with a             │
 * │     discriminating assertion (one that fails if the bail is removed).     │
 * │ A SEVENTH walker also triggers the "extract a generic walker" re-         │
 * │ evaluation deferred in dedup report I5                                     │
 * │ (paad/duplicate-code-reports/ovid-experimental-dedup-2026-04-28-08-02-18- │
 * │ 093074c.md).                                                              │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * The walkers count depth differently (tree walkers: 1 per content level;
 * canonicalize: object AND array levels; canonicalJSON: mark-attr nesting), so
 * a single over-cap depth (100) is chosen to exceed every walker's cap.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MAX_TIPTAP_DEPTH,
  validateTipTapDepth,
  countWords,
  searchInDoc,
  replaceInDoc,
  stripNoteMarks,
  stripImageNodes,
  extractNotes,
  toPlainText,
} from "@smudge/shared";
import {
  canonicalContentHash,
  __resetWarnedFallbackDigestsForTests,
} from "../snapshots/content-hash";
import { extractImageIds } from "../images/images.references";
import { logger } from "../logger";

// Comfortably past MAX_TIPTAP_DEPTH (64); trivially safe for JSON.parse /
// JSON.stringify (content-hash CP2 uses 200 without issue).
const OVER_CAP_DEPTH = 100;
const SAMPLE_UUID = "11111111-1111-4111-8111-111111111111";

/**
 * Wrap `leaf` in `depth` nested `blockquote` levels under a `doc` root.
 * blockquote is NOT in collectLeafBlocks' LEAF_BLOCKS set, so every walker
 * recurses through the chain and hits its depth cap before reaching `leaf`.
 */
function deepDoc(depth: number, leaf: Record<string, unknown>): Record<string, unknown> {
  let node: Record<string, unknown> = leaf;
  for (let i = 0; i < depth; i++) {
    node = { type: "blockquote", content: [node] };
  }
  return { type: "doc", content: [node] };
}

/**
 * A mark whose attrs nest `depth` levels with `leafValue` at the bottom.
 * Two such marks share every level except the leaf — which sits BELOW the
 * cap, so canonicalJSON (used by marks comparison) truncates it to "null"
 * for both when the cap is present, making them compare equal.
 */
function markWithNestedAttrs(depth: number, leafValue: string): Record<string, unknown> {
  let attrs: Record<string, unknown> = { v: leafValue };
  for (let i = 0; i < depth; i++) attrs = { nested: attrs };
  return { type: "highlight", attrs };
}

describe("TipTap depth-guard contract (MAX_TIPTAP_DEPTH walkers)", () => {
  beforeEach(() => {
    // canonicalContentHash warns once per unique content digest; reset the
    // per-process dedupe so this test's depth-warn is not suppressed by a
    // prior run.
    __resetWarnedFallbackDigestsForTests();
  });

  it("MAX_TIPTAP_DEPTH is the expected shared constant", () => {
    expect(MAX_TIPTAP_DEPTH).toBe(64);
  });

  it("validateTipTapDepth returns false for an over-cap document", () => {
    // Cap present → false. If the `depth > MAX` bail were removed it would
    // return true (no over-depth rejection).
    expect(validateTipTapDepth(deepDoc(OVER_CAP_DEPTH, { type: "text", text: "x" }))).toBe(false);
  });

  it("countWords drops text below the depth cap (extractText bails)", () => {
    // Only text in the doc sits below the cap. Cap present → extractText
    // returns "" for the deep subtree → 0 words. If the bail were removed,
    // the deep "hello world" would be counted (>= 2).
    const doc = deepDoc(OVER_CAP_DEPTH, { type: "text", text: "hello world" });
    expect(countWords(doc)).toBe(0);
  });

  it("extractImageIds drops an image below the depth cap (walk bails)", () => {
    // The only image reference sits below the cap. Cap present → walk skips
    // the deep subtree → []. If the bail were removed, the deep image's UUID
    // would be returned.
    const doc = deepDoc(OVER_CAP_DEPTH, {
      type: "image",
      attrs: { src: `/api/images/${SAMPLE_UUID}` },
    });
    expect(extractImageIds(doc)).toEqual([]);
  });

  it("searchInDoc finds nothing below the depth cap (collectLeafBlocks bails)", () => {
    // The matchable paragraph sits below the cap, reachable only by recursing
    // through the blockquote chain. Cap present → collectLeafBlocks bails
    // before reaching it → no leaf blocks → no matches. If the bail were
    // removed, the deep paragraph would be collected and "x" matched.
    const doc = deepDoc(OVER_CAP_DEPTH, {
      type: "paragraph",
      content: [{ type: "text", text: "x" }],
    });
    expect(searchInDoc(doc, "x")).toEqual([]);
  });

  it("canonicalContentHash falls back with a depth warning for over-cap JSON (canonicalize bails)", () => {
    // Cap present → canonicalize throws CanonicalizeDepthError internally,
    // caught by canonicalContentHash → raw-bytes hash + a reason:"depth" warn.
    // If the bail were removed, canonicalize would succeed (100 levels is well
    // within engine limits) → a canonical hash and NO warn.
    const json = JSON.stringify(deepDoc(OVER_CAP_DEPTH, { type: "text", text: "x" }));
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const hash = canonicalContentHash(json);
      expect(hash).toHaveLength(64);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "depth" }),
        expect.any(String),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("replaceInDoc merges adjacent runs whose marks differ only below the cap (canonicalJSON bails)", () => {
    // Two adjacent text nodes carry marks identical above the cap and
    // divergent ("A" vs "B") only below it. Cap present → canonicalJSON
    // truncates both marks to the same string → marksEqual → the replacement
    // runs MERGE into a single text node. If canonicalJSON's bail were
    // removed, the marks would serialize fully, differ, and NOT merge.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a", marks: [markWithNestedAttrs(OVER_CAP_DEPTH, "A")] },
            { type: "text", text: "a", marks: [markWithNestedAttrs(OVER_CAP_DEPTH, "B")] },
          ],
        },
      ],
    };
    const { doc: result, count } = replaceInDoc(doc, "a", "b");
    expect(count).toBe(2);
    const paragraph = (result.content as Array<Record<string, unknown>>)[0] as Record<
      string,
      unknown
    >;
    const inline = paragraph.content as unknown[];
    expect(inline).toHaveLength(1); // merged: marks compared equal under the cap
  });
});

/**
 * Cross-cutting CHILD-SHAPE contract for the same six walkers.
 *
 * TipTapDocSchema constrains TOP-LEVEL elements only
 * (`content: z.array(z.record(z.unknown()))`), and DB reads bypass Zod
 * entirely, so a `null` / primitive / **array** child is reachable at every
 * nested level. Each walker must treat such a child as ABSENT — fail closed —
 * rather than descend into it or pass it through verbatim.
 *
 * ┌─ NEW WALKER? ────────────────────────────────────────────────────────────┐
 * │ Guard with `!node || typeof node !== "object" || Array.isArray(node)` and │
 * │ add it to the table below. The array arm is the one that gets forgotten:  │
 * │ `typeof [] === "object"`, so the first two arms let an array through, and │
 * │ an array has no `.content`, so a walker that returns it verbatim smuggles │
 * │ the whole subtree past its own filter.                                    │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * I2 (dedup review 2026-07-26): fd574f1 added the array arm to four walkers
 * and missed stripNoteMarks and validateTipTapDepth. This table is the forcing
 * mechanism that would have caught it.
 */
describe("TipTap child-shape contract (fail closed on a non-descendable child)", () => {
  const NOTED_TEXT = {
    type: "text",
    text: "SECRET",
    marks: [{ type: "note", attrs: { text: "spoiler" } }],
  };
  const IMAGE_NODE = { type: "image", attrs: { src: `/api/images/${SAMPLE_UUID}` } };

  /** Wrap `child` so it sits as an ARRAY element inside doc.content. */
  const arrayWrapped = (child: unknown) => ({ type: "doc", content: [[child]] });

  it("stripNoteMarks drops an array-wrapped subtree instead of passing it through", () => {
    // The note mark is editor-only and must never reach a rendered surface.
    // Passing the array through verbatim preserved it — the one failure mode
    // this walker exists to prevent.
    const out = JSON.stringify(stripNoteMarks(arrayWrapped(NOTED_TEXT)));
    expect(out).not.toContain("spoiler");
    expect(out).not.toContain('"note"');
  });

  it("validateTipTapDepth rejects a chain nested through arrays", () => {
    // The depth cap's ONLY enforcement point is TipTapDocSchema's .refine, so a
    // walker that returns `true` for an array child makes MAX_TIPTAP_DEPTH
    // bypassable through the public API: a top-level array child is rejected by
    // Zod's z.array(z.record(...)), but a NESTED one is not, because only
    // top-level content is typed.
    let node: unknown = { type: "text", text: "x" };
    for (let i = 0; i < OVER_CAP_DEPTH; i++) node = { type: "blockquote", content: [[node]] };
    expect(validateTipTapDepth({ type: "doc", content: [node] })).toBe(false);
  });

  it("stripImageNodes drops an array-wrapped image", () => {
    const out = stripImageNodes(arrayWrapped(IMAGE_NODE));
    expect(JSON.stringify(out)).not.toContain(SAMPLE_UUID);
  });

  it("extractImageIds finds nothing inside an array-wrapped image", () => {
    expect(extractImageIds(arrayWrapped(IMAGE_NODE))).toEqual([]);
  });

  it("countWords counts nothing inside an array-wrapped text node", () => {
    expect(countWords(arrayWrapped({ type: "text", text: "hello world" }))).toBe(0);
  });

  it("toPlainText emits nothing for an array-wrapped text node", () => {
    expect(toPlainText(arrayWrapped({ type: "text", text: "hello" }))).not.toContain("hello");
  });

  it("searchInDoc matches nothing inside an array-wrapped paragraph", () => {
    const doc = arrayWrapped({ type: "paragraph", content: [{ type: "text", text: "x" }] });
    expect(searchInDoc(doc, "x")).toEqual([]);
  });

  it("extractNotes reports nothing inside an array-wrapped noted node", () => {
    expect(extractNotes(arrayWrapped(NOTED_TEXT))).toEqual([]);
  });

  it.each([
    ["null", null],
    ["a string", "text"],
    ["a number", 42],
  ])("every walker also fails closed on %s as a child", (_label, child) => {
    const doc = { type: "doc", content: [child] };
    expect(() => stripNoteMarks(doc)).not.toThrow();
    expect(() => stripImageNodes(doc)).not.toThrow();
    expect(countWords(doc)).toBe(0);
    expect(extractImageIds(doc)).toEqual([]);
    expect(searchInDoc(doc, "x")).toEqual([]);
    expect(extractNotes(doc)).toEqual([]);
    expect(validateTipTapDepth(doc)).toBe(true); // shallow: no depth violation
  });
});
