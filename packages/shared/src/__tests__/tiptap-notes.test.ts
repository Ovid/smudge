import { describe, it, expect } from "vitest";
import { stripNoteMarks } from "../tiptap-notes";

describe("stripNoteMarks", () => {
  it("removes note marks but keeps the text", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Marcus drew his sword",
              marks: [{ type: "note", attrs: { text: "check the weapon" } }],
            },
          ],
        },
      ],
    };
    const out = stripNoteMarks(doc);
    expect(out.content[0].content[0].marks).toBeUndefined();
    expect(out.content[0].content[0].text).toBe("Marcus drew his sword");
  });

  it("keeps other marks on the same text node", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "text",
          text: "x",
          marks: [{ type: "bold" }, { type: "note", attrs: { text: "n" } }],
        },
      ],
    };
    expect(stripNoteMarks(doc).content[0].marks).toEqual([{ type: "bold" }]);
  });

  it("does not mutate the input", () => {
    const doc = {
      type: "doc",
      content: [
        { type: "text", text: "x", marks: [{ type: "note", attrs: { text: "n" } }] },
      ],
    };
    stripNoteMarks(doc);
    expect(doc.content[0].marks).toHaveLength(1);
  });

  it("leaves a doc without notes structurally equal", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "plain", marks: [{ type: "bold" }] }],
        },
      ],
    };
    expect(stripNoteMarks(doc)).toEqual(doc);
  });

  it("bails safely on an over-deep doc (no throw)", () => {
    let node: { type: string; text?: string; content?: unknown[] } = {
      type: "text",
      text: "deep",
    };
    for (let i = 0; i < 200; i++) node = { type: "x", content: [node] };
    expect(() => stripNoteMarks({ type: "doc", content: [node] })).not.toThrow();
  });
});
