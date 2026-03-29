import { describe, it, expect } from "vitest";
import { countWords } from "../wordcount";

describe("countWords", () => {
  it("returns 0 for null content", () => {
    expect(countWords(null)).toBe(0);
  });

  it("returns 0 for empty document", () => {
    expect(countWords({ type: "doc", content: [{ type: "paragraph" }] })).toBe(0);
  });

  it("counts words in simple paragraph", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
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
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Quoted text here" }] },
          ],
        },
      ],
    };
    expect(countWords(doc)).toBe(3);
  });

  it("handles contractions as single words", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "don't can't won't" }] },
      ],
    };
    expect(countWords(doc)).toBe(3);
  });

  it("handles hyphenated compounds", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "well-known self-aware" }] },
      ],
    };
    // Intl.Segmenter treats hyphenated words as separate segments
    const count = countWords(doc);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
