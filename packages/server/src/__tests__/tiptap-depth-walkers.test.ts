/**
 * Cross-cutting depth-guard contract for TipTap-JSON walkers.
 *
 * ELEVEN walkers each implement their own depth-counted recursion capped at the
 * shared MAX_TIPTAP_DEPTH (64). This test pins that contract: each walker is
 * driven through its PUBLIC entry point with an assertion that flips if the
 * walker's `if (depth > MAX_TIPTAP_DEPTH)` bail is removed. All eleven are
 * enrolled below.
 *
 * S1 (agentic-review 2026-07-26): the eleventh, the DOCX renderer's
 * blockToParagraphs, used to be delegated to export.renderers.test.ts "because
 * it needs the export fixtures". It does not — and that delegation could not
 * work: through renderDocx the bail is unreachable (stripNoteMarks runs first
 * and truncates one level earlier), so the delegated test passed on the
 * strip's behaviour and stayed green with the bail deleted. Delegation is how a
 * walker ends up certified by a test that cannot fail. Enrol here, calling the
 * walker directly through __depthContractSeam.
 *
 * ┌─ NEW WALKER? ────────────────────────────────────────────────────────────┐
 * │ Any new function that recurses TipTap JSON content MUST:                  │
 * │  1. import MAX_TIPTAP_DEPTH from "@smudge/shared" and bail when exceeded; │
 * │  2. be added to THIS test via its public entry point, with a             │
 * │     DISCRIMINATING assertion — one that fails if the bail is removed.     │
 * │     `expect(...).not.toThrow()` is NOT discriminating, and neither is an  │
 * │     assertion about something the walker drops for another reason: the    │
 * │     image/note checks run BEFORE the depth bail, so asserting a deep      │
 * │     image is gone proves nothing. Assert that the over-deep SUBTREE is    │
 * │     gone. Verify by deleting the bail and watching this test go red.      │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * I5 (dedup review 2026-07-26): this header used to say "Six walkers" and its
 * tripwire fired on a SEVENTH. There were ten by then, and it had never fired —
 * four walkers had a bail with no enrollment here (two of them, stripImageNodes
 * and toPlainText, pinned by NO test at all: both bails could be deleted
 * together with all 33 of their local tests still passing), and the DOCX walker
 * had no bail at all. A count in prose is not a mechanism; enrollment is. The
 * "extract a generic walker" re-evaluation that tripwire deferred has now been
 * made and DECLINED — see the rejection entry in
 * paad/dedup-reviews/scratchpad-outtakes-2026-07-26-15-00-06-4a87534.md. The
 * walkers differ on fail-return type (null / undefined / void / [] / false /
 * ""), traversal shape, what counts as a level, and whether marks are visited;
 * a shared walkTipTap would need three policy knobs, i.e. worse than the
 * copies. This test IS the intended ceiling. Do not re-derive that decision;
 * just enrol the new walker.
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
import { __depthContractSeam } from "../export/docx.renderer";
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

  it("stripImageNodes drops the whole subtree below the depth cap (strip bails)", () => {
    // I5 (dedup review 2026-07-26): this walker's bail was UNENROLLED on the
    // depth axis, and its own local depth test asserted only `not.toThrow()` —
    // which passes with or without the bail. Deleting the bail from
    // tiptap-images.ts AND tiptap-plaintext.ts together broke no test at all.
    //
    // The leaf is deliberately NOT an image: `node.type === "image"` is checked
    // BEFORE the depth bail, so a deep image is dropped either way and asserting
    // on it does not discriminate. What the bail decides is whether the
    // over-deep subtree is dropped or passed through verbatim — and passing it
    // through is what would smuggle images (any node the walker never inspected)
    // past the strip.
    const doc = deepDoc(OVER_CAP_DEPTH, { type: "text", text: "DEEP_MARKER" });
    expect(JSON.stringify(stripImageNodes(doc))).not.toContain("DEEP_MARKER");
  });

  it("toPlainText emits no text below the depth cap (walk bails)", () => {
    // Same unenrolled-and-untested gap as stripImageNodes above.
    const doc = deepDoc(OVER_CAP_DEPTH, { type: "text", text: "hello world" });
    expect(toPlainText(doc)).not.toContain("hello");
  });

  it("stripNoteMarks drops the whole subtree below the depth cap (strip bails)", () => {
    // Pinned locally by tiptap-notes.test.ts too, but the cross-cutting
    // contract is what a future author reads — a confidentiality-critical bail
    // must not be enrolled only in its own module's tests.
    //
    // As with stripImageNodes, the mark strip itself runs regardless of depth,
    // so asserting on the note text does not discriminate. The bail's job is to
    // drop the subtree it refused to descend into.
    const doc = deepDoc(OVER_CAP_DEPTH, { type: "text", text: "DEEP_MARKER" });
    expect(JSON.stringify(stripNoteMarks(doc))).not.toContain("DEEP_MARKER");
  });

  it("blockToParagraphs (DOCX) renders nothing below the depth cap (bail drops the subtree)", async () => {
    // S1 (agentic-review 2026-07-26): the eleventh walker, enrolled DIRECTLY
    // rather than through renderDocx. It was previously delegated to
    // export.renderers.test.ts, where the assertion could not discriminate:
    // renderDocx → tipTapToParagraphs runs stripNoteMarks FIRST, and that
    // walker counts the doc as depth 0 while blockToParagraphs enters doc
    // children at depth 0 — one level behind. Every node surviving the strip
    // therefore arrives at docxDepth <= 63 and the `> 64` bail cannot fire, so
    // the old test passed on the strip's behaviour and stayed green with the
    // bail deleted (verified: 110/110).
    //
    // Calling the walker directly is the whole point: the bail exists to
    // survive a future change that relocates the strip (it is there for note
    // confidentiality, not depth) and leaves this recursion unguarded. That is
    // the scenario, and it is only reachable without the strip in the path.
    const { blockToParagraphs, newBuildState } = __depthContractSeam;
    const state = newBuildState({ getImage: async () => null } as unknown as never);
    // deepDoc wraps in a doc root; hand the walker the doc's single child, the
    // way tipTapToParagraphs does, and start it over the cap.
    const doc = deepDoc(OVER_CAP_DEPTH, { type: "text", text: "DEEP_MARKER" });
    const topBlock = (doc.content as Array<Record<string, unknown>>)[0]!;

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const paragraphs = await blockToParagraphs(topBlock, state, {
        depth: MAX_TIPTAP_DEPTH + 1,
      });
      expect(paragraphs).toEqual([]);
      // Dropped deliberately, not by catching a stack overflow in the walker's
      // own try/catch — which would look identical from the outside.
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("blockToParagraphs (DOCX) counts the listItem level too (S10)", async () => {
    // S10 (agentic-review 2026-08-04): the enrollment above drives the bail
    // through a BLOCKQUOTE chain, which recurses through the node it counts. The
    // list arm does not: `listItemsToParagraphs` reads `listItem.content`
    // directly, so it never enters the listItem and used to count one level for
    // the two that a `list > listItem > block` chain actually spends. The guard
    // fired at a true depth of ~130 rather than 64 — a defence-in-depth guard
    // not holding the depth it claims, and invisible to a blockquote fixture.
    //
    // 40 list levels = 80 TipTap levels. Counted correctly the chain crosses the
    // cap at the 34th list and the marker below it is dropped; counted one per
    // list it reaches only 40 and the marker renders.
    const { blockToParagraphs, newBuildState } = __depthContractSeam;
    const state = newBuildState({ getImage: async () => null } as unknown as never);
    let node: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "DEEP_MARKER" }],
    };
    for (let i = 0; i < 40; i++) {
      node = { type: "bulletList", content: [{ type: "listItem", content: [node] }] };
    }

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const paragraphs = await blockToParagraphs(node, state);
      expect(paragraphs).toEqual([]);
      // Dropped by the bail, not by the walker's own try/catch swallowing a
      // stack overflow — which would look identical from the outside.
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("extractNotes reports no note below the depth cap (collect bails)", () => {
    const doc = deepDoc(OVER_CAP_DEPTH, {
      type: "paragraph",
      content: [{ type: "text", text: "x", marks: [{ type: "note", attrs: { text: "spoiler" } }] }],
    });
    expect(extractNotes(doc)).toEqual([]);
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
 * Cross-cutting SHAPE contract for the same walkers — both the shape of a
 * child and the shape of the `content` container holding it. (No count in the
 * prose: see the I5 note above on why enrollment, not a number, is the
 * mechanism.)
 *
 * TipTapDocSchema constrains TOP-LEVEL elements only
 * (`content: z.array(z.record(z.unknown()))`), and DB reads bypass Zod
 * entirely, so a `null` / primitive / **array** child is reachable at every
 * nested level. Each walker must treat such a child as ABSENT — fail closed —
 * rather than descend into it or pass it through verbatim.
 *
 * ┌─ NEW WALKER? ────────────────────────────────────────────────────────────┐
 * │ Guard with `isTipTapNode(node)` (@smudge/shared) and add it to the table  │
 * │ below. The array arm is the one that gets forgotten:                      │
 * │ `typeof [] === "object"`, so a hand-written null+typeof check lets an     │
 * │ array through, and an array has no `.content`, so a walker that returns   │
 * │ it verbatim smuggles the whole subtree past its own filter.               │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * S1 (dedup review 2026-07-26): this box used to instruct authors to write out
 * `!node || typeof node !== "object" || Array.isArray(node)` — institutionalising
 * the literal copy whose omission WAS the I2 bug below. It now names the shared
 * predicate. Two walkers cannot adopt it and keep their own split forms:
 * validateTipTapDepth needs array→false but primitive→true, and tiptap-notes'
 * walker needs array→undefined but primitive→node.
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
    expect(toPlainText(doc)).toBe("");
    expect(extractImageIds(doc)).toEqual([]);
    expect(searchInDoc(doc, "x")).toEqual([]);
    expect(extractNotes(doc)).toEqual([]);
    expect(validateTipTapDepth(doc)).toBe(true); // shallow: no depth violation
  });

  /**
   * I2 (agentic-review 2026-08-04): the table above pins the shape of a
   * CHILD; this one pins the shape of the `content` CONTAINER holding it.
   * `TipTapDocSchema` types top-level elements only and validateTipTapDepth
   * ends with `if (!Array.isArray(content)) return true`, so
   * `{"type":"paragraph","content":5}` is accepted by `PATCH /api/chapters/:id`.
   * `toPlainText` and countWords' extractText were the two walkers iterating
   * `node.content` without an Array.isArray guard — `?? []` and `if
   * (!node.content)` both let a truthy non-iterable through, and `for…of 5`
   * throws. countWords runs BEFORE the transaction on the chapter PATCH (500
   * where the contract says 400), and both run inside OuttakeCard's render, so
   * a persisted outtake row made the drawer throw on every render — and the
   * drawer is what renders its own delete button.
   */
  it.each([
    ["a number", 42],
    ["a string", "text"],
    ["an object", { type: "text", text: "smuggled" }],
    ["an image object", IMAGE_NODE],
    ["a noted object", NOTED_TEXT],
    ["true", true],
  ])("every walker also fails closed on %s as a nested `content` container", (_label, content) => {
    const doc = { type: "doc", content: [{ type: "paragraph", content }] };
    // I1 (agentic-review 2026-08-04): these two cells used to assert only
    // `not.toThrow()` — the exact non-discriminating assertion this file's own
    // header forbids, and it certified a guarantee the code did not provide.
    // Both walkers returned the node VERBATIM here, so an image survived the
    // outtake capture strip and a note mark survived the export strip. Assert
    // the unreadable container is DROPPED, which is what fails open.
    expect(stripNoteMarks(doc)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(stripImageNodes(doc)).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
    expect(countWords(doc)).toBe(0);
    expect(toPlainText(doc)).toBe("");
    expect(extractImageIds(doc)).toEqual([]);
    expect(searchInDoc(doc, "x")).toEqual([]);
    expect(extractNotes(doc)).toEqual([]);
    // S1: an unreadable container is a structurally invalid document, and this
    // walker is the API's only content validator — accepting it let every
    // downstream consumer degrade differently and silently (an unreadable
    // container in a chapter drops the ENTIRE body from HTML/EPUB/markdown/
    // plaintext export behind one logger.warn). Reject it at the boundary.
    // This is a SEPARATE hardening, not a substitute for the two strips above:
    // their contract is "no caller has to depth-validate first", and they run
    // on DB-read content that never passes through Zod.
    expect(validateTipTapDepth(doc)).toBe(false);
  });
});
