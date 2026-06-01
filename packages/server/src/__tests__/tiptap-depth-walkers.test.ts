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
    const paragraph = (result.content as Array<Record<string, unknown>>)[0];
    const inline = paragraph.content as unknown[];
    expect(inline).toHaveLength(1); // merged: marks compared equal under the cap
  });
});
