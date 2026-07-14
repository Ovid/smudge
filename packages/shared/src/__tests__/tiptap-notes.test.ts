import { describe, it, expect } from "vitest";
import { stripNoteMarks, extractNotes } from "../tiptap-notes";

/** A note buried below MAX_TIPTAP_DEPTH (64). Rejected by Zod on the API path,
 *  but reachable from a hand-edited DB or a restored backup — the same threat
 *  model sanitizer.ts and stripDisallowedImages already defend against. */
function overDeepNotedDoc(): Record<string, unknown> {
  let node: Record<string, unknown> = {
    type: "text",
    text: "buried",
    marks: [{ type: "note", attrs: { text: "SECRET" } }],
  };
  for (let i = 0; i < 200; i++) node = { type: "x", content: [node] };
  return { type: "doc", content: [node] };
}

/** Malformed docs that all pass TipTapDocSchema.safeParse — nested children are
 *  typed only as z.record(z.unknown()), so nested shape is unvalidated. Chapters
 *  read from the DB bypass Zod entirely (see tiptap-text.ts:70-76). */
const malformed: Record<string, Record<string, unknown>> = {
  "null child": { type: "doc", content: [{ type: "paragraph", content: [null] }] },
  "non-array marks": {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: {} }] }],
  },
  "non-array content": {
    type: "doc",
    content: [{ type: "paragraph", content: "oops" }],
  },
  "string child": { type: "doc", content: [{ type: "paragraph", content: ["oops"] }] },
};

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
    expect(out.content[0]!.content[0]!.marks).toBeUndefined();
    expect(out.content[0]!.content[0]!.text).toBe("Marcus drew his sword");
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
    expect(stripNoteMarks(doc).content[0]!.marks).toEqual([{ type: "bold" }]);
  });

  it("does not mutate the input", () => {
    const doc = {
      type: "doc",
      content: [{ type: "text", text: "x", marks: [{ type: "note", attrs: { text: "n" } }] }],
    };
    stripNoteMarks(doc);
    expect(doc.content[0]!.marks).toHaveLength(1);
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

  it("fails closed on an over-deep doc — drops the subtree rather than passing the note through", () => {
    const out = stripNoteMarks(overDeepNotedDoc());
    expect(JSON.stringify(out)).not.toContain("SECRET");
    expect(JSON.stringify(out)).not.toContain("buried");
  });

  it.each(Object.keys(malformed))("survives a malformed doc: %s", (key) => {
    const doc = malformed[key]!;
    const before = structuredClone(doc);
    expect(() => stripNoteMarks(doc)).not.toThrow();
    expect(doc).toEqual(before);
  });

  it("does not corrupt a string child into a character map", () => {
    const out = stripNoteMarks(malformed["string child"]!) as {
      content: [{ content: unknown[] }];
    };
    expect(out.content[0].content[0]).toBe("oops");
  });
});

describe("extractNotes", () => {
  it("extracts notes in document order with note text + excerpt", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Hello " },
            {
              type: "text",
              text: "world",
              marks: [{ type: "note", attrs: { text: "greeting" } }],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Marcus",
              marks: [{ type: "bold" }, { type: "note", attrs: { text: "rename?" } }],
            },
          ],
        },
      ],
    };
    expect(extractNotes(doc)).toEqual([
      { note: "greeting", excerpt: "world" },
      { note: "rename?", excerpt: "Marcus" },
    ]);
  });

  it("coalesces one note spanning several text nodes into a single entry", () => {
    // ProseMirror splits a run on every mark change, so "Marcus **drew** his
    // sword" under one note is three text nodes — but it is ONE note.
    const note = { type: "note", attrs: { text: "rename?" } };
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Marcus ", marks: [note] },
            { type: "text", text: "drew", marks: [{ type: "bold" }, note] },
            { type: "text", text: " his sword", marks: [note] },
          ],
        },
      ],
    };
    expect(extractNotes(doc)).toEqual([{ note: "rename?", excerpt: "Marcus drew his sword" }]);
  });

  it("keeps adjacent notes with different text separate", () => {
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "one", marks: [{ type: "note", attrs: { text: "first" } }] },
            { type: "text", text: "two", marks: [{ type: "note", attrs: { text: "second" } }] },
          ],
        },
      ],
    };
    expect(extractNotes(doc)).toEqual([
      { note: "first", excerpt: "one" },
      { note: "second", excerpt: "two" },
    ]);
  });

  it("does not coalesce equal notes across a block boundary", () => {
    const note = { type: "note", attrs: { text: "same" } };
    const doc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one", marks: [note] }] },
        { type: "paragraph", content: [{ type: "text", text: "two", marks: [note] }] },
      ],
    };
    expect(extractNotes(doc)).toHaveLength(2);
  });

  it("does not coalesce equal notes separated by un-noted text", () => {
    const note = { type: "note", attrs: { text: "same" } };
    const doc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "one", marks: [note] },
            { type: "text", text: " gap " },
            { type: "text", text: "two", marks: [note] },
          ],
        },
      ],
    };
    expect(extractNotes(doc)).toHaveLength(2);
  });

  it("returns [] when there are no notes", () => {
    expect(extractNotes({ type: "doc", content: [] })).toEqual([]);
  });

  it("treats a missing note attribute as an empty note", () => {
    const doc = {
      type: "doc",
      content: [{ type: "text", text: "x", marks: [{ type: "note" }] }],
    };
    expect(extractNotes(doc)).toEqual([{ note: "", excerpt: "x" }]);
  });

  it("bails safely on an over-deep doc (no throw)", () => {
    expect(() => extractNotes(overDeepNotedDoc())).not.toThrow();
  });

  it.each(Object.keys(malformed))("survives a malformed doc: %s", (key) => {
    expect(() => extractNotes(malformed[key]!)).not.toThrow();
  });
});
