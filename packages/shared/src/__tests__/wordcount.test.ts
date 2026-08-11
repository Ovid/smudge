import { describe, it, expect } from "vitest";
import { countWords } from "../wordcount";

describe("countWords", () => {
  it("returns 0 for null content", () => {
    expect(countWords(null)).toBe(0);
  });

  it("survives malformed children without throwing", () => {
    // Chapters read from the DB bypass Zod, and TipTapDocSchema constrains
    // top-level elements only, so a nested null/primitive child is reachable.
    const doc = { type: "doc", content: [{ type: "paragraph", content: [null, 42, "x"] }] };
    expect(() => countWords(doc as Record<string, unknown>)).not.toThrow();
  });

  it("returns 0 for empty document", () => {
    expect(countWords({ type: "doc", content: [{ type: "paragraph" }] })).toBe(0);
  });

  it("counts words in simple paragraph", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
    };
    expect(countWords(doc)).toBe(2);
  });

  it("counts words across multiple paragraphs", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
        { type: "paragraph", content: [{ type: "text", text: "foo bar baz" }] },
      ],
    };
    expect(countWords(doc)).toBe(5);
  });

  it("ignores structural nodes without text", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "horizontalRule" },
        { type: "paragraph", content: [{ type: "text", text: "One word" }] },
      ],
    };
    expect(countWords(doc)).toBe(2);
  });

  it("handles nested content (blockquotes, lists)", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "blockquote",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Quoted text here" }] }],
        },
      ],
    };
    expect(countWords(doc)).toBe(3);
  });

  it("handles contractions as single words", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "don't can't won't" }] }],
    };
    expect(countWords(doc)).toBe(3);
  });

  it("treats adjacent marked text nodes as a single word (no phantom separator)", () => {
    // TipTap splits "foobar" into two text nodes when marks differ
    // (e.g. bold foo + italic bar). Joining with " " would inflate the count.
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", marks: [{ type: "bold" }], text: "foo" },
            { type: "text", marks: [{ type: "italic" }], text: "bar" },
          ],
        },
      ],
    };
    expect(countWords(doc)).toBe(1);
  });

  it("treats hardBreak as a word separator", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "foo" },
            { type: "hardBreak" },
            { type: "text", text: "bar" },
          ],
        },
      ],
    };
    expect(countWords(doc)).toBe(2);
  });

  it("handles hyphenated compounds", () => {
    const doc = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "well-known self-aware" }] }],
    };
    // Intl.Segmenter treats hyphenated words as separate segments
    const count = countWords(doc);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("does not stack-overflow on pathologically nested content", () => {
    // Build a doc nested past MAX_TIPTAP_DEPTH. Schema validation would
    // reject this on write, but the walker must degrade gracefully in
    // case legacy rows or test fixtures bypass that invariant.
    let node: Record<string, unknown> = { type: "text", text: "deep" };
    for (let i = 0; i < 500; i++) {
      node = { type: "paragraph", content: [node] };
    }
    const doc = { type: "doc", content: [node] };
    expect(() => countWords(doc)).not.toThrow();
  });
});

describe("countWords with a non-string text field (I2)", () => {
  // TipTapDocSchema types top-level elements only and DB reads bypass Zod, so
  // `text: 42` is reachable. `if (node.text)` returned the number and countWords
  // then called .trim() on it — a TypeError out of a render (OuttakeCard) and a
  // 500 out of PATCH /api/chapters/:id where the contract says 400.
  it("does not throw on a non-string text at the root", () => {
    expect(() => countWords({ type: "doc", text: 42 })).not.toThrow();
    expect(countWords({ type: "doc", text: 42 })).toBe(0);
  });

  it("does not count a non-string text nested in content", () => {
    const doc = { type: "doc", content: [{ type: "text", text: 7 }] };
    expect(countWords(doc)).toBe(0);
  });
});
